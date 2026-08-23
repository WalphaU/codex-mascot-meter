const $ = (selector) => document.querySelector(selector);
const widget = $('.widget');
const CIRCUMFERENCE = 2 * Math.PI * 68;
const history = [];
let expanded = true;

const nfCompact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const nfFull = new Intl.NumberFormat('zh-CN');

function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  return nfCompact.format(value);
}

function countdown(target) {
  if (!target) return '未提供';
  const milliseconds = Math.max(0, target - Date.now());
  const minutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}天 ${hours}小时`;
  return `${hours}小时 ${mins}分`;
}

function stateCopy(state, task) {
  if (state === 'low') return ['额度提醒', '用量窗口余额偏低'];
  if (state === 'done') return ['任务完成', task.progress?.activeStep || '本轮 Codex 工作已完成'];
  if (state === 'working') return ['正在工作', task.progress?.activeStep || 'Codex 正在处理当前任务'];
  return ['待机中', task.progress?.activeStep || '等待 Codex 开始任务'];
}

function updateChart(totalTokens, deltaTokens) {
  const latest = history.at(-1);
  if (!latest || latest.value !== totalTokens || Date.now() - latest.at > 4500) {
    history.push({ value: totalTokens, at: Date.now() });
    if (history.length > 28) history.shift();
  }
  const values = history.map((point) => point.value);
  while (values.length < 8) values.unshift(values[0] ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 352;
  const top = 10;
  const bottom = 68;
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = bottom - ((value - min) / range) * (bottom - top);
    return [x, y];
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} 74 L0 74 Z`;
  $('#chartLine').setAttribute('d', line);
  $('#chartArea').setAttribute('d', area);
  const last = points.at(-1);
  $('#chartDot').setAttribute('cx', last[0]);
  $('#chartDot').setAttribute('cy', last[1]);
  $('#deltaBadge').textContent = `+${nfCompact.format(deltaTokens || 0)}`;
  $('#chartSummary').textContent = `项目累计 ${nfFull.format(totalTokens)} tokens，本次刷新增加 ${nfFull.format(deltaTokens || 0)} tokens。`;
}

function render(snapshot) {
  if (!snapshot?.ok) {
    $('#projectName').textContent = '未检测到 Codex 任务';
    $('#stateLabel').textContent = '等待连接';
    $('#activeStep').textContent = '启动一个 Codex 任务后会自动同步';
    return;
  }

  widget.dataset.state = snapshot.state;
  $('#projectName').textContent = snapshot.project.name;
  $('#projectName').title = snapshot.project.path;
  const remaining = Math.round(snapshot.usage.remainingPercent);
  $('#quotaValue').textContent = `${remaining}%`;
  $('#quotaArc').style.strokeDashoffset = String(CIRCUMFERENCE * (1 - remaining / 100));
  $('#quotaStatus').textContent = remaining <= 20 ? '建议放缓' : snapshot.task.isWorking ? '实时消耗中' : '可继续使用';

  const [label, step] = stateCopy(snapshot.state, snapshot.task);
  $('#stateLabel').textContent = label;
  $('#activeStep').textContent = step;
  const progress = snapshot.task.progress;
  $('#progressPercent').textContent = progress ? `${progress.percent}%` : snapshot.task.isWorking ? 'LIVE' : '—';
  $('#progressBar').style.width = `${progress?.percent ?? (snapshot.task.isWorking ? 16 : 0)}%`;

  $('#totalTokens').textContent = formatTokens(snapshot.usage.totalTokens);
  $('#totalTokens').title = `${nfFull.format(snapshot.usage.totalTokens)} tokens`;
  $('#currentTokens').textContent = formatTokens(snapshot.usage.currentTokens);
  const input = snapshot.usage.inputTokens || 0;
  $('#cacheRate').textContent = input ? `${Math.round((snapshot.usage.cachedTokens / input) * 100)}%` : '—';
  $('#sessionCount').textContent = `${snapshot.project.sessions} 个本机任务`;
  $('#resetCountdown').textContent = countdown(snapshot.usage.resetsAt);
  $('#modelName').textContent = snapshot.task.model || 'Codex';
  $('#lastUpdated').textContent = `更新于 ${new Date(snapshot.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}`;
  updateChart(snapshot.usage.totalTokens, snapshot.usage.deltaTokens);
}

$('#minimizeButton').addEventListener('click', () => window.codexMeter.minimize());
$('#closeButton').addEventListener('click', () => window.codexMeter.close());
$('#pinButton').addEventListener('click', async (event) => {
  const pinned = await window.codexMeter.togglePin();
  event.currentTarget.classList.toggle('is-active', pinned);
  event.currentTarget.setAttribute('aria-pressed', String(pinned));
  event.currentTarget.setAttribute('aria-label', pinned ? '取消窗口置顶' : '将窗口置顶');
});
$('#collapseButton').addEventListener('click', (event) => {
  expanded = !expanded;
  widget.dataset.expanded = String(expanded);
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
  event.currentTarget.setAttribute('aria-label', expanded ? '折叠详情' : '展开详情');
  event.currentTarget.style.transform = expanded ? '' : 'rotate(180deg)';
  window.codexMeter.setExpanded(expanded);
});

window.codexMeter.onSnapshot(render);
window.codexMeter.getSnapshot().then(render);
