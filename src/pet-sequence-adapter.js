(function attachPetSequenceAdapter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CodexPetAnimation = Object.assign(root.CodexPetAnimation || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  function abortError(reason = 'aborted') {
    const error = new Error(String(reason || 'aborted'));
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal.reason);
  }

  function wait(milliseconds, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(done, Math.max(0, milliseconds));
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(abortError(signal?.reason));
      };
      function done() {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function normalizedDefinition(definition = {}) {
    const order = Array.isArray(definition.order) && definition.order.length
      ? definition.order.map((value) => Math.max(0, Math.min(7, Number(value) || 0)))
      : [0, 1, 2, 3, 4, 5, 6, 7];
    return Object.freeze({
      ...definition,
      asset: String(definition.asset || ''),
      order,
      columns: Math.max(1, Number(definition.columns) || 4),
      rows: Math.max(1, Number(definition.rows) || 2),
      frameCount: 8
    });
  }

  class PetSequenceAdapter {
    constructor({ container, slots = [], owner = null, transitionMs = 180, ImageCtor, warn } = {}) {
      this.container = container || null;
      this.slots = Array.from(slots || []);
      this.owner = owner || null;
      this.transitionMs = Math.max(0, Number(transitionMs) || 180);
      this.ImageCtor = ImageCtor || (typeof Image !== 'undefined' ? Image : null);
      this.warn = typeof warn === 'function' ? warn : (...args) => console.warn(...args);
      this.definitions = new Map();
      this.loads = new Map();
      this.failures = new Set();
      this.activeSlot = 0;
      this.activeLayer = null;
      this.activeAnimations = new Set();
      this.clearTimer = null;
    }

    register(name, definition) {
      const normalized = normalizedDefinition(definition);
      if (!name || !normalized.asset) throw new TypeError('A sequence name and asset are required.');
      this.definitions.set(String(name), normalized);
      return normalized;
    }

    registerAll(definitions = {}) {
      for (const [name, definition] of Object.entries(definitions)) this.register(name, definition);
      return this;
    }

    has(name) {
      return this.definitions.has(String(name));
    }

    get(name) {
      return this.definitions.get(String(name)) || null;
    }

    async preload(name) {
      const key = String(name);
      const definition = this.get(key);
      if (!definition || this.failures.has(key) || !this.ImageCtor) return false;
      if (this.loads.has(key)) return this.loads.get(key);
      const loading = new Promise((resolve) => {
        const image = new this.ImageCtor();
        image.onload = () => resolve(true);
        image.onerror = () => {
          this.failures.add(key);
          this.warn(`[dynamic-pet] sequence asset failed; using static fallback: ${key}`);
          resolve(false);
        };
        image.src = definition.asset;
      });
      this.loads.set(key, loading);
      return loading;
    }

    setFrame(layer, frameIndex, definition) {
      if (!layer || !definition) return;
      const index = Math.max(0, Math.min(definition.frameCount - 1, Number(frameIndex) || 0));
      const column = index % definition.columns;
      const row = Math.floor(index / definition.columns);
      const x = definition.columns > 1 ? column * (100 / (definition.columns - 1)) : 0;
      const y = definition.rows > 1 ? row * (100 / (definition.rows - 1)) : 0;
      layer.style.backgroundPosition = `${x}% ${y}%`;
    }

    cancelAnimations() {
      for (const animation of this.activeAnimations) {
        try { animation.cancel(); } catch {}
      }
      this.activeAnimations.clear();
    }

    async tween(element, keyframes, duration, signal) {
      throwIfAborted(signal);
      if (!element || typeof element.animate !== 'function' || duration <= 0) {
        const finalFrame = keyframes[keyframes.length - 1] || {};
        if (finalFrame.opacity !== undefined && element) element.style.opacity = String(finalFrame.opacity);
        return;
      }
      const animation = element.animate(keyframes, {
        duration,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'both',
        iterations: 1
      });
      this.activeAnimations.add(animation);
      const onAbort = () => animation.cancel();
      let completed = false;
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await animation.finished;
        completed = true;
      } catch (error) {
        if (signal?.aborted) throw abortError(signal.reason);
        throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
        this.activeAnimations.delete(animation);
        if (completed) {
          const finalFrame = keyframes[keyframes.length - 1] || {};
          if (finalFrame.opacity !== undefined) element.style.opacity = String(finalFrame.opacity);
        }
        try { animation.cancel(); } catch {}
      }
    }

    async activate(name, signal, transitionMs = this.transitionMs) {
      throwIfAborted(signal);
      const definition = this.get(name);
      if (!definition || !this.container || this.slots.length < 1) return null;
      if (this.clearTimer) clearTimeout(this.clearTimer);
      this.clearTimer = null;
      this.cancelAnimations();
      const nextSlot = this.slots.length === 1 ? 0 : (this.activeSlot === 0 ? 1 : 0);
      const layer = this.slots[nextSlot];
      layer.style.backgroundImage = `url("${definition.asset}")`;
      layer.style.backgroundSize = `${definition.columns * 100}% ${definition.rows * 100}%`;
      this.setFrame(layer, definition.order[0], definition);
      for (const slot of this.slots) slot.style.opacity = slot === layer ? '1' : '0';
      this.activeSlot = nextSlot;
      this.activeLayer = layer;
      this.container.dataset.activeSlot = String(nextSlot);
      this.container.dataset.active = 'true';
      this.container.style.opacity = '0';
      if (this.owner) this.owner.dataset.sequenceActive = 'true';
      await this.tween(this.container, [{ opacity: 0 }, { opacity: 1 }], transitionMs, signal);
      this.container.style.opacity = '1';
      return layer;
    }

    async deactivate({ signal, transitionMs = this.transitionMs, immediate = false } = {}) {
      this.cancelAnimations();
      if (!this.container) return;
      if (!immediate && this.container.dataset.active === 'true') {
        await this.tween(this.container, [{ opacity: 1 }, { opacity: 0 }], transitionMs, signal);
      }
      this.container.dataset.active = 'false';
      this.container.style.opacity = '0';
      if (this.owner) delete this.owner.dataset.sequenceActive;
      this.activeLayer = null;
      if (this.clearTimer) clearTimeout(this.clearTimer);
      this.clearTimer = setTimeout(() => {
        if (this.container?.dataset.active === 'true') return;
        for (const layer of this.slots) {
          layer.style.removeProperty('background-image');
          layer.style.removeProperty('opacity');
        }
        this.clearTimer = null;
      }, immediate ? 0 : transitionMs);
    }

    async play(name, { duration = 1000, transitionMs = this.transitionMs, signal, onFrame, onPhase } = {}) {
      const key = String(name);
      const definition = this.get(key);
      if (!definition || !await this.preload(key)) return false;
      throwIfAborted(signal);
      const layer = await this.activate(key, signal, transitionMs);
      if (!layer) return false;
      const playbackDuration = Math.max(16 * definition.order.length, duration - transitionMs * 2);
      const frameDuration = playbackDuration / definition.order.length;
      try {
        for (let sequenceIndex = 0; sequenceIndex < definition.order.length; sequenceIndex += 1) {
          throwIfAborted(signal);
          const progress = sequenceIndex / Math.max(1, definition.order.length - 1);
          const frameIndex = definition.order[sequenceIndex];
          this.setFrame(layer, frameIndex, definition);
          onPhase?.(progress < .2 ? 'prepare' : progress < .82 ? 'active' : 'settle');
          await onFrame?.({ name: key, frameIndex, sequenceIndex, progress, definition });
          await wait(frameDuration, signal);
        }
        await this.deactivate({ signal, transitionMs });
        return true;
      } catch (error) {
        await this.deactivate({ immediate: true }).catch(() => {});
        throw error;
      }
    }

    destroy() {
      if (this.clearTimer) clearTimeout(this.clearTimer);
      this.clearTimer = null;
      this.cancelAnimations();
      void this.deactivate({ immediate: true });
      this.definitions.clear();
      this.loads.clear();
      this.failures.clear();
    }
  }

  return { PetSequenceAdapter, normalizedSequenceDefinition: normalizedDefinition };
});
