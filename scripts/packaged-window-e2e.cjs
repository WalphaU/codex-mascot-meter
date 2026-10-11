const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

const executable = process.env.CODEX_METER_PACKAGED_EXE;
if (!executable || !path.isAbsolute(executable)) {
  throw new Error('CODEX_METER_PACKAGED_EXE must point to an absolute packaged executable path');
}

const port = 9300 + Math.floor(Math.random() * 500);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nativePointerType = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct NativePoint { public int X; public int Y; }
public struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }
public static class NativePointer {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out NativePoint point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out NativeRect rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
[NativePointer]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
`;

function runNativePointer(command) {
  return execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', `${nativePointerType}\n${command}`
  ], { encoding: 'utf8', windowsHide: true }).trim();
}

function getNativeCursor() {
  const value = runNativePointer(`
$point = New-Object NativePoint
[NativePointer]::GetCursorPos([ref]$point) | Out-Null
"$($point.X),$($point.Y)"
  `);
  const [x, y] = value.split(',').map(Number);
  return { x, y };
}

function setNativeCursor(point) {
  runNativePointer(`[NativePointer]::SetCursorPos(${Math.round(point.x)}, ${Math.round(point.y)}) | Out-Null`);
}

function getNativeWindowRect(processId) {
  const value = runNativePointer(`
$handle = (Get-Process -Id ${Number(processId)} -ErrorAction Stop).MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'Packaged app has no main window handle' }
$rect = New-Object NativeRect
if (-not [NativePointer]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed' }
"$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
  `);
  const [left, top, right, bottom] = value.split(',').map(Number);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function activateNativeWindow(processId) {
  runNativePointer(`
$handle = (Get-Process -Id ${Number(processId)} -ErrorAction Stop).MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'Packaged app has no main window handle' }
[NativePointer]::SetForegroundWindow($handle) | Out-Null
  `);
}

function performNativeDrag(start, end) {
  const steps = 18;
  runNativePointer(`
[NativePointer]::SetCursorPos(${Math.round(start.x)}, ${Math.round(start.y)}) | Out-Null
Start-Sleep -Milliseconds 80
try {
  [NativePointer]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  for ($index = 1; $index -le ${steps}; $index += 1) {
    $progress = $index / ${steps}
    $x = [Math]::Round(${start.x} + (${end.x} - ${start.x}) * $progress)
    $y = [Math]::Round(${start.y} + (${end.y} - ${start.y}) * $progress)
    [NativePointer]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 24
  }
  Start-Sleep -Milliseconds 220
} finally {
  [NativePointer]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
  `);
}

async function waitForTarget(child) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`packaged app exited before CDP connected: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === 'page' && item.url.includes('index-v2.html'));
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for packaged page target: ${lastError?.message || 'no target'}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let serial = 0;

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      for (const listener of listeners.get(message.method) || []) listener(message.params || {});
      return;
    }
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
    else resolve(message.result || {});
  });

  return {
    close: () => socket.close(),
    on(method, listener) {
      const bucket = listeners.get(method) || [];
      bucket.push(listener);
      listeners.set(method, bucket);
    },
    send(method, params = {}) {
      const id = ++serial;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
  };
}

async function run() {
  let stderr = '';
  let originalCursor = null;
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      CODEX_METER_PROJECT: path.join(__dirname, '..')
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let cdp;
  try {
    const target = await waitForTarget(child);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    const runtimeErrors = [];
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      runtimeErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'unknown runtime error');
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.reload', { ignoreCache: true });
    await delay(250);
    const evaluate = async (expression) => {
      const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'runtime evaluation failed');
      return response.result?.value;
    };
    const windowInfo = async () => evaluate(`({
      bounds: { left: screenX, top: screenY, width: outerWidth, height: outerHeight },
      content: { width: innerWidth, height: innerHeight }
    })`);

    await evaluate(`new Promise((resolve) => {
      if (document.readyState === 'complete') resolve(true);
      else addEventListener('load', () => resolve(true), { once: true });
    })`);
    const available = await evaluate(`({
      left: screen.availLeft || 0,
      top: screen.availTop || 0,
      width: screen.availWidth,
      height: screen.availHeight
    })`);

    const rendererState = await evaluate(`({
      mode: document.querySelector('.widget')?.dataset.mode,
      setModeType: typeof setMode,
      bridgeReady: Boolean(window.codexMeter),
      buttonReady: Boolean(document.getElementById('dynamicModeButton'))
    })`);
    const compactButtonWorks = await evaluate(`(() => {
      document.getElementById('dynamicModeButton').click();
      return document.querySelector('.widget').dataset.mode === 'dynamic';
    })()`);
    assert.equal(compactButtonWorks, true, `renderer state: ${JSON.stringify(rendererState)}; runtime errors: ${runtimeErrors.join(' | ')}`);

    // Interrupt the compact -> dynamic transition exactly as an immediate drag
    // would. The native window must commit to 270x320 before measuring offset.
    await delay(45);
    await evaluate(`window.codexMeter.petDragStart({ sessionId: 'packaged-e2e' })`);
    await delay(220);
    let info = await windowInfo();
    assert.equal(info.content.width, 270, `dynamic geometry: ${JSON.stringify(info)}`);
    assert.equal(info.content.height, 320, `dynamic geometry: ${JSON.stringify(info)}`);
    assert.ok(Math.abs(info.bounds.width - 270) <= 1);
    assert.ok(Math.abs(info.bounds.height - 320) <= 1);
    const interruptedDragSize = { ...info.content };
    await evaluate(`window.codexMeter.petDragEnd({ sessionId: 'packaged-e2e' })`);
    // Native WM_SIZE and the renderer viewport can settle after the release IPC.
    await delay(800);
    info = await windowInfo();
    assert.equal(info.content.width,270,JSON.stringify(info));
    assert.equal(info.content.height,320,JSON.stringify(info));

    const relativeAnchor = await evaluate(`(() => {
      const button = document.getElementById('dynamicBackButton');
      const actor = document.getElementById('dynamicActor');
      return { x: button.offsetLeft - actor.offsetLeft, y: button.offsetTop - actor.offsetTop };
    })()`);
    assert.deepEqual(relativeAnchor, { x: -3, y: -13 });

    const beforeGreetingBounds = await windowInfo();
    const greetingResult = await evaluate(`(async () => {
      const controller=window.__codexPetAnimationController;
      const before=controller.idlePlayer.renderCount;
      const result=await controller.request('pet',{force:true});
      const button=document.getElementById('dynamicBackButton');
      const actor=document.getElementById('dynamicActor');
      return {status:result.status, frames:controller.idlePlayer.renderCount-before,
        state:controller.state, anchor:{x:button.offsetLeft-actor.offsetLeft,y:button.offsetTop-actor.offsetTop}};
    })()`);
    assert.equal(greetingResult.status,'completed');
    assert.equal(greetingResult.state,'idle');
    assert.ok(greetingResult.frames>90);
    assert.deepEqual(greetingResult.anchor,relativeAnchor);
    assert.deepEqual((await windowInfo()).bounds,beforeGreetingBounds.bounds);

    originalCursor = getNativeCursor();
    activateNativeWindow(child.pid);
    await delay(500);
    const hitGeometry = await evaluate(`(() => {
      const rect = document.getElementById('dynamicHitTarget').getBoundingClientRect();
      return {
        relativeX: rect.left + rect.width / 2,
        relativeY: rect.top + rect.height / 2,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        deviceScale: devicePixelRatio
      };
    })()`);
    const nativeWindowRect = getNativeWindowRect(child.pid);
    const nativeScaleX = nativeWindowRect.width / hitGeometry.viewportWidth;
    const nativeScaleY = nativeWindowRect.height / hitGeometry.viewportHeight;
    assert.ok(Math.abs(nativeScaleX-hitGeometry.deviceScale)<.02,
      'Native test helper must use physical pixels, not DPI-virtualized rectangles');
    const dragStart = {
      x: nativeWindowRect.left + hitGeometry.relativeX * nativeScaleX,
      y: nativeWindowRect.top + hitGeometry.relativeY * nativeScaleY
    };
    const dragEnd = { x: dragStart.x - 150, y: dragStart.y - 90 };
    const beforeNativeDrag = await windowInfo();
    performNativeDrag(dragStart, dragEnd);
    await delay(260);
    const afterNativeRelease = await windowInfo();
    const rendererReleased = await evaluate(`({
      dragging: document.getElementById('dynamicPetStage').dataset.dragging || '',
      action: document.getElementById('dynamicActor').dataset.action
    })`);
    const nativeDragDiagnostic = {
      hitGeometry,
      nativeWindowRect,
      nativeScaleX,
      nativeScaleY,
      dragStart,
      dragEnd,
      beforeNativeDrag,
      afterNativeRelease,
      rendererReleased
    };
    assert.ok(
      Math.abs(afterNativeRelease.bounds.left - beforeNativeDrag.bounds.left) >= 40,
      `native drag did not move horizontally: ${JSON.stringify(nativeDragDiagnostic)}`
    );
    assert.ok(
      Math.abs(afterNativeRelease.bounds.top - beforeNativeDrag.bounds.top) >= 20,
      `native drag did not move vertically: ${JSON.stringify(nativeDragDiagnostic)}`
    );
    assert.equal(rendererReleased.dragging, '');

    setNativeCursor({ x: dragEnd.x + 180, y: dragEnd.y + 120 });
    await delay(420);
    const afterFreeCursorMove = await windowInfo();
    assert.ok(Math.abs(afterFreeCursorMove.bounds.left - afterNativeRelease.bounds.left) <= 1);
    assert.ok(Math.abs(afterFreeCursorMove.bounds.top - afterNativeRelease.bounds.top) <= 1);
    setNativeCursor(originalCursor);
    originalCursor = null;

    // A dynamic pet may be partly outside the desktop, but expanding back to a
    // panel must bring the full panel into the usable work area.
    await evaluate(`window.moveTo(${available.left - 160}, ${available.top - 100})`);
    await delay(80);
    await evaluate(`document.getElementById('dynamicBackButton').click()`);
    await delay(460);
    info = await windowInfo();
    assert.equal(info.content.width, 300);
    assert.equal(info.content.height, 380);
    assert.ok(info.bounds.left >= available.left - 1);
    assert.ok(info.bounds.top >= available.top - 1);
    assert.ok(info.bounds.left + info.bounds.width <= available.left + available.width + 1);
    assert.ok(info.bounds.top + info.bounds.height <= available.top + available.height + 1);

    await evaluate(`document.getElementById('compactModeButton').click()`);
    await delay(460);
    info = await windowInfo();
    assert.equal(info.content.width, 432);
    assert.equal(info.content.height, 680);
    assert.ok(info.bounds.left >= available.left - 1);
    assert.ok(info.bounds.top >= available.top - 1);
    assert.ok(info.bounds.left + info.bounds.width <= available.left + available.width + 1);
    assert.ok(info.bounds.top + info.bounds.height <= available.top + available.height + 1);

    const result = {
      compactButtonWorks,
      greetingResult,
      interruptedDragSize,
      relativeAnchor,
      nativeDragReleased: true,
      compactConstrained: true,
      detailConstrained: true,
      nativeDragDiagnostic,
      displayWorkArea: available
    };
    console.log(JSON.stringify(result, null, 2));
    await evaluate(`window.codexMeter.close()`);
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(3000)
    ]);
    return result;
  } catch (error) {
    error.message += stderr ? `\nElectron stderr:\n${stderr}` : '';
    throw error;
  } finally {
    if (originalCursor) {
      try { setNativeCursor(originalCursor); } catch {}
    }
    cdp?.close();
    if (child.exitCode === null) child.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
