const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexMonitor, normalizePath, parseEventsFromText, mergeEventState, planProgress, quotaWindows, lowestQuotaRemaining, observedOutputSpeed, buildProjectHistory, readCodexAppState, belongsToProject, resolveMascotState } = require('../electron/codex-monitor-v2.cjs');

test('normalizes Windows paths for project matching', () => {
  assert.equal(normalizePath('C:\\Work\\Demo\\'), normalizePath('c:/work/demo'));
});

test('extracts token totals, rate limits, and plan progress', () => {
  const lines = [
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 1200, input_tokens: 1000 } }, rate_limits: { primary: { used_percent: 25, resets_at: 123 } } } },
    { type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [
      { step: '读取数据', status: 'completed' },
      { step: '绘制界面', status: 'in_progress' },
      { step: '验证', status: 'pending' }
    ] }) } }
  ].map(JSON.stringify).join('\n');
  const parsed = parseEventsFromText(lines);
  assert.equal(parsed.tokenUsage.total_tokens, 1200);
  assert.equal(parsed.rateLimits.primary.used_percent, 25);
  assert.equal(parsed.plan[1].status, 'in_progress');
  assert.deepEqual(planProgress(parsed.plan), { percent: 50, completed: 1, total: 3, activeStep: '绘制界面' });
});

test('completed plans report all steps complete', () => {
  assert.deepEqual(planProgress([
    { step: 'A', status: 'completed' },
    { step: 'B', status: 'completed' }
  ]), { percent: 100, completed: 2, total: 2, activeStep: '全部步骤已完成' });
});

test('extracts a plan nested in an exec orchestration call', () => {
  const parsed = parseEventsFromText(JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'await tools.update_plan({plan:[{step:"完成读取",status:"completed"},{step:"构建界面",status:"in_progress"}]});'
    }
  }));
  assert.deepEqual(parsed.plan, [
    { step: '完成读取', status: 'completed' },
    { step: '构建界面', status: 'in_progress' }
  ]);
});

test('does not mistake update_plan text inside another tool call for live progress', () => {
  const parsed = parseEventsFromText(JSON.stringify({
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      input: 'const patch = "await tools.update_plan({plan:[{step:`假计划`,status:`in_progress`}]})"; await tools.apply_patch(patch);'
    }
  }));
  assert.equal(parsed.plan, null);
});

test('preserves cumulative token high-water when a later tail has no usage event', () => {
  const previous = parseEventsFromText(JSON.stringify({
    timestamp: '2026-08-21T00:00:01Z', type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 4200, output_tokens: 300 } } }
  }));
  const next = parseEventsFromText(JSON.stringify({
    timestamp: '2026-08-21T00:00:02Z', type: 'event_msg', payload: { type: 'agent_message' }
  }));
  assert.equal(mergeEventState(previous, next).tokenUsage.total_tokens, 4200);
});

test('reads the latest Codex model and reasoning effort from applied thread settings', () => {
  const parsed = parseEventsFromText([
    { timestamp: '2026-08-21T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-old', effort: 'low' } },
    { timestamp: '2026-08-21T00:00:02Z', type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-new', reasoning_effort: 'xhigh' } } }
  ].map(JSON.stringify).join('\n'));
  assert.equal(parsed.model, 'gpt-new');
  assert.equal(parsed.effort, 'xhigh');
});

test('retains the most recent valid project model settings when the newest session has none yet', () => {
  const codexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-meter-settings-'));
  const sessionsRoot = path.join(codexRoot, 'sessions', '2026', '08', '21');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const projectPath = 'C:\\Work\\Settings';
  fs.writeFileSync(path.join(sessionsRoot, 'older.jsonl'), [
    { timestamp: '2026-08-21T01:00:00Z', type: 'session_meta', payload: { id: 'older', cwd: projectPath, timestamp: '2026-08-21T01:00:00Z' } },
    { timestamp: '2026-08-21T01:00:01Z', type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-remembered', reasoning_effort: 'high' } } }
  ].map(JSON.stringify).join('\n'));
  fs.writeFileSync(path.join(sessionsRoot, 'newer.jsonl'), [
    { timestamp: '2026-08-21T02:00:00Z', type: 'session_meta', payload: { id: 'newer', cwd: projectPath, timestamp: '2026-08-21T02:00:00Z' } },
    { timestamp: '2026-08-21T02:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'new-turn' } }
  ].map(JSON.stringify).join('\n'));
  const snapshot = new CodexMonitor({ codexRoot, projectPath }).snapshot();
  assert.equal(snapshot.task.id, 'newer');
  assert.equal(snapshot.task.model, 'gpt-remembered');
  assert.equal(snapshot.task.effort, 'high');
});

test('converts account rate limits to remaining percentages and window labels', () => {
  assert.deepEqual(quotaWindows({ primary: { used_percent: 18, window_minutes: 10080, resets_at: 10 } })[0], {
    key: 'primary', label: '1周窗口', usedPercent: 18, remainingPercent: 82, windowMinutes: 10080, resetsAt: 10000
  });
  const windows = quotaWindows({
    primary: { used_percent: 18, window_minutes: 300, resets_at: 10 },
    secondary: { used_percent: 91, window_minutes: 10080, resets_at: 20 }
  });
  assert.deepEqual(windows.map((window) => window.label), ['5小时窗口', '1周窗口']);
  assert.equal(lowestQuotaRemaining(windows), 9);
});

test('computes recent observed output speed and rejects stale samples', () => {
  const now = Date.parse('2026-08-21T00:01:00Z');
  const samples = [
    { timestamp: now - 2000, outputTokens: 100 },
    { timestamp: now - 1000, outputTokens: 175 }
  ];
  assert.equal(observedOutputSpeed(samples, now), 75);
  assert.equal(observedOutputSpeed(samples, now + 121000), null);
});

test('reads exact selected Codex project and assignment membership', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-meter-test-'));
  const statePath = path.join(temp, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    'selected-project': { type: 'local', projectId: 'p1' },
    'local-projects': { p1: { id: 'p1', name: '精确项目名', rootPaths: ['C:\\Work\\Exact'] } },
    'thread-project-assignments': { sessionA: { projectId: 'p1' } }
  }));
  const state = readCodexAppState(statePath);
  assert.equal(state.selectedProject.name, '精确项目名');
  assert.equal(belongsToProject({ meta: { id: 'sessionA', cwd: 'C:\\Elsewhere' } }, state.selectedProject, state.assignments), true);
  assert.equal(belongsToProject({ meta: { id: 'sessionB', cwd: 'C:\\Work\\Exact\\child' } }, state.selectedProject, state.assignments), true);
});

test('a new task start clears the previous completed plan and wins the lifecycle state', () => {
  const previous = parseEventsFromText([
    { timestamp: '2026-08-21T00:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'old' } },
    { timestamp: '2026-08-21T00:00:02Z', type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: '旧任务', status: 'completed' }] }) } },
    { timestamp: '2026-08-21T00:00:03Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'old' } }
  ].map(JSON.stringify).join('\n'));
  const next = parseEventsFromText(JSON.stringify({ timestamp: '2026-08-21T00:01:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'new' } }));
  const merged = mergeEventState(previous, next);
  assert.equal(merged.taskStatus, 'working');
  assert.equal(merged.activeTurnId, 'new');
  assert.equal(merged.plan, null);
  assert.ok(merged.taskStartedTimestamp > merged.taskCompletedTimestamp);
});

test('project history merges prior log samples into a monotonic cumulative trend', () => {
  const sessions = [
    { meta: { id: 'main', timestamp: 1000, threadSource: '' }, stat: { mtimeMs: 3000 }, events: { tokenTimestamp: 3000, tokenUsage: { total_tokens: 120 }, tokenSamples: [{ timestamp: 2000, totalTokens: 50 }, { timestamp: 3000, totalTokens: 120 }] } },
    { meta: { id: 'sub', timestamp: 1500, threadSource: 'subagent' }, stat: { mtimeMs: 2500 }, events: { tokenTimestamp: 2500, tokenUsage: { total_tokens: 80 }, tokenSamples: [{ timestamp: 2500, totalTokens: 80 }] } }
  ];
  const history = buildProjectHistory(sessions, 200);
  assert.equal(history.points.at(-1).totalTokens, 200);
  assert.deepEqual(history.logs.map((item) => item.kind).sort(), ['subagent', 'task']);
  assert.equal(history.points.every((point, index) => !index || point.totalTokens >= history.points[index - 1].totalTokens), true);
});

test('completed mascot expires after 15 seconds and falls back to quota-aware idle state', () => {
  const completedAt = 1_000_000;
  assert.equal(resolveMascotState({ isDone: true, completedAt, isWorking: false, remainingPercent: 10, now: completedAt + 14_999 }), 'done');
  assert.equal(resolveMascotState({ isDone: true, completedAt, isWorking: false, remainingPercent: 10, now: completedAt + 15_000 }), 'low');
  assert.equal(resolveMascotState({ isDone: true, completedAt, isWorking: false, remainingPercent: 11, now: completedAt + 15_000 }), 'idle');
  assert.equal(resolveMascotState({ isDone: true, completedAt, isWorking: false, remainingPercent: 80, now: completedAt + 15_000 }), 'idle');
});

test('monitor reuses an unchanged snapshot and incrementally reads appended log events', () => {
  const codexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-meter-incremental-'));
  const sessionsRoot = path.join(codexRoot, 'sessions', '2026', '08', '21');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const projectPath = 'C:\\Work\\Incremental';
  const sessionPath = path.join(sessionsRoot, 'session.jsonl');
  const initialEvents = [
    { timestamp: '2026-08-21T01:00:00Z', type: 'session_meta', payload: { id: 'incremental-session', cwd: projectPath, timestamp: '2026-08-21T01:00:00Z' } },
    { timestamp: '2026-08-21T01:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-08-21T01:00:02Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 100, output_tokens: 10 } } } }
  ];
  fs.writeFileSync(sessionPath, `${initialEvents.map(JSON.stringify).join('\n')}\n`);
  const monitor = new CodexMonitor({ codexRoot, projectPath });
  const first = monitor.snapshot();
  const reused = monitor.snapshot();
  assert.equal(reused, first);
  fs.appendFileSync(sessionPath, `${JSON.stringify({ timestamp: '2026-08-21T01:00:03Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 250, output_tokens: 30 } } } })}\n`);
  const updated = monitor.snapshot();
  assert.notEqual(updated.revision, first.revision);
  assert.equal(updated.task.totalTokens, 250);
  assert.equal(updated.usage.totalTokens, 250);
});
