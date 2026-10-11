const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.setPath('userData', process.env.CODEX_CAPTURE_TEMP
  ? path.join(process.env.CODEX_CAPTURE_TEMP, 'user-data')
  : path.join(os.tmpdir(), `codex-plus-preview-${process.pid}`));

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
    remainingPercent: 73,
    lowRemainingPercent: 73,
    usedPercent: 27,
    windowLabel: '5小时窗口',
    resetsAt: Date.now() + 3.2 * 60 * 60 * 1000,
    windows: [
      { key: 'primary', label: '5小时窗口', usedPercent: 27, remainingPercent: 73, windowMinutes: 300, resetsAt: Date.now() + 3.2 * 60 * 60 * 1000 },
      { key: 'secondary', label: '1周窗口', usedPercent: 11, remainingPercent: 89, windowMinutes: 10080, resetsAt: Date.now() + 4.2 * 24 * 60 * 60 * 1000 }
    ],
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
  console.log('[preview] app ready');
  ipcMain.handle('meter:get-snapshot', () => sample);
  ipcMain.on('window:minimize', () => {});
  ipcMain.on('window:close', () => {});
  ipcMain.on('window:set-mode', () => {});
  ipcMain.handle('window:pet-teleport', () => ({ cancelled: false, x: 0, y: 0 }));
  ipcMain.on('window:pet-drag-start', () => {});
  ipcMain.on('window:pet-drag-move', () => {});
  ipcMain.on('window:pet-drag-end', () => {});

  const window = new BrowserWindow({
    width: 300,
    height: 380,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
      backgroundThrottling: false
    }
  });
  window.webContents.setFrameRate(60);
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[renderer:${level}] ${message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => console.error('[preview] renderer gone', details));
  await window.loadFile(path.join(__dirname, '..', 'src', 'index-v2.html'));
  console.log('[preview] page loaded');
  await new Promise((resolve) => setTimeout(resolve, 900));
  // Hidden Electron pages throttle animations; disable motion only for static QA captures.
  const staticMotionCss = await window.webContents.insertCSS('* { animation: none !important; transition: none !important; }');
  const outputDir = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(outputDir, { recursive: true });
  const compact = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'widget-compact-preview.png'), compact.toPNG());
  console.log('[preview] compact captured');

  window.setSize(270, 320, false);
  const dynamicState = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('dynamicModeButton').click();
    const actor = document.getElementById('dynamicActor');
    const hoverZone = document.getElementById('dynamicHoverZone');
    const backButton = document.getElementById('dynamicBackButton');
    hoverZone.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 71 }));
    const backStyle = getComputedStyle(backButton);
    return {
      mode: document.querySelector('.widget').dataset.mode,
      actorAction: actor.dataset.action,
      baseLoaded: document.querySelector('.pose-idle').complete,
      dragLoaded: document.querySelector('.pose-drag').complete,
      backTabIndex: backButton.tabIndex,
      backLeft: backStyle.left,
      backVisible: document.getElementById('dynamicPetStage').dataset.backVisible,
      backOpacity: backStyle.opacity,
      backPointerEvents: backStyle.pointerEvents
    };
  })()`, true);
  if (dynamicState.mode !== 'dynamic' || !dynamicState.baseLoaded || !dynamicState.dragLoaded || dynamicState.backTabIndex !== 0 || dynamicState.backLeft !== '9px' || dynamicState.backVisible !== 'true' || dynamicState.backOpacity !== '1' || dynamicState.backPointerEvents !== 'auto') {
    throw new Error(`Dynamic mode failed: ${JSON.stringify(dynamicState)}`);
  }
  await window.webContents.executeJavaScript(`document.getElementById('dynamicBackButton').focus()`, true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const dynamic = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'widget-dynamic-preview.png'), dynamic.toPNG());
  console.log('[preview] dynamic captured');
  const dragVisualState = await window.webContents.executeJavaScript(`(async () => {
    const pet = document.getElementById('dynamicHitTarget');
    pet.setPointerCapture = () => {};
    pet.releasePointerCapture = () => {};
    pet.hasPointerCapture = () => true;
    pet.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 91, button: 0, clientX: 80, clientY: 90, screenX: 400, screenY: 300 }));
    pet.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 91, button: 0, buttons: 1, clientX: 110, clientY: 125, screenX: 430, screenY: 335 }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      action: document.getElementById('dynamicActor').dataset.action,
      dragging: document.getElementById('dynamicPetStage').dataset.dragging,
      dragSequenceOpacity: getComputedStyle(document.getElementById('dragSequence')).opacity,
      firstFrameOpacity: getComputedStyle(document.querySelector('.drag-frame')).opacity,
      firstFrameLoaded: document.querySelector('.drag-frame').complete
    };
  })()`, true);
  if (dragVisualState.action !== 'drag' || dragVisualState.dragging !== 'true' || dragVisualState.dragSequenceOpacity !== '1' || dragVisualState.firstFrameOpacity !== '1' || !dragVisualState.firstFrameLoaded) {
    throw new Error(`Dynamic drag visual failed: ${JSON.stringify(dragVisualState)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 240));
  const dynamicDrag = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'widget-dynamic-drag-preview.png'), dynamicDrag.toPNG());
  console.log('[preview] dynamic drag captured');
  const releasedState = await window.webContents.executeJavaScript(`(async () => {
    document.getElementById('dynamicHitTarget').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 91, button: 0, buttons: 0, clientX: 110, clientY: 125, screenX: 430, screenY: 335 }));
    await new Promise(resolve => setTimeout(resolve, 820));
    return {
      action: document.getElementById('dynamicActor').dataset.action,
      pose: document.getElementById('dynamicActor').dataset.pose,
      dragging: document.getElementById('dynamicPetStage').dataset.dragging || ''
    };
  })()`, true);
  if (releasedState.action !== 'idle' || releasedState.pose !== 'idle' || releasedState.dragging) {
    throw new Error(`Dynamic drag release failed: ${JSON.stringify(releasedState)}`);
  }
  await window.webContents.removeInsertedCSS(staticMotionCss);
  await window.webContents.executeJavaScript('window.__codexPetAnimationController.start({ intro: false })');
  await new Promise(resolve => setTimeout(resolve, 250));
  await window.webContents.executeJavaScript('window.__codexPetAnimationController.idlePlayer.setActive(false)');
  for (const [label, time] of [['open', 0], ['blink', 2490], ['breathe', 1600]]) {
    await window.webContents.executeJavaScript('window.__codexPetAnimationController.idlePlayer.renderAt(' + time + ')');
    await new Promise(resolve => setTimeout(resolve, 50));
    fs.writeFileSync(path.join(outputDir, 'widget-dynamic-idle-' + label + '.png'), (await window.webContents.capturePage()).toPNG());
  }
  console.log('[preview] 24-frame idle captured');
  for (const [label,time] of [['prepare',150],['raise',600],['wave',1050],['lower',2050],['settle',2700]]) {
    await window.webContents.executeJavaScript('window.__codexPetAnimationController.idlePlayer.renderAt(1600,'+time+')');
    await new Promise(resolve=>setTimeout(resolve,50));
    fs.writeFileSync(path.join(outputDir,'widget-greeting-'+label+'.png'),(await window.webContents.capturePage()).toPNG());
  }
  const returnedMode = await window.webContents.executeJavaScript(`(() => {
    document.getElementById('dynamicBackButton').click();
    return document.querySelector('.widget').dataset.mode;
  })()`, true);
  if (returnedMode !== 'compact') throw new Error(`Dynamic back switch failed: ${returnedMode}`);

  window.setSize(432, 680, false);
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
  console.log('[preview] detail captured');
  // Leave the native capture callback before destroying its WebContents.
  await new Promise((resolve) => setImmediate(resolve));
  window.destroy();
  setImmediate(() => app.quit());
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
