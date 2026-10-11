const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');

const smokeDataRoot = path.join(os.tmpdir(), `codex-meter-interaction-smoke-${process.pid}`);
app.setPath('userData', smokeDataRoot);
app.setPath('sessionData', path.join(smokeDataRoot, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

async function run() {
  const windowRef = new BrowserWindow({
    show: false,
    frame: false,
    width: 432,
    height: 680,
    webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true }
  });
  windowRef.webContents.setFrameRate(60);
  await windowRef.loadFile(path.join(__dirname, '..', 'src', 'index-v2.html'));
  const result = await windowRef.webContents.executeJavaScript(`(async () => {
    const centerHit = (element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    const compactButton = document.getElementById('dynamicModeButton');
    const compactButtonHit = centerHit(compactButton);
    const compactButtonReachable = compactButtonHit?.closest?.('#dynamicModeButton') === compactButton;
    compactButtonHit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const switchedToDynamic = document.querySelector('.widget').dataset.mode === 'dynamic';
    const dynamicBackButton = document.getElementById('dynamicBackButton');
    const dynamicActor = document.getElementById('dynamicActor');
    const dynamicBackAnchored = Math.round(dynamicBackButton.offsetLeft - dynamicActor.offsetLeft) === -3
      && Math.round(dynamicBackButton.offsetTop - dynamicActor.offsetTop) === -13;
    document.getElementById('dynamicBackButton').click();

    const petButton = document.getElementById('petButton');
    const petHit = centerHit(petButton);
    const staticPetReachable = petHit?.closest?.('#petButton') === petButton;
    const staticPetCursor = getComputedStyle(petButton).cursor;
    const inactiveStage = document.getElementById('dynamicPetStage');
    const inactiveStageInert = inactiveStage.inert;
    const inactiveHitTargetPointerEvents = getComputedStyle(document.getElementById('dynamicHitTarget')).pointerEvents;
    const inactiveStageImmediateIsolation = inactiveStageInert
      && inactiveHitTargetPointerEvents === 'none';
    await new Promise((resolve) => setTimeout(resolve, 220));
    const inactiveStageStyle = getComputedStyle(inactiveStage);
    const inactiveStageVisibility = inactiveStageStyle.visibility;
    const inactiveStageOpacity = inactiveStageStyle.opacity;
    const modeAfterDynamicExit = document.querySelector('.widget').dataset.mode;
    const inactiveStageIsolated = inactiveStageImmediateIsolation
      && inactiveStageVisibility === 'hidden';

    document.getElementById('compactModeButton').click();
    render({
      timestamp: Date.now(),
      project: { id: 'smoke', path: 'C:/Smoke', name: 'Smoke', sessions: 1, allSessions: 1 },
      task: { isWorking: false, isDone: false, model: 'gpt-smoke', effort: 'high', totalTokens: 240 },
      usage: {
        totalTokens: 240, currentTokens: 240, inputTokens: 200, cachedTokens: 80, deltaTokens: 40,
        windows: [],
        history: [
          { timestamp: Date.now() - 3000, totalTokens: 0 },
          { timestamp: Date.now() - 2000, totalTokens: 100 },
          { timestamp: Date.now() - 1000, totalTokens: 240 }
        ],
        historyLogs: []
      }
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const firstBar = document.querySelector('.chart-bar');
    const chartHit = centerHit(firstBar);
    const chartBarReachable = chartHit?.closest?.('.chart-bar') === firstBar;
    chartHit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const chartDrilledDown = document.querySelector('.pulse-card').dataset.chartLevel === 'intraday';
    // Inspect settled content in the same frameless viewport as the packaged app.
    await new Promise(resolve => setTimeout(resolve, 450));

    return {
      compactButtonReachable,
      switchedToDynamic,
      dynamicBackAnchored,
      staticPetReachable,
      staticPetCursor,
      inactiveStageInert,
      inactiveHitTargetPointerEvents,
      inactiveStageVisibility,
      inactiveStageOpacity,
      modeAfterDynamicExit,
      inactiveStageIsolated,
      chartBarReachable,
      chartDrilledDown,
      logsRemoved: !document.getElementById('historyLogList'),
      moduleBounds: [...document.querySelectorAll('.detail-panel > *')].map(element => {
        const bounds = element.getBoundingClientRect();
        return { name: element.className, top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
      }),
      modulesFit: [...document.querySelectorAll('.detail-panel > *')].every(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 8 && bounds.bottom <= innerHeight - 8
          && bounds.left >= 8 && bounds.right <= innerWidth - 8;
      })
    };
  })()`);
  console.log(JSON.stringify(result, null, 2));
  const passed = result.compactButtonReachable
    && result.switchedToDynamic
    && result.dynamicBackAnchored
    && result.staticPetReachable
    && result.staticPetCursor === 'pointer'
    && result.inactiveStageIsolated
    && result.chartBarReachable
    && result.chartDrilledDown
    && result.logsRemoved
    && result.modulesFit;
  windowRef.close();
  if (!passed) throw new Error('interaction smoke test failed');
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
