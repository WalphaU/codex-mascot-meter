const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { CodexMonitor } = require('./codex-monitor-v2.cjs');
const { createPetDragController } = require('./pet-drag-controller.cjs');
const { WINDOW_SIZES, boundsEqual, boundsInside, modeBoundsFrom, resolvedMode } = require('./window-geometry.cjs');

let windowRef;
let timer;
let boundsAnimation;
let petDragController;
let lastSentRevision = 0;
let currentWindowMode = 'compact';
const smokeMode = process.env.CODEX_METER_SMOKE === '1';
const monitor = new CodexMonitor({ projectPath: process.env.CODEX_METER_PROJECT });

function cancelBoundsAnimation() {
  if (boundsAnimation?.timer) clearInterval(boundsAnimation.timer);
  boundsAnimation = null;
}

function displayWorkAreaFor(bounds) {
  const center = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  };
  const display = screen.getDisplayMatching?.(bounds)
    || screen.getDisplayNearestPoint(center)
    || screen.getPrimaryDisplay();
  return display?.workArea || null;
}

function targetBoundsForMode(start, mode) {
  return modeBoundsFrom(start, mode, displayWorkAreaFor(start));
}

function settleWindowMode(mode = currentWindowMode) {
  if (!windowRef || windowRef.isDestroyed()) return null;
  cancelBoundsAnimation();
  const nextMode = resolvedMode(mode);
  const target = targetBoundsForMode(windowRef.getBounds(), nextMode);
  currentWindowMode = nextMode;
  windowRef.setBounds(target, false);
  return target;
}

function randomPetPosition() {
  if (!windowRef || windowRef.isDestroyed()) return null;
  cancelBoundsAnimation();
  petDragController?.stop('teleport');
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const bounds = windowRef.getBounds();
  const padding = 8;
  const minX = workArea.x + padding;
  const minY = workArea.y + padding;
  const maxX = Math.max(minX, workArea.x + workArea.width - bounds.width - padding);
  const maxY = Math.max(minY, workArea.y + workArea.height - bounds.height - padding);
  const x = Math.round(minX + Math.random() * (maxX - minX));
  const y = Math.round(minY + Math.random() * (maxY - minY));
  windowRef.setPosition(x, y, false);
  return { x, y };
}

function animateWindowMode(mode) {
  if (!windowRef || windowRef.isDestroyed()) return;
  cancelBoundsAnimation();
  petDragController?.stop('mode-change');
  const nextMode = resolvedMode(mode);
  const start = windowRef.getBounds();
  const workArea = displayWorkAreaFor(start);
  const target = modeBoundsFrom(start, nextMode, workArea);
  currentWindowMode = nextMode;
  if (boundsEqual(start, target)) return;
  // If a stale drag ever moved the pet beyond the usable desktop, recovery
  // takes priority over animation: panels must become operable immediately.
  if (nextMode !== 'dynamic' && !boundsInside(start, workArea)) {
    windowRef.setBounds(target, false);
    return;
  }
  const startedAt = Date.now();
  const duration = 360;
  const animation = { timer: null, mode: nextMode, target };
  animation.timer = setInterval(() => {
    if (boundsAnimation !== animation) return clearInterval(animation.timer);
    if (!windowRef || windowRef.isDestroyed()) {
      clearInterval(animation.timer);
      boundsAnimation = null;
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const x = Math.round(start.x + (target.x - start.x) * eased);
    const y = Math.round(start.y + (target.y - start.y) * eased);
    const width = Math.round(start.width + (target.width - start.width) * eased);
    const height = Math.round(start.height + (target.height - start.height) * eased);
    windowRef.setBounds({ x, y, width, height }, false);
    if (progress >= 1) {
      clearInterval(animation.timer);
      boundsAnimation = null;
      windowRef.setBounds(target, false);
    }
  }, 16);
  boundsAnimation = animation;
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const initial = WINDOW_SIZES.compact;
  windowRef = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    minWidth: WINDOW_SIZES.dynamic.width,
    minHeight: WINDOW_SIZES.dynamic.height,
    maxWidth: WINDOW_SIZES.detail.width,
    maxHeight: WINDOW_SIZES.detail.height,
    x: Math.max(workArea.x, workArea.x + workArea.width - initial.width - 20),
    y: Math.max(workArea.y, workArea.y + workArea.height - initial.height - 20),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: true,
    title: 'Codex 余额 Plus',
    icon: path.join(__dirname, '..', 'src', 'assets', 'app-icon.png'),
    show: !smokeMode,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webgl: true,
      devTools: true,
      backgroundThrottling: true
    }
  });

  windowRef.setAlwaysOnTop(true, 'floating');
  windowRef.loadFile(path.join(__dirname, '..', 'src', 'index-v2.html'));
  windowRef.on('closed', () => {
    cancelBoundsAnimation();
    petDragController?.stop('window-closed');
    windowRef = null;
    if (timer) clearInterval(timer);
  });
  windowRef.on('blur', () => petDragController?.stop('window-blur'));

  if (process.platform === 'win32' && typeof windowRef.hookWindowMessage === 'function') {
    const releaseMessages = new Map([
      [0x0202, 'wm-lbuttonup'],
      [0x00a2, 'wm-nclbuttonup'],
      [0x0247, 'wm-pointerup'],
      [0x0215, 'wm-capturechanged'],
      [0x001f, 'wm-cancelmode']
    ]);
    for (const [message, reason] of releaseMessages) {
      windowRef.hookWindowMessage(message, () => petDragController?.stop(reason));
    }
  }

  const push = () => {
    if (!windowRef || windowRef.isDestroyed()) return;
    const snapshot = monitor.snapshot();
    if (snapshot.revision === lastSentRevision) return;
    lastSentRevision = snapshot.revision;
    windowRef.webContents.send('meter:snapshot', snapshot);
  };
  timer = setInterval(push, 2000);
  if (smokeMode) setTimeout(() => app.quit(), 1800);
}

app.whenReady().then(() => {
  petDragController = createPetDragController({
    getWindow: () => windowRef,
    getCursorPoint: () => screen.getCursorScreenPoint(),
    onStop: (payload) => {
      const contents = windowRef?.webContents;
      if (contents && !contents.isDestroyed()) contents.send('window:pet-drag-stopped', payload);
    }
  });
  ipcMain.handle('meter:get-snapshot', () => {
    const snapshot = monitor.snapshot();
    lastSentRevision = snapshot.revision;
    return snapshot;
  });
  ipcMain.on('window:minimize', () => windowRef?.minimize());
  ipcMain.on('window:close', () => windowRef?.close());
  ipcMain.on('window:set-mode', (_event, mode) => animateWindowMode(mode));
  ipcMain.handle('window:pet-teleport', () => randomPetPosition());
  ipcMain.on('window:pet-drag-start', (_event, payload = {}) => {
    // A pointer can arrive during the compact -> dynamic size transition.
    // Commit the exact dynamic geometry before measuring the grab offset so a
    // cancelled animation can never leave an accumulating intermediate size.
    settleWindowMode('dynamic');
    petDragController.start(payload);
  });
  ipcMain.on('window:pet-drag-move', (_event, payload = {}) => petDragController.move(payload));
  ipcMain.on('window:pet-drag-end', (_event, payload = {}) => {
    petDragController.stop('renderer-release', payload.sessionId ?? null);
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
