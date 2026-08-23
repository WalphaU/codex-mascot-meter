const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TAIL_BYTES = 4 * 1024 * 1024;
const FIRST_LINE_LIMIT = 6 * 1024 * 1024;

function normalizePath(value) {
  if (!value) return '';
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
  } finally {
    fs.closeSync(fd);
  }
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
  } finally {
    fs.closeSync(fd);
  }
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
    while ((match = itemPattern.exec(directInput))) {
      plan.push({ step: match[2], status: match[4] });
    }
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

function parseEventsFromText(text) {
  const parsed = {
    tokenUsage: null,
    rateLimits: null,
    plan: null,
    latestTimestamp: 0,
    lastActivityType: null,
    taskStarted: false,
    taskCompleted: false,
    model: null
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = safeJson(line);
    if (!event) continue;
    const timestamp = Date.parse(event.timestamp || event.payload?.timestamp || '') || 0;
    if (timestamp >= parsed.latestTimestamp) parsed.latestTimestamp = timestamp;
    const payload = event.payload || {};

    if (event.type === 'turn_context' && payload.model) parsed.model = payload.model;
    if (event.type === 'event_msg') {
      parsed.lastActivityType = payload.type || parsed.lastActivityType;
      if (payload.type === 'task_started') {
        parsed.taskStarted = true;
        parsed.taskCompleted = false;
      }
      if (['task_complete', 'task_completed', 'turn_aborted'].includes(payload.type)) {
        parsed.taskCompleted = true;
      }
      if (payload.type === 'token_count') {
        parsed.tokenUsage = payload.info?.total_token_usage || parsed.tokenUsage;
        parsed.rateLimits = payload.rate_limits || parsed.rateLimits;
      }
    }
    if (event.type === 'response_item') {
      const plan = parsePlan(payload);
      if (plan) parsed.plan = plan;
    }
  }
  return parsed;
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
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
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
  const fractional = activeIndex >= 0 ? 0.5 : 0;
  return {
    percent: Math.round(((completed + fractional) / plan.length) * 100),
    completed,
    total: plan.length,
    activeStep: activeIndex >= 0 ? plan[activeIndex].step : (completed === plan.length ? '全部步骤已完成' : plan[completed]?.step)
  };
}

class CodexMonitor {
  constructor(options = {}) {
    this.codexRoot = options.codexRoot || path.join(os.homedir(), '.codex');
    this.sessionsRoot = path.join(this.codexRoot, 'sessions');
    this.preferredProject = options.projectPath || process.env.CODEX_METER_PROJECT || '';
    this.cache = new Map();
    this.lastTokens = 0;
  }

  parseFile(filePath) {
    const stat = fs.statSync(filePath);
    const cached = this.cache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.value;
    const meta = cached?.value?.meta || getSessionMeta(filePath);
    const events = parseEventsFromText(readTail(filePath));
    const value = { filePath, stat, meta, events };
    this.cache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, value });
    return value;
  }

  snapshot() {
    const files = listJsonl(this.sessionsRoot);
    const sessions = [];
    for (const file of files) {
      try {
        sessions.push(this.parseFile(file));
      } catch {
        // A session can be temporarily locked while Codex appends a line.
      }
    }
    sessions.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const active = sessions[0] || null;
    const targetPath = this.preferredProject || active?.meta.cwd || '';
    const normalizedTarget = normalizePath(targetPath);
    const projectSessions = sessions.filter((session) => normalizePath(session.meta.cwd) === normalizedTarget);
    const sourceSessions = projectSessions.length ? projectSessions : (active ? [active] : []);
    const current = sourceSessions.find((session) => session.meta.threadSource !== 'subagent') || sourceSessions[0] || active;
    const totalTokens = sourceSessions.reduce((sum, session) => sum + Number(session.events.tokenUsage?.total_tokens || 0), 0);
    const currentTokens = Number(current?.events.tokenUsage?.total_tokens || 0);
    const deltaTokens = Math.max(0, totalTokens - this.lastTokens);
    this.lastTokens = totalTokens;
    const rateLimits = current?.events.rateLimits || sourceSessions.find((s) => s.events.rateLimits)?.events.rateLimits || null;
    const usedPercent = Number(rateLimits?.primary?.used_percent ?? 0);
    const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
    const progress = planProgress(current?.events.plan);
    const ageMs = current ? Date.now() - current.stat.mtimeMs : Infinity;
    const hasActivePlan = Boolean(current?.events.plan?.some((item) => item.status === 'in_progress'));
    const planIsDone = Boolean(current?.events.plan?.length && current.events.plan.every((item) => item.status === 'completed'));
    const isWorking = Boolean(current && !current.events.taskCompleted && (ageMs < 90_000 || hasActivePlan));
    const isDone = Boolean((current?.events.taskCompleted || planIsDone) && ageMs < 45_000);
    const state = remainingPercent <= 20 ? 'low' : isDone ? 'done' : isWorking ? 'working' : 'idle';

    return {
      ok: Boolean(current),
      timestamp: Date.now(),
      project: {
        path: targetPath,
        name: targetPath ? path.basename(targetPath) : '未检测到项目',
        sessions: sourceSessions.length
      },
      state,
      task: {
        isWorking,
        isDone,
        progress,
        activity: current?.events.lastActivityType || 'waiting',
        model: current?.events.model || null
      },
      usage: {
        remainingPercent,
        usedPercent,
        resetsAt: Number(rateLimits?.primary?.resets_at || 0) * 1000,
        windowMinutes: Number(rateLimits?.primary?.window_minutes || 0),
        creditsBalance: rateLimits?.credits?.balance ?? null,
        totalTokens,
        currentTokens,
        deltaTokens,
        inputTokens: sourceSessions.reduce((sum, s) => sum + Number(s.events.tokenUsage?.input_tokens || 0), 0),
        outputTokens: sourceSessions.reduce((sum, s) => sum + Number(s.events.tokenUsage?.output_tokens || 0), 0),
        cachedTokens: sourceSessions.reduce((sum, s) => sum + Number(s.events.tokenUsage?.cached_input_tokens || 0), 0)
      },
      source: {
        kind: 'local-codex-session-logs',
        root: this.sessionsRoot,
        note: '余额表示 Codex 当前用量窗口的剩余百分比；项目总消耗为本机日志中的 token 累计。'
      }
    };
  }
}

module.exports = {
  CodexMonitor,
  normalizePath,
  parseEventsFromText,
  planProgress
};
