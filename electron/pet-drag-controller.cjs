'use strict';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function integerPoint(point = {}) {
  const x = Math.round(Number(point.x));
  const y = Math.round(Number(point.y));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function createPetDragController({
  getWindow,
  getCursorPoint,
  onStop = () => {}
}) {
  let session = null;

  function stop(reason = 'ended', expectedSessionId = null) {
    if (!session) return false;
    if (expectedSessionId !== null && String(expectedSessionId) !== session.id) return false;
    const stopped = { sessionId: session.id, reason };
    session = null;
    onStop(stopped);
    return true;
  }

  function start(payload = {}) {
    const windowRef = getWindow();
    if (!windowRef || windowRef.isDestroyed()) return false;
    stop('replaced');

    const cursor = integerPoint(getCursorPoint());
    const bounds = windowRef.getBounds();
    if (!cursor || !bounds) return false;

    session = {
      id: String(payload.sessionId ?? '0'),
      offsetX: cursor.x - bounds.x,
      offsetY: cursor.y - bounds.y,
      lastCursorX: cursor.x,
      lastCursorY: cursor.y,
      lastTargetX: bounds.x,
      lastTargetY: bounds.y
    };
    return true;
  }

  function tick() {
    const windowRef = getWindow();
    if (!session || !windowRef || windowRef.isDestroyed()) return { moved: false, reason: 'inactive' };

    const cursor = integerPoint(getCursorPoint());
    if (!cursor) return { moved: false, reason: 'invalid-cursor' };

    // Moving a frameless BrowserWindow can itself synthesize pointermove events.
    // The renderer invokes this sample only for pointer activity; ignore a
    // synthetic event unless the physical cursor actually changed position.
    if (cursor.x === session.lastCursorX && cursor.y === session.lastCursorY) {
      return { moved: false, reason: 'stationary-cursor' };
    }
    session.lastCursorX = cursor.x;
    session.lastCursorY = cursor.y;

    const bounds = windowRef.getBounds();
    if (!bounds) return { moved: false, reason: 'invalid-bounds' };

    // Electron exposes both BrowserWindow bounds and cursor screen points in DIP.
    // Keeping their start-of-session offset untouched avoids DPI drift and lets the
    // window be partly off-screen while the grabbed collar remains under the cursor.
    const x = Math.round(cursor.x - session.offsetX);
    const y = Math.round(cursor.y - session.offsetY);

    if ((x === bounds.x && y === bounds.y) || (x === session.lastTargetX && y === session.lastTargetY)) {
      return { moved: false, reason: 'same-target' };
    }

    session.lastTargetX = x;
    session.lastTargetY = y;
    windowRef.setPosition(x, y, false);
    return { moved: true, x, y };
  }

  function move(payload = {}) {
    if (!session) return { moved: false, reason: 'inactive' };
    if (String(payload.sessionId ?? '') !== session.id) return { moved: false, reason: 'stale-session' };
    if ((Number(payload.buttons) & 1) !== 1) {
      stop('button-released', session.id);
      return { moved: false, reason: 'button-released' };
    }
    return tick();
  }

  return {
    start,
    move,
    tick,
    stop,
    isActive: () => Boolean(session),
    snapshot: () => session ? { ...session } : null
  };
}

module.exports = { clamp, createPetDragController };
