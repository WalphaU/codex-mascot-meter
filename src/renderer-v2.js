const bridge = window.codexMeter || {
  getSnapshot: async () => null,
  onSnapshot: () => () => {},
  minimize: () => {},
  close: () => {},
  setMode: () => {},
  petDragStart: () => {},
  petDragMove: () => {},
  petDragEnd: () => {},
  onPetDragStopped: () => () => {}
};
const {
  PetAnimationController,
  PET_ANIMATION_PRIORITIES,
  PetSequenceAdapter,
  PetIdlePlayer,
  createPetAnimationActions,
  PET_RANDOM_ACTIONS
} = window.CodexPetAnimation || {};

const $ = (id) => document.getElementById(id);
const widget = document.querySelector('.widget');
const detailPanel = document.querySelector('.detail-panel');
const compactHud = document.querySelector('.compact-hud');
const compactToolbar = document.querySelector('.compact-toolbar');
const dynamicPetStage = $('dynamicPetStage');
const dynamicPet = $('dynamicPet');
const dynamicHitTarget = $('dynamicHitTarget');
const dynamicBackButton = $('dynamicBackButton');
const dynamicActor = $('dynamicActor');
const dynamicSequence = $('dynamicSequence');
const dynamicSequenceFrames = [...dynamicSequence.querySelectorAll('[data-sequence-slot]')];
const dragSequence = $('dragSequence');
const dynamicRig = $('dynamicRig');
const dynamicRigFrames = [...dynamicRig.querySelectorAll('[data-rig-slot]')];
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
let dynamicLastAction = '';
let dynamicDragging = false;
let dynamicPointer = null;
let dynamicDragFrame = 0;
let dynamicDragPoint = null;
let dynamicDragSessionSerial = 0;
let dynamicDragSessionId = null;
let dynamicLastSentCursor = null;
let dynamicBackTimer = null;
let dynamicControlsHovered = false;
let dynamicRigSlot = 0;
let dynamicRigAsset = './assets/idle/idle-01.png';
let dynamicRigFailed = false;
let petAnimationController = null;
let petSequenceAdapter = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const DYNAMIC_ACTION_GAP = 10_000;
const LOW_QUOTA_THRESHOLD = 10;

const DYNAMIC_ACTIONS = Object.freeze({
});

const DYNAMIC_POSES = Object.freeze({
  idle: 'idle',
  enter: 'idle',
  pet: 'idle',
  drag: 'drag',
  land: 'jump'
});

const DYNAMIC_RIG_ASSETS = Object.freeze({
  idle: './assets/idle/idle-01.png',
  jump: './assets/mascot-action-jump.webp',
  happy: './assets/mascot-action-happy.webp',
  drag: './assets/mascot-action-drag.webp'
});

const DYNAMIC_SEQUENCES = Object.freeze({
});

const DYNAMIC_POOLS = Object.freeze({
  idle: [], working: [], low: [], done: []
});

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

function setMode(nextMode, force = false) {
  const next = ['compact', 'detail', 'dynamic'].includes(nextMode) ? nextMode : 'compact';
  if (!force && currentMode === next) return;
  const wasDynamic = currentMode === 'dynamic';
  currentMode = next;
  widget.dataset.mode = next;
  const isDetail = next === 'detail';
  const isCompact = next === 'compact';
  const isDynamic = next === 'dynamic';
  detailPanel.setAttribute('aria-hidden', String(!isDetail));
  compactHud.setAttribute('aria-hidden', String(!isCompact));
  compactToolbar.setAttribute('aria-hidden', String(!isCompact));
  dynamicPetStage.setAttribute('aria-hidden', String(!isDynamic));
  dynamicPetStage.inert = !isDynamic;
  $('petButton').setAttribute('aria-label', isDetail ? 'Codex 桌面宠物' : '打开 Codex 项目详细面板');
  $('petButton').tabIndex = isDynamic ? -1 : 0;
  $('dynamicModeButton').tabIndex = isCompact ? 0 : -1;
  $('compactModeButton').tabIndex = isCompact ? 0 : -1;
  $('compactCloseButton').tabIndex = isCompact ? 0 : -1;
  $('dynamicBackButton').tabIndex = isDynamic ? 0 : -1;
  dynamicHitTarget.tabIndex = isDynamic ? 0 : -1;
  for (const button of detailPanel.querySelectorAll('button')) button.tabIndex = isDetail ? 0 : -1;
  if (wasDynamic && !isDynamic) stopDynamicPet();
  if (isDynamic) startDynamicPet();
  if (!isDynamic) hideDynamicBack(true);
  bridge.setMode(next);
}

function revealDynamicBack() {
  if (dynamicBackTimer) clearTimeout(dynamicBackTimer);
  dynamicBackTimer = null;
  if (currentMode !== 'dynamic' || dynamicDragging) return;
  dynamicPetStage.dataset.backVisible = 'true';
}

function hideDynamicBack(immediate = false) {
  if (dynamicBackTimer) clearTimeout(dynamicBackTimer);
  dynamicBackTimer = null;
  if (immediate) {
    delete dynamicPetStage.dataset.backVisible;
    return;
  }
  dynamicBackTimer = setTimeout(() => {
    if (!dynamicControlsHovered && !dynamicDragging) delete dynamicPetStage.dataset.backVisible;
    dynamicBackTimer = null;
  }, 420);
}

function setDynamicRigPose(pose) {
  if (dynamicRigFailed) return;
  const asset = DYNAMIC_RIG_ASSETS[pose] || DYNAMIC_RIG_ASSETS.idle;
  if (asset === dynamicRigAsset && dynamicActor.dataset.rigReady === 'true') return;
  const nextSlot = dynamicRigSlot === 0 ? 1 : 0;
  const frame = dynamicRigFrames[nextSlot];
  if (!frame) return;
  for (const image of frame.querySelectorAll('img')) {
    if (!image.src.endsWith(asset.replace('./', '/'))) image.src = asset;
  }
  frame.dataset.rigPose = pose;
  dynamicRigSlot = nextSlot;
  dynamicRigAsset = asset;
  dynamicRig.dataset.activeSlot = String(nextSlot);
  dynamicActor.dataset.rigReady = 'true';
}

function failDynamicRig(error) {
  if (dynamicRigFailed) return;
  dynamicRigFailed = true;
  delete dynamicActor.dataset.rigReady;
  console.warn('[dynamic-pet] segmented rig disabled; using static fallback', error?.message || error || 'asset error');
}

for (const image of dynamicRig.querySelectorAll('img')) image.addEventListener('error', failDynamicRig);
for (const image of dragSequence.querySelectorAll('img')) {
  image.addEventListener('error', () => { dynamicActor.dataset.dragSequenceFailed = 'true'; });
}
dynamicActor.dataset.rigReady = 'true';

function setDynamicAction(action, label = '', rigPose = '') {
  dynamicActor.dataset.action = action;
  dynamicActor.dataset.pose = DYNAMIC_POSES[action] || 'idle';
  setDynamicRigPose(rigPose || DYNAMIC_POSES[action] || 'idle');
  const actionLabel = label || DYNAMIC_ACTIONS[action]?.label || '待机呼吸';
  dynamicHitTarget.setAttribute('aria-label', `动态桌宠：${actionLabel}。单击互动，拖动可移动`);
}

function setDynamicPhase(phase) {
  dynamicActor.dataset.phase = phase;
}

function dynamicRuntimeState() {
  const state = widget.dataset.state || 'idle';
  return DYNAMIC_POOLS[state] ? state : 'idle';
}

function chooseDynamicAction() {
  const pool = DYNAMIC_POOLS[dynamicRuntimeState()] || DYNAMIC_POOLS.idle;
  const choices = pool.filter((action) => PET_RANDOM_ACTIONS.includes(action) && action !== dynamicLastAction);
  const action = choices[Math.floor(Math.random() * choices.length)] || null;
  dynamicLastAction = action;
  return action;
}

function stopDynamicPet() {
  petAnimationController?.stop('mode-exit');
  void petSequenceAdapter?.deactivate({ immediate: true });
  dynamicDragging = false;
  dynamicControlsHovered = false;
  delete dynamicPetStage.dataset.dragging;
  delete dynamicPetStage.dataset.backVisible;
  if (dynamicBackTimer) clearTimeout(dynamicBackTimer);
  dynamicBackTimer = null;
  dynamicPointer = null;
  dynamicDragPoint = null;
  dynamicLastSentCursor = null;
  dynamicActor.style.removeProperty('--pet-x');
  dynamicActor.style.removeProperty('--pet-y');
  if (dynamicDragFrame) cancelAnimationFrame(dynamicDragFrame);
  dynamicDragFrame = 0;
  if (dynamicDragSessionId !== null) bridge.petDragEnd({ sessionId: dynamicDragSessionId });
  dynamicDragSessionId = null;
  if (!petAnimationController) {
    setDynamicAction('idle');
    setDynamicPhase('idle');
  }
}

function startDynamicPet() {
  if (currentMode !== 'dynamic') return;
  if (!petAnimationController) initializePetAnimationController();
  petAnimationController?.setVisibility(!document.hidden);
  petAnimationController?.setReducedMotion(reducedMotion.matches);
  // The current idle renderer owns the very first frame; never play the old intro.
  void petAnimationController?.start({ intro: false });
}

function reactToDynamicPet() {
  if (currentMode !== 'dynamic' || dynamicDragging) return;
  dismissCompletionState();
  void petAnimationController?.request('pet', {
    priority: PET_ANIMATION_PRIORITIES?.interaction || 800,
    source: 'interaction',
    force: true
  });
}

async function playLegacyDynamicAction(action, context, duration) {
  const motionDuration = reducedMotion.matches ? Math.min(80, duration) : duration;
  await context.wait(motionDuration);
}

function applyControllerState(action, metadata = {}) {
  if (metadata.source === 'random') dynamicActor.dataset.direction = Math.random() < .5 ? 'left' : 'right';
  setDynamicAction(action, metadata.label || '', DYNAMIC_POSES[action] || 'idle');
}

function initializePetAnimationController() {
  if (petAnimationController) return petAnimationController;
  if (!PetAnimationController || !PetSequenceAdapter || !createPetAnimationActions) {
    console.warn('[dynamic-pet] animation runtime unavailable; static fallback remains active');
    return null;
  }
  petSequenceAdapter = new PetSequenceAdapter({
    container: dynamicSequence,
    slots: dynamicSequenceFrames,
    owner: dynamicActor,
    transitionMs: 180,
    warn: (...args) => console.warn(...args)
  }).registerAll(DYNAMIC_SEQUENCES);

  const actions = createPetAnimationActions({
    sequenceAdapter: petSequenceAdapter,
    owner: dynamicActor,
    playLegacy: playLegacyDynamicAction,
    playGreeting: context => petAnimationController?.idlePlayer?.playGreeting(context),
    warn: (...args) => console.warn(...args)
  });

  petAnimationController = new PetAnimationController({
    actions,
    idlePlayer: PetIdlePlayer ? new PetIdlePlayer({
      element: $('dynamicIdle'), owner: dynamicActor,
      asset: './assets/idle/idle-atlas.png'
    }) : null,
    randomEnabled: false,
    idleGap: DYNAMIC_ACTION_GAP,
    transitionMs: 180,
    reducedMotion: reducedMotion.matches,
    chooseAction: () => chooseDynamicAction(),
    onStateChange: applyControllerState,
    onPhaseChange: (phase) => setDynamicPhase(phase),
    onError: (error, context) => {
      console.warn(`[dynamic-pet] ${context?.action || 'action'} recovered to idle`, error?.message || error);
      void petSequenceAdapter?.deactivate({ immediate: true });
    }
  });
  Object.defineProperty(window, '__codexPetAnimationController', {
    configurable: true,
    value: petAnimationController
  });
  return petAnimationController;
}

initializePetAnimationController();
// Decode while the default panel is visible; this does not start an animation clock.
void petAnimationController?.idlePlayer?.preload();

function sendPendingDragPoint() {
  dynamicDragFrame = 0;
  if (!dynamicDragPoint || !dynamicDragging) return;
  const point = dynamicDragPoint;
  dynamicDragPoint = null;
  if (dynamicLastSentCursor && point.screenX === dynamicLastSentCursor.screenX && point.screenY === dynamicLastSentCursor.screenY) return;
  dynamicLastSentCursor = { screenX: point.screenX, screenY: point.screenY };
  bridge.petDragMove(point);
}

function finishDynamicPointer(event = {}, { allowClick = false, notifyMain = true } = {}) {
  if (!dynamicPointer || (event.pointerId !== undefined && event.pointerId !== dynamicPointer.pointerId)) return;
  const wasDragging = dynamicDragging;
  const pointerId = dynamicPointer.pointerId;
  const sessionId = dynamicDragSessionId;
  dynamicPointer = null;
  try {
    if (dynamicHitTarget.hasPointerCapture?.(pointerId)) dynamicHitTarget.releasePointerCapture(pointerId);
  } catch (error) {
    console.warn('[dynamic-pet] pointer capture release recovered', error?.message || error);
  }
  if (!wasDragging) {
    if (allowClick) reactToDynamicPet();
    return;
  }
  dynamicDragging = false;
  delete dynamicPetStage.dataset.dragging;
  dynamicDragPoint = null;
  if (dynamicDragFrame) cancelAnimationFrame(dynamicDragFrame);
  dynamicDragFrame = 0;
  dynamicLastSentCursor = null;
  dynamicDragSessionId = null;
  if (notifyMain) bridge.petDragEnd({ sessionId });
  if (dynamicControlsHovered) revealDynamicBack();
  void petAnimationController?.request('land', {
    priority: PET_ANIMATION_PRIORITIES?.interaction || 800,
    source: 'drag-release',
    force: true
  });
}

function quotaWindowsForDisplay(usage = {}) {
  return Array.isArray(usage.windows) ? usage.windows.filter(Boolean) : [];
}

function quotaRemaining(windowData) {
  if (windowData?.remainingPercent === null || windowData?.remainingPercent === undefined) return null;
  const remaining = Number(windowData.remainingPercent);
  return Number.isFinite(remaining) ? clamp(remaining) : null;
}

function findQuotaWindow(usage, windowMinutes, fallbackKey) {
  const windows = quotaWindowsForDisplay(usage);
  const exact = windows.find((windowData) => Number(windowData.windowMinutes) === windowMinutes);
  if (exact) return exact;
  const keyed = windows.find((windowData) => windowData.key === fallbackKey);
  return keyed && !Number(keyed.windowMinutes) ? keyed : null;
}

function strictestQuotaWindow(usage) {
  return quotaWindowsForDisplay(usage)
    .filter((windowData) => quotaRemaining(windowData) !== null)
    .sort((left, right) => quotaRemaining(left) - quotaRemaining(right))[0] || null;
}

function renderCompactQuota(valueId, barId, windowData) {
  const remaining = quotaRemaining(windowData);
  $(valueId).textContent = remaining === null ? '—' : `${Math.round(remaining)}%`;
  $(barId).style.width = `${remaining ?? 0}%`;
}

function renderDetailQuota(cardId, valueId, resetId, barId, windowData, fallbackLabel) {
  const card = $(cardId);
  const remaining = quotaRemaining(windowData);
  const known = remaining !== null;
  card.dataset.known = String(known);
  card.dataset.low = String(known && remaining <= LOW_QUOTA_THRESHOLD);
  card.style.setProperty('--quota-remaining', String(remaining ?? 0));
  $(valueId).textContent = known ? `${Math.round(remaining)}%` : '—';
  $(resetId).textContent = windowData?.resetsAt ? `${formatCountdown(windowData.resetsAt)}后重置` : '等待额度数据';
  $(barId).style.width = `${remaining ?? 0}%`;
  card.setAttribute('aria-label', `${windowData?.label || fallbackLabel}，${known ? `剩余 ${Math.round(remaining)}%` : '数据未知'}${windowData?.resetsAt ? `，${formatCountdown(windowData.resetsAt)}后重置` : ''}`);
}

function stateCopy(snapshot, state) {
  if (state === 'low') {
    const lowest = strictestQuotaWindow(snapshot?.usage || {});
    const remaining = quotaRemaining(lowest);
    return { compact: '余额偏低', label: '额度提醒', step: `${lowest?.label || '任一额度窗口'}${remaining === null ? '' : `剩余 ${Math.round(remaining)}%`}，已达到 10% 提醒线` };
  }
  if (state === 'done') return { compact: '刚刚完成', label: '任务完成', step: snapshot.task?.progress?.activeStep || '当前任务已完成' };
  if (state === 'working') return { compact: '工作中', label: '正在执行', step: snapshot.task?.progress?.activeStep || 'Codex 正在处理当前任务' };
  return { compact: '待机', label: '等待任务', step: '等待 Codex 开始任务' };
}

function completionKey(snapshot) {
  const task = snapshot?.task || {};
  return String(task.turnId || task.completedAt || task.id || 'completed-task');
}

function lowQuotaFallback(snapshot) {
  const remaining = snapshot?.usage?.lowRemainingPercent ?? quotaRemaining(strictestQuotaWindow(snapshot?.usage || {}));
  return remaining != null && Number(remaining) <= LOW_QUOTA_THRESHOLD ? 'low' : 'idle';
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
  return ({ none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' })[String(effort || '').toLowerCase()] || (effort || '—');
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

function drawChart(history, total, delta) {
  let series = Array.isArray(history) ? history
    .map((point) => ({ timestamp: Number(point.timestamp), totalTokens: Number(point.totalTokens) }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.totalTokens)) : [];
  if (!series.length && Number(total)) series = [{ timestamp: Date.now(), totalTokens: Number(total) }];
  const renderKey = [
    chartLevel,
    selectedDayKey || '',
    Number(total) || 0,
    Number(delta) || 0,
    series.map((point) => `${point.timestamp}:${point.totalTokens}`).join(',')
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
  const taskVisuallyWorking = Boolean(task.isWorking);
  const progress = taskVisuallyDone || taskVisuallyWorking ? task.progress : null;
  const taskPercent = progress ? clamp(progress.percent) : (taskVisuallyDone ? 100 : 0);
  const indeterminate = Boolean(taskVisuallyWorking && !progress);
  const fiveHourWindow = findQuotaWindow(usage, 300, 'primary');
  const weeklyWindow = findQuotaWindow(usage, 10080, 'secondary');

  $('projectName').textContent = projectName;
  $('projectName').title = project.path || projectName;
  $('compactProjectName').textContent = projectName;
  $('compactProjectName').title = project.path || projectName;
  $('compactState').textContent = copy.compact;

  $('compactTaskLabel').textContent = progress?.activeStep || (taskVisuallyWorking ? '当前任务处理中' : '任务进度');
  $('compactTaskValue').textContent = progress ? `${taskPercent}%` : taskVisuallyWorking ? '进行中' : taskVisuallyDone ? '完成' : '待机';
  $('compactTaskBar').style.width = `${taskPercent}%`;
  $('compactTaskBar').classList.toggle('is-indeterminate', indeterminate);
  renderCompactQuota('compactFiveHourQuotaValue', 'compactFiveHourQuotaBar', fiveHourWindow);
  renderCompactQuota('compactWeeklyQuotaValue', 'compactWeeklyQuotaBar', weeklyWindow);
  renderDetailQuota('fiveHourQuotaCard', 'fiveHourQuotaValue', 'fiveHourQuotaReset', 'fiveHourQuotaBar', fiveHourWindow, '5小时窗口');
  renderDetailQuota('weeklyQuotaCard', 'weeklyQuotaValue', 'weeklyQuotaReset', 'weeklyQuotaBar', weeklyWindow, '1周窗口');

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
  drawChart(usage.history, usage.totalTokens, delta);
  const nextQuotaReset = [fiveHourWindow?.resetsAt, weeklyWindow?.resetsAt]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > Date.now())
    .sort((left, right) => left - right)[0];
  $('resetCountdown').textContent = nextQuotaReset ? formatCountdown(nextQuotaReset) : '等待窗口刷新';
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
$('dynamicModeButton').addEventListener('click', () => setMode('dynamic'));
$('dynamicBackButton').addEventListener('click', () => setMode('compact'));
$('compactModeButton').addEventListener('click', () => setMode('detail'));
$('modeButton').addEventListener('click', () => setMode('compact'));
$('compactCloseButton').addEventListener('click', () => bridge.close());
$('closeButton').addEventListener('click', () => bridge.close());
$('minimizeButton').addEventListener('click', () => bridge.minimize());

dynamicPetStage.addEventListener('pointerover', () => {
  if (currentMode !== 'dynamic') return;
  dynamicControlsHovered = true;
  revealDynamicBack();
});
dynamicPetStage.addEventListener('pointerout', (event) => {
  if (event.relatedTarget instanceof Node && dynamicPetStage.contains(event.relatedTarget)) return;
  dynamicControlsHovered = false;
  hideDynamicBack();
});
dynamicBackButton.addEventListener('focus', () => {
  dynamicControlsHovered = true;
  revealDynamicBack();
});
dynamicBackButton.addEventListener('blur', (event) => {
  if (event.relatedTarget instanceof Node && dynamicPetStage.contains(event.relatedTarget)) return;
  dynamicControlsHovered = false;
  hideDynamicBack();
});

dynamicHitTarget.addEventListener('pointerdown', (event) => {
  if (currentMode !== 'dynamic' || event.button !== 0) return;
  event.preventDefault();
  if (dynamicPointer) finishDynamicPointer({ pointerId: dynamicPointer.pointerId }, { notifyMain: true });
  dynamicPointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startScreenX: event.screenX,
    startScreenY: event.screenY
  };
  dynamicLastSentCursor = null;
  try {
    dynamicHitTarget.setPointerCapture?.(event.pointerId);
  } catch (error) {
    console.warn('[dynamic-pet] pointer capture unavailable; native release hook remains active', error?.message || error);
  }
});

dynamicHitTarget.addEventListener('pointermove', (event) => {
  if (!dynamicPointer || event.pointerId !== dynamicPointer.pointerId) return;
  if ((event.buttons & 1) !== 1) {
    finishDynamicPointer(event);
    return;
  }
  const distance = Math.hypot(event.clientX - dynamicPointer.startX, event.clientY - dynamicPointer.startY);
  if (!dynamicDragging && distance >= 6) {
    dynamicDragging = true;
    dynamicPetStage.dataset.dragging = 'true';
    hideDynamicBack(true);
    void petSequenceAdapter?.deactivate({ immediate: true });
    dynamicActor.style.removeProperty('--pet-x');
    dynamicActor.style.removeProperty('--pet-y');
    dynamicDragSessionId = ++dynamicDragSessionSerial;
    bridge.petDragStart({
      sessionId: dynamicDragSessionId,
      screenX: dynamicPointer.startScreenX,
      screenY: dynamicPointer.startScreenY
    });
    petAnimationController?.hold('drag', {
      priority: PET_ANIMATION_PRIORITIES?.drag || 900,
      label: '被揪住后领',
      source: 'drag'
    });
  }
  if (!dynamicDragging) return;
  event.preventDefault();
  dynamicDragPoint = {
    sessionId: dynamicDragSessionId,
    screenX: Math.round(event.screenX),
    screenY: Math.round(event.screenY),
    buttons: event.buttons
  };
  if (!dynamicDragFrame) dynamicDragFrame = requestAnimationFrame(sendPendingDragPoint);
});

dynamicHitTarget.addEventListener('pointerup', (event) => finishDynamicPointer(event, { allowClick: true }));
dynamicHitTarget.addEventListener('pointercancel', (event) => finishDynamicPointer(event));
dynamicHitTarget.addEventListener('lostpointercapture', (event) => {
  if (dynamicPointer && event.pointerId === dynamicPointer.pointerId) finishDynamicPointer(event);
});
dynamicHitTarget.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  reactToDynamicPet();
});
dynamicHitTarget.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('pointerup', (event) => finishDynamicPointer(event, { allowClick: true }), true);
window.addEventListener('pointercancel', (event) => finishDynamicPointer(event), true);
window.addEventListener('mouseup', (event) => {
  if (event.button === 0 && dynamicPointer) finishDynamicPointer({ pointerId: dynamicPointer.pointerId }, { allowClick: true });
}, true);
window.addEventListener('blur', () => {
  if (dynamicPointer) finishDynamicPointer({ pointerId: dynamicPointer.pointerId });
  dynamicControlsHovered = false;
  hideDynamicBack(true);
});
document.addEventListener('mouseleave', (event) => {
  if (dynamicPointer && (event.buttons & 1) !== 1) finishDynamicPointer({ pointerId: dynamicPointer.pointerId });
  dynamicControlsHovered = false;
  hideDynamicBack();
});

bridge.onPetDragStopped?.((payload = {}) => {
  if (!dynamicPointer || String(payload.sessionId) !== String(dynamicDragSessionId)) return;
  finishDynamicPointer({ pointerId: dynamicPointer.pointerId }, { notifyMain: false });
});

document.addEventListener('visibilitychange', () => {
  if (currentMode !== 'dynamic') return;
  petAnimationController?.setVisibility(!document.hidden);
});

const handleReducedMotionChange = () => {
  petAnimationController?.setReducedMotion(reducedMotion.matches);
};
if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', handleReducedMotionChange);
else reducedMotion.addListener?.(handleReducedMotionChange);

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

setMode('compact', true);

bridge.getSnapshot().then(render).catch(() => {});
bridge.onSnapshot(render);
