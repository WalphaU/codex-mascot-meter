const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WINDOW_SIZES,
  boundsEqual,
  boundsInside,
  modeBoundsFrom,
  resolvedMode
} = require('../electron/window-geometry.cjs');

const scaledLaptopWorkArea = { x: 0, y: 0, width: 1707, height: 1027 };

test('an interrupted transition settles to the exact dynamic size without changing its bottom-right anchor', () => {
  const intermediate = { x: 1300, y: 610, width: 285, height: 350 };
  assert.deepEqual(modeBoundsFrom(intermediate, 'dynamic', scaledLaptopWorkArea), {
    x: 1315,
    y: 640,
    ...WINDOW_SIZES.dynamic
  });
});

test('dynamic mode may remain partly outside the display work area', () => {
  const partlyOutside = { x: -180, y: -120, ...WINDOW_SIZES.dynamic };
  assert.deepEqual(modeBoundsFrom(partlyOutside, 'dynamic', scaledLaptopWorkArea), partlyOutside);
});

test('compact mode is fully constrained after expanding from an off-screen pet', () => {
  const partlyOutside = { x: -180, y: -120, ...WINDOW_SIZES.dynamic };
  assert.deepEqual(modeBoundsFrom(partlyOutside, 'compact', scaledLaptopWorkArea), {
    x: 0,
    y: 0,
    ...WINDOW_SIZES.compact
  });

  const beyondBottomRight = { x: 1660, y: 990, ...WINDOW_SIZES.dynamic };
  assert.deepEqual(modeBoundsFrom(beyondBottomRight, 'compact', scaledLaptopWorkArea), {
    x: scaledLaptopWorkArea.width - WINDOW_SIZES.compact.width,
    y: scaledLaptopWorkArea.height - WINDOW_SIZES.compact.height,
    ...WINDOW_SIZES.compact
  });
});

test('detail mode is fully constrained to the current display work area', () => {
  const edgePet = { x: 1550, y: 850, ...WINDOW_SIZES.dynamic };
  assert.deepEqual(modeBoundsFrom(edgePet, 'detail', scaledLaptopWorkArea), {
    x: scaledLaptopWorkArea.width - WINDOW_SIZES.detail.width,
    y: scaledLaptopWorkArea.height - WINDOW_SIZES.detail.height,
    ...WINDOW_SIZES.detail
  });
});

test('unknown modes retain the compact fallback and exact bounds compare by geometry', () => {
  assert.equal(resolvedMode('unknown'), 'compact');
  const expected = { x: 10, y: 20, width: 300, height: 380 };
  assert.equal(boundsEqual(expected, { ...expected }), true);
  assert.equal(boundsEqual(expected, { ...expected, y: 21 }), false);
});

test('panel rescue detects every partially or fully off-screen window', () => {
  assert.equal(boundsInside({ x: 10, y: 10, width: 300, height: 380 }, scaledLaptopWorkArea), true);
  assert.equal(boundsInside({ x: -1, y: 10, width: 300, height: 380 }, scaledLaptopWorkArea), false);
  assert.equal(boundsInside({ x: 1500, y: 900, width: 300, height: 380 }, scaledLaptopWorkArea), false);
  assert.equal(boundsInside({ x: -9000, y: -9000, width: 270, height: 320 }, scaledLaptopWorkArea), false);
});
