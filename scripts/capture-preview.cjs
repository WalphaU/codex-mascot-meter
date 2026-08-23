const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const sample = {
  ok: true,
  timestamp: Date.now(),
  project: { id: 'preview-project', name: 'codex额度显示', path: 'C:\\Work\\codex额度显示', sessions: 4, allSessions: 6 },
  state: 'working',
  task: {
    isWorking: true,
    isDone: false,
    model: 'gpt-5.6-sol',
    effort: 'high',
    speedTokensPerSecond: 67.4,
    totalTokens: 85_689,
    startedAt: Date.now() - 18 * 60 * 1000,
    completedAt: 0,
    progress: { percent: 58, completed: 2, total: 5, activeStep: '实现桌面悬浮窗与实时数据桥' }
  },
  usage: {
    remainingPercent: 89,
    usedPercent: 11,
    windowLabel: '1周窗口',
    resetsAt: Date.now() + 4.2 * 24 * 60 * 60 * 1000,
    totalTokens: 1_147_175,
    currentTokens: 85_689,
    deltaTokens: 12_480,
    inputTokens: 1_141_041,
    cachedTokens: 1_057_024,
    history: Array.from({ length: 60 }, (_, index) => ({
      timestamp: Date.now() - (59 - index) * 4 * 60 * 60 * 1000,
      totalTokens: Math.round(1_147_175 * Math.pow(index / 59, 1.12))
    })),
    historyLogs: [
      { id: 'a', timestamp: Date.now() - 0.8 * 86400000, tokens: 85_689, kind: 'task' },
      { id: 'b', timestamp: Date.now() - 2.1 * 86400000, tokens: 231_440, kind: 'subagent' },
      { id: 'c', timestamp: Date.now() - 3.2 * 86400000, tokens: 175_400, kind: 'task' },
      { id: 'd', timestamp: Date.now() - 4.5 * 86400000, tokens: 168_500, kind: 'subagent' }
    ]
  }
};

app.whenReady().then(async () => {
  ipcMain.handle('meter:get-snapshot', () => sample);
  ipcMain.on('window:minimize', () => {});
  ipcMain.on('window:close', () => {});
  ipcMain.on('window:set-mode', () => {});

  const window = new BrowserWindow({
    width: 300,
    height: 380,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  await window.loadFile(path.join(__dirname, '..', 'src', 'index-v2.html'));
  await new Promise((resolve) => setTimeout(resolve, 900));
  // Hidden Electron pages throttle animations; disable motion only for static QA captures.
  await window.webContents.insertCSS('* { animation: none !important; transition: none !important; }');
  const outputDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(outputDir, { recursive: true });
  const compact = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'widget-compact-preview.png'), compact.toPNG());

  window.setSize(432, 800, false);
  const capturedMode = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('compactModeButton').click();
    return document.querySelector('.widget').dataset.mode;
  })()`, true);
  if (capturedMode !== 'detail') throw new Error(`Mode switch failed: ${capturedMode}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const sliderState = await window.webContents.executeJavaScript(`(async () => {
    const viewport = document.getElementById('chartViewport');
    const slider = document.getElementById('historySlider');
    const max = viewport.scrollWidth - viewport.clientWidth;
    slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const movedToPast = viewport.scrollLeft <= 1;
    slider.value = '1000'; slider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const movedToCurrent = Math.abs(viewport.scrollLeft - max) <= 1;
    const axisBackdrop = document.querySelector('#chartYAxis .axis-backdrop');
    const axisLeft = axisBackdrop.getBoundingClientRect().left;
    const viewportLeft = viewport.getBoundingClientRect().left;
    const fixedAxis = Math.abs(axisLeft - viewportLeft) <= 1;
    document.getElementById('scrollLeftButton').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const steppedLeft = viewport.scrollLeft < max - 1;
    const afterLeft = viewport.scrollLeft;
    document.getElementById('scrollRightButton').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const steppedRight = viewport.scrollLeft > afterLeft;
    return { max, movedToPast, movedToCurrent, fixedAxis, axisLeft, viewportLeft, steppedLeft, steppedRight };
  })()`, true);
  if (sliderState.max <= 0 || !sliderState.movedToPast || !sliderState.movedToCurrent || !sliderState.fixedAxis || !sliderState.steppedLeft || !sliderState.steppedRight) {
    throw new Error(`History controls failed: ${JSON.stringify(sliderState)}`);
  }
  const drillState = await window.webContents.executeJavaScript(`(async () => {
    const firstBar = document.querySelector('.chart-bar');
    const dailyBars = document.querySelectorAll('.chart-bar').length;
    firstBar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const back = document.getElementById('chartBackButton');
    const result = {
      dailyBars,
      innerBars: document.querySelectorAll('.chart-bar').length,
      backVisible: !back.hidden,
      innerTitle: document.getElementById('pulseTitle').textContent
    };
    back.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    result.returnedToDaily = back.hidden && document.getElementById('pulseTitle').textContent.includes('每日');
    return result;
  })()`, true);
  if (drillState.dailyBars < 2 || drillState.innerBars < 1 || !drillState.backVisible || !drillState.innerTitle.includes('分时') || !drillState.returnedToDaily) {
    throw new Error(`Chart drill-down failed: ${JSON.stringify(drillState)}`);
  }
  await window.webContents.executeJavaScript(`(() => {
    const slider = document.getElementById('historySlider');
    slider.value = '1000'; slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`, true);
  const detail = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'widget-detail-preview.png'), detail.toPNG());
  window.destroy();
  app.quit();
});
