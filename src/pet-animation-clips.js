(function attachPetAnimationClips(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CodexPetAnimation = Object.assign(root.CodexPetAnimation || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  // Ambient actions only; enter/pet/land/drag are interaction lifecycle effects.
  const PET_RANDOM_ACTIONS = Object.freeze([]);
  function noop() {}

  function sequenceAction(name, label, duration, environment, { onFrame } = {}) {
    return {
      label,
      duration,
      enter: async () => {},
      play: async (ctx) => {
        const used = await environment.sequenceAdapter.play(name, {
          duration,
          transitionMs: ctx.transitionMs,
          signal: ctx.signal,
          onPhase: (phase) => ctx.setPhase(phase),
          onFrame: (frame) => onFrame?.(ctx, frame)
        });
        if (!used) await environment.playLegacy(name, ctx, duration);
      },
      exit: async () => {},
      recover: async () => environment.sequenceAdapter.deactivate({ immediate: true }).catch(noop),
      cancel: async () => environment.sequenceAdapter.deactivate({ immediate: true }).catch(noop)
    };
  }

  function legacyAction(name, label, duration, environment) {
    return {
      label,
      duration,
      enter: async () => {},
      play: (ctx) => environment.playLegacy(name, ctx, duration),
      exit: async () => {}
    };
  }

  function createPetAnimationActions(environment = {}) {
    if (!environment.sequenceAdapter) throw new TypeError('sequenceAdapter is required.');
    return Object.freeze({
      enter: legacyAction('enter', '动态模式', 680, environment),
      pet: {
        label: '点头眨眼回应', duration: 2800, continuousVisual: true, ignoreRepeat: true,
        enter: async () => {},
        play: async ctx => {
          if (ctx.controller.reducedMotion) { await ctx.wait(80); return; }
          const played = await environment.playGreeting?.(ctx);
          if (!played) await ctx.wait(80); // Static fallback, never switch to another silhouette.
        },
        exit: async () => {}
      },
      land: legacyAction('land', '安全着陆', 720, environment),
      drag: { label: '被揪住后领', duration: 0, hold: noop }
    });
  }

  return { createPetAnimationActions, PET_RANDOM_ACTIONS, sequenceAction };
});
