'use strict';

const WINDOW_SIZES = Object.freeze({
  dynamic: Object.freeze({ width: 270, height: 320 }),
  compact: Object.freeze({ width: 300, height: 380 }),
  detail: Object.freeze({ width: 432, height: 680 })
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteInteger(value, fallback = 0) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

function normalizedRect(rect = {}) {
  return {
    x: finiteInteger(rect.x),
    y: finiteInteger(rect.y),
    width: Math.max(0, finiteInteger(rect.width)),
    height: Math.max(0, finiteInteger(rect.height))
  };
}

function resolvedMode(mode) {
  return Object.hasOwn(WINDOW_SIZES, mode) ? mode : 'compact';
}

function modeBoundsFrom(startBounds, mode, workArea) {
  const start = normalizedRect(startBounds);
  const nextMode = resolvedMode(mode);
  const targetSize = WINDOW_SIZES[nextMode];
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let x = right - targetSize.width;
  let y = bottom - targetSize.height;

  // The animated pet may be dragged partly off-screen. Full panels must always
  // return to the current display's usable work area when they expand.
  if (nextMode !== 'dynamic' && workArea) {
    const area = normalizedRect(workArea);
    const maxX = Math.max(area.x, area.x + area.width - targetSize.width);
    const maxY = Math.max(area.y, area.y + area.height - targetSize.height);
    x = clamp(x, area.x, maxX);
    y = clamp(y, area.y, maxY);
  }

  return { x, y, ...targetSize };
}

function boundsEqual(left, right) {
  return Boolean(left && right)
    && left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function boundsInside(bounds, workArea) {
  if (!bounds || !workArea) return false;
  const rect = normalizedRect(bounds);
  const area = normalizedRect(workArea);
  return rect.x >= area.x
    && rect.y >= area.y
    && rect.x + rect.width <= area.x + area.width
    && rect.y + rect.height <= area.y + area.height;
}

module.exports = {
  WINDOW_SIZES,
  boundsEqual,
  boundsInside,
  modeBoundsFrom,
  normalizedRect,
  resolvedMode
};
