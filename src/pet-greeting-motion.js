(function attachGreeting(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CodexPetAnimation = Object.assign(root.CodexPetAnimation || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';
  const GREETING_DURATION_MS = 2800;
  const ease = value => { const t = Math.max(0, Math.min(1, value)); return t*t*t*(t*(t*6-15)+10); };
  function track(t, keys) {
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [a, x] = keys[i-1], [b, y] = keys[i];
        return x + (y-x)*ease((t-a)/(b-a));
      }
    }
    return keys[keys.length-1][1];
  }
  // A single seekable score. All channels have zero value/velocity at both ends.
  function sampleGreetingMotion(time) {
    const t = Math.max(0, Math.min(GREETING_DURATION_MS, time));
    return {
      nod: track(t, [[0,0],[180,1.3],[580,-1],[1030,2.6],[1480,-.5],[2160,0],[2800,0]]),
      tilt: track(t, [[0,0],[650,-.018],[1540,-.012],[2260,.004],[2800,0]]),
      follow: track(t, [[0,0],[800,1.2],[1830,-.8],[2390,.35],[2800,0]]),
      blink: track(t, [[0,0],[820,0],[900,1],[945,1],[1110,0],[2800,0]]),
      phase: t < 200 ? 'anticipate' : t < 680 ? 'acknowledge' : t < 1780 ? 'nod' : t < 2360 ? 'recover' : 'settle'
    };
  }
  // Head-only response: hands and skirt remain on the unchanged idle surface.
  // not independently cropped limbs; no new silhouette is swapped on a click.
  function greetingPoint(x, y, motion) {
    const upper = 1-ease((y-144)/48);
    const hair = Math.exp(-Math.pow((y-180)/45,2))*upper;
    return {
      x: x - (y-171)*motion.tilt*upper + motion.follow*hair,
      y: y + motion.nod*upper + (x-123)*motion.tilt*upper
    };
  }
  return { GREETING_DURATION_MS, sampleGreetingMotion, greetingPoint };
});
