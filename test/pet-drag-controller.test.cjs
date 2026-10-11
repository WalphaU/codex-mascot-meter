const test = require('node:test');
const assert = require('node:assert/strict');

const { createPetDragController } = require('../electron/pet-drag-controller.cjs');

function harness() {
  const positions = [];
  const stops = [];
  const cursor = { x: 150, y: 150 };
  const bounds = { x: 100, y: 100, width: 270, height: 320 };
  const windowRef = {
    isDestroyed: () => false,
    getBounds: () => ({ ...bounds }),
    setPosition: (x, y) => {
      bounds.x = x;
      bounds.y = y;
      positions.push({ x, y });
    }
  };
  const controller = createPetDragController({
    getWindow: () => windowRef,
    getCursorPoint: () => ({ ...cursor }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    onStop: (payload) => stops.push(payload)
  });
  return { controller, cursor, bounds, positions, stops };
}

test('window moves exactly once per physical cursor position', () => {
  const { controller, cursor, positions } = harness();
  assert.equal(controller.start({ sessionId: 7 }), true);
  assert.equal(controller.move({ sessionId: 7, buttons: 1 }).reason, 'stationary-cursor');
  assert.equal(positions.length, 0);

  cursor.x += 20;
  assert.deepEqual(controller.move({ sessionId: 7, buttons: 1 }), { moved: true, x: 120, y: 100 });
  assert.deepEqual(positions, [{ x: 120, y: 100 }]);

  // A pointermove synthesized by moving BrowserWindow must not feed back.
  assert.equal(controller.move({ sessionId: 7, buttons: 1 }).reason, 'stationary-cursor');
  assert.equal(positions.length, 1);
});

test('release and stale sessions cannot move the window', () => {
  const { controller, cursor, positions, stops } = harness();
  controller.start({ sessionId: 11 });
  cursor.y += 25;
  controller.move({ sessionId: 11, buttons: 1 });
  assert.equal(positions.length, 1);

  const released = controller.move({ sessionId: 11, buttons: 0 });
  assert.equal(released.reason, 'button-released');
  assert.equal(controller.isActive(), false);
  assert.deepEqual(stops, [{ sessionId: '11', reason: 'button-released' }]);

  cursor.x += 100;
  assert.equal(controller.move({ sessionId: 11, buttons: 1 }).reason, 'inactive');
  assert.equal(positions.length, 1);

  controller.start({ sessionId: 12 });
  cursor.x += 10;
  assert.equal(controller.move({ sessionId: 11, buttons: 1 }).reason, 'stale-session');
  assert.equal(positions.length, 1);
});

test('native cursor sampling preserves the grabbed DIP offset without edge clamping', () => {
  const { controller, cursor, positions } = harness();
  controller.start({ sessionId: 'dpi-150', screenX: 99999, screenY: 99999 });
  cursor.x = -25;
  cursor.y = -40;
  assert.deepEqual(controller.tick(), { moved: true, x: -75, y: -90 });
  assert.deepEqual(positions.at(-1), { x: -75, y: -90 });
});

test('two hundred independent drag sessions never shrink the reachable area', () => {
  const { controller, cursor, bounds, positions } = harness();
  const targets = [
    { x: -180, y: -120 },
    { x: 2100, y: -90 },
    { x: 2080, y: 1320 },
    { x: -160, y: 1300 }
  ];

  for (let index = 0; index < 200; index += 1) {
    const offset = { x: 74, y: 42 };
    cursor.x = bounds.x + offset.x;
    cursor.y = bounds.y + offset.y;
    assert.equal(controller.start({ sessionId: index }), true);
    const target = targets[index % targets.length];
    cursor.x = target.x + offset.x;
    cursor.y = target.y + offset.y;
    assert.deepEqual(controller.tick(), { moved: true, ...target });
    assert.equal(controller.stop('test-release', index), true);
  }

  assert.deepEqual(positions.slice(-4), targets);
  assert.equal(controller.isActive(), false);
});
