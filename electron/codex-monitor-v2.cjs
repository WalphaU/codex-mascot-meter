const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TAIL_BYTES = 4 * 1024 * 1024;
const FIRST_LINE_LIMIT = 6 * 1024 * 1024;
const APPEND_OVERLAP_BYTES = 256 * 1024;
const SNAPSHOT_REUSE_MS = 10_000;
const USAGE_FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];

function normalizePath(value) {
  if (!value) return '';
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunks = [];
    let total = 0;
    while (total < FIRST_LINE_LIMIT) {
      const buffer = Buffer.alloc(Math.min(128 * 1024, FIRST_LINE_LIMIT - total));
      const count = fs.readSync(fd, buffer, 0, buffer.length, total);
      if (!count) break;
      const slice = buffer.subarray(0, count);
      const newline = slice.indexOf(10);
      chunks.push(newline >= 0 ? slice.subarray(0, newline) : slice);
      total += newline >= 0 ? newline : count;
      if (newline >= 0) break;
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { fs.closeSync(fd); }
}

function readTail(filePath, maxBytes = TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const size = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - size);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      text = newline >= 0 ? text.slice(newline + 1) : '';
    }
    return text;
  } finally { fs.closeSync(fd); }
}

function readRecentAppend(filePath, previousSize, currentSize) {
  let start = Math.max(0, Number(previousSize || 0) - APPEND_OVERLAP_BYTES);
  if (currentSize - start > TAIL_BYTES) start = Math.max(0, currentSize - TAIL_BYTES);
  const size = Math.max(0, currentSize - start);
  if (!size) return '';
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(size);
    const count = fs.readSync(fd, buffer, 0, size, start);
    let text = buffer.subarray(0, count).toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      if (newline < 0) return readTail(filePath);
      text = text.slice(newline + 1);
    }
    return text;
  } finally { fs.closeSync(fd); }
}

function parsePlan(payload) {
  if (!payload || !['function_call', 'custom_tool_call'].includes(payload.type)) return null;
  if (payload.name === 'exec' && typeof payload.input === 'string' && payload.input.includes('update_plan')) {
    const calls = [...payload.input.matchAll(/await\s+tools\.([a-zA-Z0-9_]+)\s*\(/g)];
    const finalCall = calls.at(-1);
    if (!finalCall || finalCall[1] !== 'update_plan') return null;
    const directInput = payload.input.slice(finalCall.index);
    const plan = [];
    const itemPattern = /\{\s*["']?step["']?\s*:\s*(["'`])([\s\S]*?)\1\s*,\s*["']?status["']?\s*:\s*(["'`])(pending|in_progress|completed)\3\s*\}/g;
    let match;
    while ((match = itemPattern.exec(directInput))) plan.push({ step: match[2], status: match[4] });
    return plan.length ? plan : null;
  }
  if (payload.name !== 'update_plan') return null;
  const raw = payload.arguments ?? payload.input;
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!value || !Array.isArray(value.plan)) return null;
  return value.plan.map((item) => ({
    step: String(item.step || '未命名步骤'),
    status: ['pending', 'in_progress', 'completed'].includes(item.status) ? item.status : 'pending'
  }));
}

function parseTimestamp(event) {
  return Date.parse(event.timestamp || event.payload?.timestamp || '') || 0;
}

function maxUsage(previous, next) {
  if (!previous) return next || null;
  if (!next) return previous;
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, Math.max(Number(previous[field] || 0), Number(next[field] || 0))]));
}

function mergeSamples(previous = [], next = []) {
  const samples = new Map();
  for (const sample of [...previous, ...next]) if (sample?.timestamp) samples.set(sample.timestamp, sample);
  return [...samples.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-96);
}

function parseEventsFromText(text) {
  const parsed = {
    tokenUsage: null, lastTokenUsage: null, tokenTimestamp: 0, tokenSamples: [],
    rateLimits: null, rateLimitsTimestamp: 0,
    plan: null, planTimestamp: 0,
    latestTimestamp: 0, lastActivityType: null,
    taskStatus: 'unknown', taskStatusTimestamp: 0, activeTurnId: null,
    taskStartedTimestamp: 0, taskCompletedTimestamp: 0,
    model: null, effort: null, modelTimestamp: 0
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = safeJson(line);
    if (!event) continue;
    const timestamp = parseTimestamp(event);
    parsed.latestTimestamp = Math.max(parsed.latestTimestamp, timestamp);
    const payload = event.payload || {};

    if (event.type === 'turn_context' && timestamp >= parsed.modelTimestamp) {
      const model = payload.model || null;
      const effort = payload.effort || payload.reasoning_effort || null;
      if (model || effort) {
        parsed.model = model || parsed.model;
        parsed.effort = effort || parsed.effort;
        parsed.modelTimestamp = timestamp;
      }
    }
    if (event.type === 'event_msg') {
      parsed.lastActivityType = payload.type || parsed.lastActivityType;
      if (payload.type === 'thread_settings_applied' && timestamp >= parsed.modelTimestamp) {
        const settings = payload.thread_settings || {};
        const model = settings.model || null;
        const effort = settings.reasoning_effort || settings.effort || null;
        if (model || effort) {
          parsed.model = model || parsed.model;
          parsed.effort = effort || parsed.effort;
          parsed.modelTimestamp = timestamp;
        }
      }
      if (payload.type === 'task_started' && timestamp >= parsed.taskStatusTimestamp) {
        parsed.taskStatus = 'working'; parsed.taskStatusTimestamp = timestamp;
        parsed.taskStartedTimestamp = timestamp; parsed.activeTurnId = payload.turn_id || null;
        // A new turn must never inherit the previous turn's completed plan.
        parsed.plan = null; parsed.planTimestamp = timestamp;
      }
      if (['task_complete', 'task_completed'].includes(payload.type) && timestamp >= parsed.taskStatusTimestamp) {
        parsed.taskStatus = 'done'; parsed.taskStatusTimestamp = timestamp;
        parsed.taskCompletedTimestamp = timestamp; parsed.activeTurnId = payload.turn_id || parsed.activeTurnId;
      }
      if (payload.type === 'turn_aborted' && timestamp >= parsed.taskStatusTimestamp) {
        parsed.taskStatus = 'idle'; parsed.taskStatusTimestamp = timestamp;
      }
      if (payload.type === 'token_count' && timestamp >= parsed.tokenTimestamp) {
        const totalUsage = payload.info?.total_token_usage || null;
        parsed.tokenUsage = maxUsage(parsed.tokenUsage, totalUsage);
        parsed.lastTokenUsage = payload.info?.last_token_usage || parsed.lastTokenUsage;
        parsed.tokenTimestamp = timestamp;
        if (totalUsage) {
          parsed.tokenSamples.push({ timestamp, outputTokens: Number(totalUsage.output_tokens || 0), totalTokens: Number(totalUsage.total_tokens || 0) });
          parsed.tokenSamples = parsed.tokenSamples.slice(-96);
        }
        if (payload.rate_limits && timestamp >= parsed.rateLimitsTimestamp) {
          parsed.rateLimits = payload.rate_limits;
          parsed.rateLimitsTimestamp = timestamp;
        }
      }
    }
    if (event.type === 'response_item') {
      const plan = parsePlan(payload);
      if (plan && timestamp >= parsed.planTimestamp) { parsed.plan = plan; parsed.planTimestamp = timestamp; }
    }
  }
  return parsed;
}

function mergeEventState(previous, next) {
  if (!previous) return next;
  const merged = { ...previous, tokenUsage: maxUsage(previous.tokenUsage, next.tokenUsage), tokenSamples: mergeSamples(previous.tokenSamples, next.tokenSamples) };
  if (next.tokenTimestamp >= previous.tokenTimestamp && next.tokenTimestamp) {
    merged.lastTokenUsage = next.lastTokenUsage || previous.lastTokenUsage; merged.tokenTimestamp = next.tokenTimestamp;
  }
  if (next.rateLimitsTimestamp >= previous.rateLimitsTimestamp && next.rateLimits) {
    merged.rateLimits = next.rateLimits; merged.rateLimitsTimestamp = next.rateLimitsTimestamp;
  }
  if (next.planTimestamp >= previous.planTimestamp && next.planTimestamp) {
    merged.plan = next.plan; merged.planTimestamp = next.planTimestamp;
  }
  if (next.modelTimestamp >= previous.modelTimestamp && (next.model || next.effort)) {
    merged.model = next.model || previous.model; merged.effort = next.effort || previous.effort; merged.modelTimestamp = next.modelTimestamp;
  }
  if (next.taskStatusTimestamp >= previous.taskStatusTimestamp && next.taskStatus !== 'unknown') {
    merged.taskStatus = next.taskStatus; merged.taskStatusTimestamp = next.taskStatusTimestamp;
    merged.activeTurnId = next.activeTurnId || previous.activeTurnId;
    merged.taskStartedTimestamp = Math.max(previous.taskStartedTimestamp || 0, next.taskStartedTimestamp || 0);
    merged.taskCompletedTimestamp = Math.max(previous.taskCompletedTimestamp || 0, next.taskCompletedTimestamp || 0);
  }
  if (next.latestTimestamp >= previous.latestTimestamp) {
    merged.latestTimestamp = next.latestTimestamp; merged.lastActivityType = next.lastActivityType || previous.lastActivityType;
  }
  return merged;
}

function getSessionMeta(filePath) {
  const event = safeJson(readFirstLine(filePath));
  const payload = event?.payload || {};
  return {
    id: payload.id || payload.session_id || path.basename(filePath),
    cwd: payload.cwd || '',
    timestamp: Date.parse(payload.timestamp || event?.timestamp || '') || 0,
    threadSource: typeof payload.thread_source === 'string' ? payload.thread_source : '',
    source: typeof payload.source === 'string' ? payload.source : '',
    originator: typeof payload.originator === 'string' ? payload.originator : ''
  };
}

function listJsonl(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(full);
    }
  }
  return result;
}

function planProgress(plan) {
  if (!plan?.length) return null;
  const completed = plan.filter((item) => item.status === 'completed').length;
  const activeIndex = plan.findIndex((item) => item.status === 'in_progress');
  return {
    percent: Math.round(((completed + (activeIndex >= 0 ? 0.5 : 0)) / plan.length) * 100),
    completed, total: plan.length,
    activeStep: activeIndex >= 0 ? plan[activeIndex].step : (completed === plan.length ? '全部步骤已完成' : plan[completed]?.step)
  };
}

function formatWindowLabel(minutes) {
  if (!minutes) return '用量窗口';
  if (minutes % 10080 === 0) return `${minutes / 10080}周窗口`;
  if (minutes % 1440 === 0) return `${minutes / 1440}天窗口`;
  if (minutes % 60 === 0) return `${minutes / 60}小时窗口`;
  return `${minutes}分钟窗口`;
}

function quotaWindows(rateLimits) {
  return ['primary', 'secondary'].flatMap((key) => {
    const value = rateLimits?.[key];
    if (!value) return [];
    const usedPercent = Math.max(0, Math.min(100, Number(value.used_percent || 0)));
    return [{ key, label: formatWindowLabel(Number(value.window_minutes || 0)), usedPercent, remainingPercent: 100 - usedPercent,
      windowMinutes: Number(value.window_minutes || 0), resetsAt: Number(value.resets_at || 0) * 1000 }];
  });
}

function lowestQuotaRemaining(windows) {
  const values = (windows || [])
    .map((window) => Number(window?.remainingPercent))
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function observedOutputSpeed(samples, now = Date.now()) {
  if (!samples?.length || now - samples.at(-1).timestamp > 120_000) return null;
  for (let index = samples.length - 1; index > 0; index -= 1) {
    const current = samples[index]; const previous = samples[index - 1];
    const seconds = (current.timestamp - previous.timestamp) / 1000;
    const delta = current.outputTokens - previous.outputTokens;
    if (seconds > 0.05 && seconds <= 300 && delta > 0) return Math.round((delta / seconds) * 10) / 10;
  }
  return null;
}

function sampleSeries(points, limit = 96) {
  if (points.length <= limit) return points;
  const sampled = [points[0]];
  for (let index = 1; index < limit - 1; index += 1) {
    sampled.push(points[Math.round(index * (points.length - 1) / (limit - 1))]);
  }
  sampled.push(points.at(-1));
  return sampled;
}

function resolveMascotState({ isDone, completedAt = 0, isWorking, remainingPercent, now = Date.now() }) {
  const completionAgeMs = isDone ? Math.max(0, now - Number(completedAt || 0)) : Infinity;
  if (isDone && completionAgeMs < 15_000) return 'done';
  if (remainingPercent != null && Number(remainingPercent) <= 10) return 'low';
  return isWorking ? 'working' : 'idle';
}

function buildProjectHistory(sessions, projectTotal) {
  const events = [];
  for (const session of sessions) {
    const sessionId = session.meta.id;
    const startedAt = session.meta.timestamp || session.stat.birthtimeMs || session.stat.mtimeMs;
    events.push({ timestamp: startedAt, sessionId, tokens: 0, kind: session.meta.threadSource === 'subagent' ? 'subagent' : 'task' });
    for (const sample of session.events.tokenSamples || []) {
      events.push({ timestamp: sample.timestamp, sessionId, tokens: Number(sample.totalTokens || 0), kind: session.meta.threadSource === 'subagent' ? 'subagent' : 'task' });
    }
    const finalTokens = Number(session.events.tokenUsage?.total_tokens || 0);
    if (finalTokens) events.push({ timestamp: session.events.tokenTimestamp || session.stat.mtimeMs, sessionId, tokens: finalTokens, kind: session.meta.threadSource === 'subagent' ? 'subagent' : 'task' });
  }
  events.sort((a, b) => a.timestamp - b.timestamp || a.tokens - b.tokens);
  const perSession = new Map();
  const points = [];
  let cumulative = 0;
  for (const event of events) {
    const previous = perSession.get(event.sessionId) || 0;
    if (event.tokens < previous) continue;
    cumulative += event.tokens - previous;
    perSession.set(event.sessionId, event.tokens);
    const priorPoint = points.at(-1);
    if (priorPoint?.timestamp === event.timestamp) priorPoint.totalTokens = cumulative;
    else points.push({ timestamp: event.timestamp, totalTokens: cumulative });
  }
  if (points.length && projectTotal > points.at(-1).totalTokens) {
    points.push({ timestamp: Math.max(...sessions.map(sessionActivity)), totalTokens: projectTotal });
  }
  const logs = [...sessions]
    .sort((a, b) => (b.meta.timestamp || b.stat.mtimeMs) - (a.meta.timestamp || a.stat.mtimeMs))
    .slice(0, 6)
    .map((session) => ({
      id: session.meta.id,
      timestamp: session.meta.timestamp || session.stat.mtimeMs,
      tokens: Number(session.events.tokenUsage?.total_tokens || 0),
      kind: session.meta.threadSource === 'subagent' ? 'subagent' : 'task'
    }));
  return { points: sampleSeries(points), logs };
}

function readCodexAppState(filePath) {
  const state = safeJson(fs.readFileSync(filePath, 'utf8')) || {};
  const selected = state['selected-project'] || null;
  const projectId = selected?.type === 'local' ? selected.projectId : null;
  const project = projectId ? state['local-projects']?.[projectId] : null;
  return {
    selectedProject: project ? { id: project.id || projectId, name: project.name || '未命名项目', rootPaths: Array.isArray(project.rootPaths) ? project.rootPaths : [] } : null,
    assignments: state['thread-project-assignments'] || {}
  };
}

function sessionActivity(session) {
  return Math.max(session.events.latestTimestamp || 0, session.stat.mtimeMs || 0, session.meta.timestamp || 0);
}

function belongsToProject(session, project, assignments) {
  if (!project) return false;
  if (assignments?.[session.meta.id]?.projectId === project.id) return true;
  const sessionPath = normalizePath(session.meta.cwd);
  return project.rootPaths.some((rootPath) => {
    const root = normalizePath(rootPath);
    return sessionPath === root || sessionPath.startsWith(`${root}${path.sep}`);
  });
}

class CodexMonitor {
  constructor(options = {}) {
    this.codexRoot = options.codexRoot || path.join(os.homedir(), '.codex');
    this.sessionsRoot = path.join(this.codexRoot, 'sessions');
    this.globalStatePath = path.join(this.codexRoot, '.codex-global-state.json');
    this.preferredProject = options.projectPath || process.env.CODEX_METER_PROJECT || '';
    this.cache = new Map();
    this.appStateCache = { mtimeMs: 0, value: { selectedProject: null, assignments: {} } };
    this.lastTokensByProject = new Map();
    this.projectHighWater = new Map();
    this.snapshotCache = null;
    this.snapshotRevision = 0;
  }

  parseFile(filePath, knownStat = null) {
    const stat = knownStat || fs.statSync(filePath);
    const cached = this.cache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.value;
    const meta = cached?.value?.meta || getSessionMeta(filePath);
    const canReadAppend = cached && stat.size >= cached.size;
    let nextEvents = parseEventsFromText(canReadAppend
      ? readRecentAppend(filePath, cached.size, stat.size)
      : readTail(filePath));
    // Quiet, very large sessions may not have a token_count event in the last
    // 4 MB. Widen the first scan so a cold start does not temporarily report 0.
    if (!cached && stat.size > TAIL_BYTES && !nextEvents.tokenUsage) {
      nextEvents = parseEventsFromText(readTail(filePath, Math.min(stat.size, 16 * 1024 * 1024)));
    }
    const previousEvents = cached && stat.size >= cached.size ? cached.value.events : null;
    const value = { filePath, stat, meta, events: mergeEventState(previousEvents, nextEvents) };
    this.cache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, value });
    return value;
  }

  getAppState() {
    if (this.preferredProject) return { selectedProject: { id: `path:${normalizePath(this.preferredProject)}`, name: path.basename(this.preferredProject), rootPaths: [this.preferredProject] }, assignments: {} };
    try {
      const stat = fs.statSync(this.globalStatePath);
      if (stat.mtimeMs !== this.appStateCache.mtimeMs) this.appStateCache = { mtimeMs: stat.mtimeMs, value: readCodexAppState(this.globalStatePath) };
    } catch { /* Preserve the last valid selection during atomic rewrites. */ }
    return this.appStateCache.value;
  }

  snapshot() {
    const files = listJsonl(this.sessionsRoot);
    const fileEntries = [];
    const liveFiles = new Set(files);
    let filesChanged = files.length !== this.cache.size;
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        const cached = this.cache.get(file);
        if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) filesChanged = true;
        fileEntries.push({ file, stat });
      } catch { filesChanged = true; }
    }
    for (const file of this.cache.keys()) {
      if (!liveFiles.has(file)) this.cache.delete(file);
    }
    const priorAppStateMtime = this.appStateCache.mtimeMs;
    const appState = this.getAppState();
    const appStateChanged = this.appStateCache.mtimeMs !== priorAppStateMtime;
    const now = Date.now();
    if (!filesChanged && !appStateChanged && this.snapshotCache && now - this.snapshotCache.createdAt < SNAPSHOT_REUSE_MS) {
      return this.snapshotCache.value;
    }
    const sessions = [];
    for (const { file, stat } of fileEntries) {
      try { sessions.push(this.parseFile(file, stat)); } catch { /* A file may be briefly locked. */ }
    }
    sessions.sort((a, b) => sessionActivity(b) - sessionActivity(a));
    const fallbackSession = sessions.find((session) => session.meta.threadSource !== 'subagent') || sessions[0] || null;
    const selectedProject = appState.selectedProject || (fallbackSession ? { id: `path:${normalizePath(fallbackSession.meta.cwd)}`, name: path.basename(fallbackSession.meta.cwd), rootPaths: [fallbackSession.meta.cwd] } : null);
    const projectSessions = sessions.filter((session) => belongsToProject(session, selectedProject, appState.assignments));
    // Never borrow usage from another project when the selected project is new.
    const sourceSessions = projectSessions;
    const userSessions = sourceSessions.filter((session) => session.meta.threadSource !== 'subagent');
    const current = userSessions[0] || sourceSessions[0] || null;
    const configuredSessions = userSessions.length ? userSessions : sourceSessions;
    const latestConfigured = configuredSessions
      .filter((session) => session.events.model || session.events.effort)
      .sort((left, right) => (right.events.modelTimestamp || 0) - (left.events.modelTimestamp || 0))[0] || null;

    const rawProjectUsage = sourceSessions.reduce((usage, session) => ({
      inputTokens: usage.inputTokens + Number(session.events.tokenUsage?.input_tokens || 0),
      outputTokens: usage.outputTokens + Number(session.events.tokenUsage?.output_tokens || 0),
      cachedTokens: usage.cachedTokens + Number(session.events.tokenUsage?.cached_input_tokens || 0),
      totalTokens: usage.totalTokens + Number(session.events.tokenUsage?.total_tokens || 0)
    }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 });
    const projectKey = selectedProject?.id || selectedProject?.rootPaths?.[0] || 'none';
    const priorHighWater = this.projectHighWater.get(projectKey) || {};
    const projectUsage = Object.fromEntries(Object.keys(rawProjectUsage).map((key) => [key, Math.max(rawProjectUsage[key], priorHighWater[key] || 0)]));
    this.projectHighWater.set(projectKey, projectUsage);
    const previousTotal = this.lastTokensByProject.get(projectKey) ?? projectUsage.totalTokens;
    const deltaTokens = Math.max(0, projectUsage.totalTokens - previousTotal);
    this.lastTokensByProject.set(projectKey, projectUsage.totalTokens);

    const latestRateSession = sessions.filter((session) => session.events.rateLimits).sort((a, b) => b.events.rateLimitsTimestamp - a.events.rateLimitsTimestamp)[0];
    const rateLimits = latestRateSession?.events.rateLimits || null;
    const windows = quotaWindows(rateLimits);
    const primaryWindow = windows.find((window) => window.key === 'primary') || windows[0] || null;
    const remainingPercent = primaryWindow?.remainingPercent ?? null;
    const lowRemainingPercent = lowestQuotaRemaining(windows);
    const rawProgress = planProgress(current?.events.plan);
    const ageMs = current ? Date.now() - sessionActivity(current) : Infinity;
    const hasActivePlan = Boolean(current?.events.plan?.some((item) => item.status === 'in_progress'));
    const hasLiveTurn = Boolean(current?.events.taskStartedTimestamp && current.events.taskStartedTimestamp > (current.events.taskCompletedTimestamp || 0));
    const isWorking = Boolean(current && !['done', 'idle'].includes(current.events.taskStatus)
      && (hasLiveTurn || ageMs < 90_000 || hasActivePlan));
    // Completion is authoritative only after Codex emits task_complete for the
    // latest turn. A completed plan alone cannot finish the mascot state.
    const isDone = Boolean(current?.events.taskStatus === 'done' && current.events.taskCompletedTimestamp >= current.events.taskStartedTimestamp);
    const progress = isDone
      ? { percent: 100, completed: rawProgress?.total || 1, total: rawProgress?.total || 1, activeStep: '当前任务已完成' }
      : rawProgress;
    const state = resolveMascotState({
      isDone,
      completedAt: current?.events.taskCompletedTimestamp || 0,
      isWorking,
      remainingPercent: lowRemainingPercent
    });
    const history = buildProjectHistory(sourceSessions, projectUsage.totalTokens);

    const snapshot = {
      ok: Boolean(current), timestamp: now, revision: ++this.snapshotRevision,
      project: { id: selectedProject?.id || null, path: selectedProject?.rootPaths?.[0] || current?.meta.cwd || '', name: selectedProject?.name || '未检测到项目', sessions: userSessions.length, allSessions: sourceSessions.length },
      state,
      task: { id: current?.meta.id || null, turnId: current?.events.activeTurnId || null, isWorking, isDone, progress,
        startedAt: current?.events.taskStartedTimestamp || 0, completedAt: current?.events.taskCompletedTimestamp || 0,
        activity: current?.events.lastActivityType || 'waiting', model: current?.events.model || latestConfigured?.events.model || null,
        effort: current?.events.effort || latestConfigured?.events.effort || null, speedTokensPerSecond: observedOutputSpeed(current?.events.tokenSamples),
        totalTokens: Number(current?.events.tokenUsage?.total_tokens || 0), lastTurnTokens: Number(current?.events.lastTokenUsage?.total_tokens || 0) },
      usage: { remainingPercent, usedPercent: primaryWindow?.usedPercent ?? 0, resetsAt: primaryWindow?.resetsAt ?? 0,
        lowRemainingPercent, windowMinutes: primaryWindow?.windowMinutes ?? 0, windowLabel: primaryWindow?.label || '用量窗口', windows,
        creditsBalance: rateLimits?.credits?.balance ?? null, totalTokens: projectUsage.totalTokens,
        currentTokens: Number(current?.events.tokenUsage?.total_tokens || 0), deltaTokens,
        inputTokens: projectUsage.inputTokens, outputTokens: projectUsage.outputTokens, cachedTokens: projectUsage.cachedTokens,
        history: history.points, historyLogs: history.logs },
      source: { kind: 'local-codex-session-logs', root: this.sessionsRoot, rateLimitTimestamp: latestRateSession?.events.rateLimitsTimestamp || 0,
        note: '额度来自账号级最新用量窗口；项目与任务 token 分别按 Codex 当前选中项目和当前会话统计。' }
    };
    this.snapshotCache = { createdAt: now, value: snapshot };
    return snapshot;
  }
}

module.exports = { CodexMonitor, normalizePath, parseEventsFromText, mergeEventState, planProgress, formatWindowLabel, quotaWindows, lowestQuotaRemaining, observedOutputSpeed, buildProjectHistory, readCodexAppState, belongsToProject, resolveMascotState };
