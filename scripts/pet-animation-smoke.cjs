const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const smokeDataRoot = path.join(os.tmpdir(), `codex-pet-animation-smoke-${process.pid}`);
app.setPath('userData', smokeDataRoot);
app.setPath('sessionData', path.join(smokeDataRoot, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

async function run() {
  const windowRef = new BrowserWindow({
    show: false, width: 270, height: 320,
    webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true }
  });
  const pageErrors = [];
  windowRef.webContents.setFrameRate(60);
  windowRef.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) pageErrors.push(message);
  });
  try {
    await windowRef.loadFile(path.join(__dirname, '..', 'src', 'index-v2.html'));
    const result = await windowRef.webContents.executeJavaScript(`(async () => {
      const controller = window.__codexPetAnimationController;
      if (!controller) throw new Error('Missing controller');
      setMode('dynamic', true);
      controller.setReducedMotion(false);
      await controller.start({ intro: false });
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const actor = document.getElementById('dynamicActor');
      const idle = document.getElementById('dynamicIdle');
      const deadline = Date.now() + 5000;
      while (actor.dataset.idleActive !== 'true') {
        if (Date.now() > deadline) throw new Error('Idle atlas did not load');
        await pause(20);
      }
      const seen = new Set();
      const rendersBefore = controller.idlePlayer.renderCount;
      for (let sample = 0; sample < 350; sample++) {
        seen.add(idle.dataset.frame);
        await pause(20);
      }
      const idleDrawn = getComputedStyle(idle).opacity === '1'
        && getComputedStyle(document.getElementById('dynamicRig')).opacity === '0';
      const idleBeforeHold = idle.dataset.frame;
      controller.hold('drag');
      await pause(180);
      const idleStoppedForDrag = actor.dataset.idleActive !== 'true'
        && idle.dataset.frame === idleBeforeHold && controller.idlePlayer.timer === null;
      const playback = controller.request('pet', { priority: 500, force: true });
      await pause(450);
      const interactionRendered = actor.dataset.action === 'pet';
      controller.hold('drag');
      const interrupted = await playback;
      const finished = await controller.request('land', { force: true });
      const returnedIdle = actor.dataset.idleActive === 'true' && controller.state === 'idle';
      controller.setVisibility(false);
      const hidden = controller.idlePlayer.timer === null && actor.dataset.idleActive !== 'true';
      controller.setVisibility(true);
      controller.setReducedMotion(true);
      const reduced = controller.idlePlayer.timer === null;
      controller.setReducedMotion(false);
      const resumed = actor.dataset.idleActive === 'true';
      // Full greeting playback, not just a pose label or an interrupted action.
      const beforeGreeting = controller.idlePlayer.renderCount;
      const greetingPromise = controller.request('pet', { force: true });
      await pause(500);
      const repeat = await controller.request('pet', { force: true });
      const greetingContinuous = actor.dataset.idleActive === 'true'
        && getComputedStyle(actor).transform === 'none'
        && actor.dataset.pose === 'idle';
      const greetingFinished = await greetingPromise;
      const greetingFrames = controller.idlePlayer.renderCount-beforeGreeting;
      const greetingReturned = controller.state === 'idle' && actor.dataset.idleActive === 'true';
      const player=controller.idlePlayer, drawTimes=[];
      for (let t=0;t<2800;t+=100) {
        const start=performance.now(); player.renderAt(1600,t);
        drawTimes.push(performance.now()-start);
      }
      drawTimes.sort((a,b)=>a-b);
      const greetingDrawP95 = drawTimes[Math.floor(drawTimes.length*.95)];
      const registered = [...controller.actions.keys()].sort();
      const choices = Array.from({ length: 20 }, () => chooseDynamicAction());
      setMode('compact');
      const stoppedOnExit = controller.idlePlayer.timer === null && actor.dataset.idleActive !== 'true';
      return { frames: seen.size, renderCount: controller.idlePlayer.renderCount - rendersBefore, idleDrawn, idleStoppedForDrag, interactionRendered,
        interrupted, finished, returnedIdle, hidden, reduced, resumed, registered, choices, stoppedOnExit,
        greetingContinuous, greetingFinished, greetingFrames, greetingReturned, repeat, greetingDrawP95 };
    })()`);
    console.log(JSON.stringify({ result, pageErrors }, null, 2));
    assert.equal(result.frames, 24);
    assert.ok(result.renderCount > 100, 'continuous renderer must not stall at sprite cadence');
    assert.deepEqual(result.registered, ['drag', 'enter', 'land', 'pet']);
    assert.equal(result.greetingContinuous, true);
    assert.equal(result.greetingFinished.status, 'completed');
    assert.ok(result.greetingFrames > 90);
    assert.equal(result.greetingReturned, true);
    assert.equal(result.repeat.reason, 'already-playing');
    assert.ok(result.choices.every(action => action === null));
    for (const key of ['idleDrawn', 'idleStoppedForDrag', 'interactionRendered', 'returnedIdle',
      'hidden', 'reduced', 'resumed', 'stoppedOnExit']) assert.equal(result[key], true, key);
    assert.equal(result.interrupted.status, 'interrupted');
    assert.equal(result.finished.status, 'completed');
    assert.deepEqual(pageErrors, []);
  } finally {
    windowRef.destroy();
  }
}
app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
