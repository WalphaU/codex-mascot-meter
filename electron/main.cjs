const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { CodexMonitor } = require('./codex-monitor-v2.cjs');

let windowRef;
let timer;
let boundsAnimation;
let lastSentRevision = 0;
const smokeMode = process.env.CODEX_METER_SMOKE === '1';
const monitor = new CodexMonitor({ projectPath: process.env.CODEX_METER_PROJECT });
const WINDOW_SIZES = {
  compact: { width: 300, height: 380 },
  detail: { width: 432, height: 800 }
};

function animateWindowMode(mode) {
  if (!windowRef || windowRef.isDestroyed()) return;
  const target = WINDOW_SIZES[mode] || WINDOW_SIZES.compact;
  if (boundsAnimation) clearInterval(boundsAnimation);
  const start = windowRef.getBounds();
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const startedAt = Date.now();
  const duration = 360;
  boundsAnimation = setInterval(() => {
    if (!windowRef || windowRef.isDestroyed()) return clearInterval(boundsAnimation);
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const width = Math.round(start.width + (target.width - start.width) * eased);
    const height = Math.round(start.height + (target.height - start.height) * eased);
    windowRef.setBounds({ x: right - width, y: bottom - height, width, height }, false);
    if (progress >= 1) {
      clearInterval(boundsAnimation);
      boundsAnimation = null;
      windowRef.setBounds({ x: right - target.width, y: bottom - target.height, ...target }, false);
    }
  }, 16);
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const initial = WINDOW_SIZES.compact;
  windowRef = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    minWidth: initial.width,
    minHeight: initial.height,
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
    title: 'Codex 余额助手',
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
    windowRef = null;
    if (timer) clearInterval(timer);
  });

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
  ipcMain.handle('meter:get-snapshot', () => {
    const snapshot = monitor.snapshot();
    lastSentRevision = snapshot.revision;
    return snapshot;
  });
  ipcMain.on('window:minimize', () => windowRef?.minimize());
  ipcMain.on('window:close', () => windowRef?.close());
  ipcMain.on('window:set-mode', (_event, mode) => animateWindowMode(mode));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
