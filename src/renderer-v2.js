const bridge = window.codexMeter || {
  getSnapshot: async () => null,
  onSnapshot: () => () => {},
  minimize: () => {},
  close: () => {},
  setMode: () => {}
};

const $ = (id) => document.getElementById(id);
const widget = document.querySelector('.widget');
const detailPanel = document.querySelector('.detail-panel');
const compactHud = document.querySelector('.compact-hud');
const compactToolbar = document.querySelector('.compact-toolbar');
const circumference = 2 * Math.PI * 68;
let currentMode = 'compact';
let latestSnapshot = null;
let completionDismissedKey = null;
let completionTimer = null;
let chartLevel = 'daily';
let selectedDayKey = null;
let chartProjectKey = null;
let chartNavigationChanged = false;
let lastChartRenderKey = '';
let chartPoints = [];

const numberFormat = new Intl.NumberFormat('zh-CN');
const compactFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });

function formatTokens(value, compact = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return compact && Math.abs(number) >= 10_000 ? compactFormat.format(number) : numberFormat.format(Math.round(number));
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function setMode(nextMode) {
  const next = nextMode === 'detail' ? 'detail' : 'compact';
  if (currentMode === next) return;
  currentMode = next;
  widget.dataset.mode = next;
  const isDetail = next === 'detail';
  detailPanel.setAttribute('aria-hidden', String(!isDetail));
  compactHud.setAttribute('aria-hidden', String(isDetail));
  compactToolbar.setAttribute('aria-hidden', String(isDetail));
  $('petButton').setAttribute('aria-label', isDetail ? 'Codex 桌面宠物' : '打开 Codex 项目详细面板');
  $('compactModeButton').tabIndex = isDetail ? -1 : 0;
  $('compactCloseButton').tabIndex = isDetail ? -1 : 0;
  for (const button of detailPanel.querySelectorAll('button')) button.tabIndex = isDetail ? 0 : -1;
  bridge.setMode(next);
}

function stateCopy(snapshot, state) {
  if (state === 'low') return { compact: '余额偏低', label: '额度提醒', step: '当前用量窗口余额不足 20%' };
  if (state === 'done') return { compact: '刚刚完成', label: '任务完成', step: snapshot.task?.progress?.activeStep || '当前任务已完成' };
  if (state === 'working') return { compact: '工作中', label: '正在执行', step: snapshot.task?.progress?.activeStep || 'Codex 正在处理当前任务' };
  return { compact: '待机', label: '等待任务', step: '等待 Codex 开始任务' };
}

function completionKey(snapshot) {
  const task = snapshot?.task || {};
  return String(task.turnId || task.completedAt || task.id || 'completed-task');
}

function lowQuotaFallback(snapshot) {
  const remaining = snapshot?.usage?.remainingPercent;
  return remaining != null && Number(remaining) <= 20 ? 'low' : 'idle';
}

function resolveVisualState(snapshot) {
  const task = snapshot?.task || {};
  if (!task.isDone) return snapshot?.state || 'idle';
  const key = completionKey(snapshot);
  const completedAt = Number(task.completedAt) || 0;
  const age = completedAt ? Date.now() - completedAt : Infinity;
  if (completionDismissedKey === key || age >= 15_000) return lowQuotaFallback(snapshot);
  return 'done';
}

function scheduleCompletionExpiry(snapshot, state) {
  if (completionTimer) clearTimeout(completionTimer);
  completionTimer = null;
  if (state !== 'done') return;
  const remaining = Math.max(0, 15_000 - (Date.now() - Number(snapshot.task?.completedAt || 0)));
  completionTimer = setTimeout(() => {
    completionTimer = null;
    if (latestSnapshot) render(latestSnapshot);
  }, remaining + 20);
}

function dismissCompletionState() {
  if (!latestSnapshot?.task?.isDone) return;
  completionDismissedKey = completionKey(latestSnapshot);
  if (completionTimer) clearTimeout(completionTimer);
  completionTimer = null;
  render(latestSnapshot);
}

function formatCountdown(resetsAt) {
  const remaining = Number(resetsAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return '等待窗口刷新';
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}天 ${hours}小时`;
  if (hours) return `${hours}小时 ${mins}分`;
  return `${Math.max(1, mins)}分钟`;
}

function effortLabel(effort) {
  return ({ none: '无', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' })[String(effort || '').toLowerCase()] || (effort || '—');
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function formatChartDate(timestamp, withTime = false) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', withTime
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { month: '2-digit', day: '2-digit' });
}

function dayKey(timestamp) {
  const date = new Date(Number(timestamp));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatChartTime(timestamp) {
  return new Date(Number(timestamp)).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatFullDay(key) {
  const [year, month, day] = String(key || '').split('-');
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : '当日';
}

function formatShortDay(key) {
  const [, month, day] = String(key || '').split('-');
  return month && day ? `${Number(month)}月${Number(day)}日` : '当日';
}

function showChartTooltip(point, x, y, level) {
  const tooltip = $('chartTooltip');
  const viewport = $('chartViewport');
  $('tooltipTime').textContent = level === 'daily' ? formatFullDay(point.key) : formatChartDate(point.timestamp, true);
  $('tooltipValue').textContent = `${level === 'daily' ? '当日总消耗' : '时间段消耗'} ${formatTokens(point.delta, false)} tokens`;
  $('tooltipDelta').textContent = `当时累计 ${formatTokens(point.totalTokens, false)}`;
  const visibleX = x - viewport.scrollLeft;
  tooltip.style.left = `${Math.max(58, Math.min(viewport.clientWidth - 58, visibleX))}px`;
  tooltip.style.top = `${Math.max(16, y / 90 * 86)}px`;
  tooltip.hidden = false;
}

function hideChartTooltip() {
  $('chartTooltip').hidden = true;
}

function syncChartScrollControls() {
  const viewport = $('chartViewport');
  const slider = $('historySlider');
  const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  slider.disabled = maxScroll === 0;
  slider.value = maxScroll ? String(Math.round(viewport.scrollLeft / maxScroll * 1000)) : '1000';
  $('scrollLeftButton').disabled = maxScroll === 0 || viewport.scrollLeft <= 1;
  $('scrollRightButton').disabled = maxScroll === 0 || maxScroll - viewport.scrollLeft <= 1;
  const chart = $('pulseChart');
  const viewBoxWidth = chart.viewBox.baseVal.width || chart.getBoundingClientRect().width || 1;
  const scaleX = chart.getBoundingClientRect().width / viewBoxWidth || 1;
  $('chartYAxis').setAttribute('transform', `translate(${viewport.scrollLeft / scaleX},0)`);
}

function makeIntervals(series) {
  return series.map((point, index) => ({
    ...point,
    key: dayKey(point.timestamp),
    delta: Math.max(0, point.totalTokens - (series[index - 1]?.totalTokens || 0))
  })).filter((point, index) => index > 0 && point.delta > 0);
}

function aggregateDaily(intervals) {
  const days = new Map();
  for (const point of intervals) {
    const existing = days.get(point.key) || { key: point.key, timestamp: point.timestamp, endTimestamp: point.timestamp, delta: 0, totalTokens: point.totalTokens };
    existing.delta += point.delta;
    existing.endTimestamp = Math.max(existing.endTimestamp, point.timestamp);
    existing.totalTokens = Math.max(existing.totalTokens, point.totalTokens);
    days.set(point.key, existing);
  }
  return [...days.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function drawChart(history, logs, total, delta) {
  let series = Array.isArray(history) ? history
    .map((point) => ({ timestamp: Number(point.timestamp), totalTokens: Number(point.totalTokens) }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.totalTokens)) : [];
  if (!series.length && Number(total)) series = [{ timestamp: Date.now(), totalTokens: Number(total) }];
  const logItems = Array.isArray(logs) ? logs : [];
  const renderKey = [
    chartLevel,
    selectedDayKey || '',
    Number(total) || 0,
    Number(delta) || 0,
    series.map((point) => `${point.timestamp}:${point.totalTokens}`).join(','),
    logItems.map((log) => `${log.id || ''}:${log.timestamp || 0}:${log.tokens || 0}:${log.kind || ''}`).join(',')
  ].join('|');
  if (renderKey === lastChartRenderKey) return;
  lastChartRenderKey = renderKey;
  const intervals = makeIntervals(series);
  if (!intervals.length && series.length) intervals.push({ ...series.at(-1), key: dayKey(series.at(-1).timestamp), delta: Math.max(0, series.at(-1).totalTokens) });
  const dailyBars = aggregateDaily(intervals);
  if (chartLevel === 'intraday' && !dailyBars.some((point) => point.key === selectedDayKey)) {
    chartLevel = 'daily';
    selectedDayKey = null;
  }
  const displayData = chartLevel === 'intraday'
    ? intervals.filter((point) => point.key === selectedDayKey)
    : dailyBars;
  const pulseCard = document.querySelector('.pulse-card');
  pulseCard.dataset.chartLevel = chartLevel;
  $('chartBackButton').hidden = chartLevel === 'daily';
  $('pulseTitle').textContent = chartLevel === 'daily' ? '项目每日 token 消耗' : `${formatShortDay(selectedDayKey)} · 分时消耗`;
  $('chartLegendLabel').textContent = chartLevel === 'daily' ? '每柱为当日总消耗' : '每柱为日志时间段消耗';

  const viewport = $('chartViewport');
  const priorMaxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const followLatest = chartNavigationChanged || priorMaxScroll === 0 || priorMaxScroll - viewport.scrollLeft < 10;
  const slotWidth = chartLevel === 'daily' ? 48 : 27;
  const canvasWidth = Math.max(352, 48 + displayData.length * slotWidth);
  const plot = { left: 34, right: canvasWidth - 5, top: 6, bottom: 69 };
  const slot = (plot.right - plot.left) / Math.max(1, displayData.length);
  const barWidth = Math.min(chartLevel === 'daily' ? 24 : 15, Math.max(8, slot * .55));
  const maxDelta = Math.max(1, ...displayData.map((point) => point.delta));
  const bars = displayData.map((point, index) => {
    const x = plot.left + slot * index + slot / 2;
    const y = plot.bottom - point.delta / maxDelta * (plot.bottom - plot.top);
    return { ...point, index, x, y, height: plot.bottom - y };
  });
  chartPoints = bars;

  $('pulseChart').setAttribute('viewBox', `0 0 ${canvasWidth} 90`);
  $('pulseChart').setAttribute('width', canvasWidth);
  $('pulseChart').setAttribute('height', 90);

  $('chartGrid').replaceChildren();
  $('chartYAxis').replaceChildren();
  $('chartXAxis').replaceChildren();
  $('chartBars').replaceChildren();
  $('chartYAxis').append(svgElement('rect', { class: 'axis-backdrop', x: 0, y: 0, width: plot.left, height: plot.bottom + 1 }));
  $('chartYAxis').append(svgElement('path', { class: 'axis-edge', d: `M${plot.left} ${plot.top}V${plot.bottom}` }));
  for (const ratio of [0, .5, 1]) {
    const y = plot.top + ratio * (plot.bottom - plot.top);
    $('chartGrid').append(svgElement('path', { d: `M${plot.left} ${y}H${plot.right}` }));
    const label = svgElement('text', { x: plot.left - 5, y: y + 2.5 });
    label.textContent = formatTokens(maxDelta * (1 - ratio));
    $('chartYAxis').append(label);
  }
  const labelEvery = Math.max(1, Math.ceil(34 / Math.max(1, slot)));
  bars.forEach((point, index) => {
    if (index % labelEvery !== 0 && index !== bars.length - 1) return;
    const x = point.x;
    const label = svgElement('text', { x, y: 84 });
    label.textContent = chartLevel === 'daily' ? formatChartDate(point.timestamp) : formatChartTime(point.timestamp);
    $('chartXAxis').append(label);
  });
  for (const point of bars) {
    const group = svgElement('g', { class: `chart-bar${point.index === bars.length - 1 ? ' latest' : ''}`, tabindex: '0', role: chartLevel === 'daily' ? 'button' : 'img', 'data-index': point.index,
      'aria-label': chartLevel === 'daily'
        ? `${formatFullDay(point.key)}，总消耗 ${formatTokens(point.delta, false)} tokens，按下查看当日分时数据`
        : `${formatChartDate(point.timestamp, true)}，该时间段消耗 ${formatTokens(point.delta, false)} tokens，当时累计 ${formatTokens(point.totalTokens, false)}` });
    group.append(svgElement('rect', { class: 'chart-bar-hit', x: point.x - Math.max(12, slot / 2), y: plot.top, width: Math.max(24, slot), height: plot.bottom - plot.top }));
    group.append(svgElement('rect', { class: 'chart-bar-value', x: point.x - barWidth / 2, y: point.y, width: barWidth, height: Math.max(1, point.height), rx: '2' }));
    if (point.index === bars.length - 1 || point.delta === maxDelta) {
      const label = svgElement('text', { class: 'chart-bar-label', x: point.x, y: Math.max(5, point.y - 2) });
      label.textContent = formatTokens(point.delta);
      group.append(label);
    }
    $('chartBars').append(group);
  }

  const selectedAdded = displayData.reduce((sum, point) => sum + point.delta, 0);
  const last = chartLevel === 'daily'
    ? series.at(-1)?.totalTokens || Number(total) || 0
    : displayData.at(-1)?.totalTokens || 0;
  const first = chartLevel === 'daily' ? series[0]?.totalTokens || 0 : Math.max(0, last - selectedAdded);
  $('historyStartValue').textContent = formatTokens(first);
  $('historyAddedValue').textContent = `+${formatTokens(chartLevel === 'daily' ? Math.max(0, last - first) : selectedAdded)}`;
  $('historyCurrentValue').textContent = formatTokens(last);
  $('historyRange').textContent = chartLevel === 'daily'
    ? (dailyBars.length ? `${formatChartDate(dailyBars[0].timestamp)}—${formatChartDate(dailyBars.at(-1).timestamp)} · ${dailyBars.length} 天` : '尚无每日消耗数据')
    : (displayData.length ? `${formatChartTime(displayData[0].timestamp)}—${formatChartTime(displayData.at(-1).timestamp)} · ${displayData.length} 个时间段` : '当日暂无分时数据');
  $('chartSummary').textContent = chartLevel === 'daily'
    ? `当前项目共记录 ${dailyBars.length} 天的 token 消耗，当前累计 ${numberFormat.format(last)} tokens。点击任意日期可查看当日分时数据。`
    : `${formatFullDay(selectedDayKey)}共记录 ${displayData.length} 个时间段，消耗 ${numberFormat.format(selectedAdded)} tokens。`;

  $('historyLogCount').textContent = `${logItems.length} 条`;
  $('historyLogList').replaceChildren();
  for (const log of logItems) {
    const row = document.createElement('div');
    row.className = 'history-log-item';
    row.dataset.kind = log.kind || 'task';
    const marker = document.createElement('i');
    marker.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `${log.kind === 'subagent' ? '子会话' : '主任务'} · ${formatChartDate(log.timestamp, true)}`;
    const value = document.createElement('strong');
    value.textContent = formatTokens(log.tokens);
    value.title = `${formatTokens(log.tokens, false)} tokens`;
    row.append(marker, label, value);
    $('historyLogList').append(row);
  }
  $('deltaBadge').textContent = `本次 +${formatTokens(Number(delta) || 0)}`;

  requestAnimationFrame(() => {
    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (followLatest) viewport.scrollLeft = maxScroll;
    syncChartScrollControls();
    chartNavigationChanged = false;
  });
}

function render(snapshot) {
  if (!snapshot) return;
  latestSnapshot = snapshot;
  const project = snapshot.project || {};
  const task = snapshot.task || {};
  const usage = snapshot.usage || {};
  const projectName = project.name || '未检测到 Codex 项目';
  const projectKey = project.id || project.path || projectName;
  if (chartProjectKey !== projectKey) {
    chartProjectKey = projectKey;
    chartLevel = 'daily';
    selectedDayKey = null;
    chartNavigationChanged = true;
    lastChartRenderKey = '';
  }
  const visualState = resolveVisualState(snapshot);
  scheduleCompletionExpiry(snapshot, visualState);
  widget.dataset.state = ['idle', 'working', 'low', 'done'].includes(visualState) ? visualState : 'idle';
  const copy = stateCopy(snapshot, visualState);
  const taskVisuallyDone = visualState === 'done';
  const taskVisuallyWorking = visualState === 'working';
  const progress = taskVisuallyDone || taskVisuallyWorking ? task.progress : null;
  const taskPercent = progress ? clamp(progress.percent) : (taskVisuallyDone ? 100 : 0);
  const indeterminate = Boolean(taskVisuallyWorking && !progress);
  const quotaKnown = Number.isFinite(Number(usage.remainingPercent)) && usage.remainingPercent !== null;
  const remaining = quotaKnown ? clamp(usage.remainingPercent) : null;
  const windowLabel = usage.windowLabel || '用量窗口';

  $('projectName').textContent = projectName;
  $('projectName').title = project.path || projectName;
  $('compactProjectName').textContent = projectName;
  $('compactProjectName').title = project.path || projectName;
  $('compactState').textContent = copy.compact;

  $('compactTaskLabel').textContent = progress?.activeStep || (taskVisuallyWorking ? '当前任务处理中' : '任务进度');
  $('compactTaskValue').textContent = progress ? `${taskPercent}%` : taskVisuallyWorking ? '进行中' : taskVisuallyDone ? '完成' : '待机';
  $('compactTaskBar').style.width = `${taskPercent}%`;
  $('compactTaskBar').classList.toggle('is-indeterminate', indeterminate);
  $('compactQuotaLabel').textContent = `${windowLabel}余额`;
  $('compactQuotaValue').textContent = remaining == null ? '—' : `${Math.round(remaining)}%`;
  $('compactQuotaBar').style.width = `${remaining ?? 0}%`;

  $('quotaTitle').textContent = '窗口余额';
  $('quotaValue').textContent = remaining == null ? '—' : `${Math.round(remaining)}%`;
  $('quotaWindowLabel').textContent = windowLabel;
  $('quotaArc').style.strokeDasharray = circumference;
  $('quotaArc').style.strokeDashoffset = remaining == null ? circumference : circumference * (1 - remaining / 100);

  $('stateLabel').textContent = copy.label;
  $('activeStep').textContent = copy.step;
  $('activeStep').title = copy.step;
  $('progressPercent').textContent = progress ? `${taskPercent}%` : taskVisuallyWorking ? 'LIVE' : '—';
  $('progressBar').style.width = `${taskPercent}%`;
  $('progressBar').classList.toggle('is-indeterminate', indeterminate);

  $('totalTokens').textContent = formatTokens(usage.totalTokens);
  $('totalTokens').title = `${formatTokens(usage.totalTokens, false)} tokens`;
  $('currentTokens').textContent = formatTokens(task.totalTokens ?? usage.currentTokens);
  $('currentTokens').title = `${formatTokens(task.totalTokens ?? usage.currentTokens, false)} tokens`;
  $('sessionCount').textContent = `${Number(project.sessions) || 0} 个任务 / ${Number(project.allSessions) || Number(project.sessions) || 0} 个会话`;
  const input = Number(usage.inputTokens) || 0;
  const cached = Number(usage.cachedTokens) || 0;
  $('cacheRate').textContent = input ? `${Math.round(cached / input * 100)}%` : '—';
  $('cacheRate').title = input ? `${formatTokens(cached, false)} / ${formatTokens(input, false)} tokens` : '';

  const delta = Number(usage.deltaTokens) || 0;
  drawChart(usage.history, usage.historyLogs, usage.totalTokens, delta);
  $('resetCountdown').textContent = formatCountdown(usage.resetsAt);
  $('modelName').textContent = task.model || '—';
  $('modelName').title = task.model || '';
  $('effortValue').textContent = effortLabel(task.effort);
  const speed = Number(task.speedTokensPerSecond);
  $('speedValue').textContent = Number.isFinite(speed) && speed > 0 ? `${speed.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} tok/s` : '待机';
  $('lastUpdated').textContent = `更新于 ${new Date(snapshot.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })}`;
}

$('petButton').addEventListener('click', () => {
  dismissCompletionState();
  if (currentMode === 'compact') setMode('detail');
});
$('compactModeButton').addEventListener('click', () => setMode('detail'));
$('modeButton').addEventListener('click', () => setMode('compact'));
$('compactCloseButton').addEventListener('click', () => bridge.close());
$('closeButton').addEventListener('click', () => bridge.close());
$('minimizeButton').addEventListener('click', () => bridge.minimize());

const chartViewport = $('chartViewport');
const historySlider = $('historySlider');
const chartBarsRoot = $('chartBars');

function chartBarFromEvent(event) {
  const group = event.target?.closest?.('.chart-bar');
  return group && chartBarsRoot.contains(group) ? group : null;
}

function chartPointFromGroup(group) {
  return group ? chartPoints[Number(group.dataset.index)] || null : null;
}

function drillDownChartPoint(point) {
  if (!point || chartLevel !== 'daily') return;
  chartLevel = 'intraday';
  selectedDayKey = point.key;
  chartNavigationChanged = true;
  if (latestSnapshot) render(latestSnapshot);
}

chartBarsRoot.addEventListener('mouseover', (event) => {
  const group = chartBarFromEvent(event);
  if (!group || group === event.relatedTarget?.closest?.('.chart-bar')) return;
  const point = chartPointFromGroup(group);
  if (point) showChartTooltip(point, point.x, point.y, chartLevel);
});
chartBarsRoot.addEventListener('mouseout', (event) => {
  const group = chartBarFromEvent(event);
  if (!group || group === event.relatedTarget?.closest?.('.chart-bar')) return;
  hideChartTooltip();
});
chartBarsRoot.addEventListener('focusin', (event) => {
  const point = chartPointFromGroup(chartBarFromEvent(event));
  if (!point) return;
  chartViewport.scrollLeft = Math.max(0, point.x - chartViewport.clientWidth / 2);
  showChartTooltip(point, point.x, point.y, chartLevel);
});
chartBarsRoot.addEventListener('focusout', hideChartTooltip);
chartBarsRoot.addEventListener('click', (event) => drillDownChartPoint(chartPointFromGroup(chartBarFromEvent(event))));
chartBarsRoot.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const point = chartPointFromGroup(chartBarFromEvent(event));
  if (!point || chartLevel !== 'daily') return;
  event.preventDefault();
  drillDownChartPoint(point);
});

historySlider.addEventListener('input', () => {
  const maxScroll = Math.max(0, chartViewport.scrollWidth - chartViewport.clientWidth);
  chartViewport.scrollLeft = Number(historySlider.value) / 1000 * maxScroll;
});
chartViewport.addEventListener('scroll', () => {
  syncChartScrollControls();
  hideChartTooltip();
}, { passive: true });
chartViewport.addEventListener('wheel', (event) => {
  const maxScroll = Math.max(0, chartViewport.scrollWidth - chartViewport.clientWidth);
  if (!maxScroll || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  chartViewport.scrollLeft += event.deltaY;
  event.preventDefault();
}, { passive: false });
$('scrollLeftButton').addEventListener('click', () => {
  chartViewport.scrollLeft = Math.max(0, chartViewport.scrollLeft - 96);
});
$('scrollRightButton').addEventListener('click', () => {
  const maxScroll = Math.max(0, chartViewport.scrollWidth - chartViewport.clientWidth);
  chartViewport.scrollLeft = Math.min(maxScroll, chartViewport.scrollLeft + 96);
});
$('chartBackButton').addEventListener('click', () => {
  chartLevel = 'daily';
  selectedDayKey = null;
  chartNavigationChanged = true;
  if (latestSnapshot) render(latestSnapshot);
});

detailPanel.setAttribute('aria-hidden', 'true');
compactHud.setAttribute('aria-hidden', 'false');
for (const button of detailPanel.querySelectorAll('button')) button.tabIndex = -1;

bridge.getSnapshot().then(render).catch(() => {});
bridge.onSnapshot(render);
