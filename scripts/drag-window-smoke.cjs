const assert = require('node:assert/strict');
const { app, BrowserWindow, screen } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { createPetDragController } = require('../electron/pet-drag-controller.cjs');

const smokeDataRoot = path.join(os.tmpdir(), `codex-meter-drag-smoke-${process.pid}`);
app.setPath('userData', smokeDataRoot);
app.setPath('sessionData', path.join(smokeDataRoot, 'session'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(() => {
  const display = screen.getPrimaryDisplay();
  const startX = display.workArea.x + 40;
  const startY = display.workArea.y + 40;
  const windowRef = new BrowserWindow({
    width: 270,
    height: 320,
    x: startX,
    y: startY,
    show: false,
    frame: false,
    transparent: true
  });
  const cursor = { x: startX + 80, y: startY + 70 };
  const controller = createPetDragController({
    getWindow: () => windowRef,
    getCursorPoint: () => ({ ...cursor }),
    getDisplayNearestPoint: (point) => screen.getDisplayNearestPoint(point)
  });

  assert.equal(controller.start({ sessionId: 'smoke' }), true);
  assert.equal(controller.move({ sessionId: 'smoke', buttons: 1 }).reason, 'stationary-cursor');
  cursor.x += 36;
  cursor.y += 22;
  assert.deepEqual(controller.move({ sessionId: 'smoke', buttons: 1 }), {
    moved: true,
    x: startX + 36,
    y: startY + 22
  });
  assert.deepEqual(windowRef.getPosition(), [startX + 36, startY + 22]);
  assert.equal(controller.move({ sessionId: 'smoke', buttons: 1 }).reason, 'stationary-cursor');
  controller.stop('smoke-complete', 'smoke');
  windowRef.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
