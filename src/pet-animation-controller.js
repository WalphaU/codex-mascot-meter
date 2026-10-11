(function attachPetAnimationController(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CodexPetAnimation = Object.assign(root.CodexPetAnimation || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  const PET_ANIMATION_PRIORITIES = Object.freeze({
    idle: 0,
    random: 100,
    explicit: 500,
    interaction: 800,
    drag: 900,
    system: 1000
  });

  function abortError(reason = 'aborted') {
    const error = new Error(String(reason || 'aborted'));
    error.name = 'AbortError';
    return error;
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
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

  class PetAnimationController {
    constructor({
      actions = {},
      idlePlayer = null,
      randomEnabled = true,
      idleGap = 10_000,
      transitionMs = 180,
      chooseAction = () => null,
      onStateChange = () => {},
      onPhaseChange = () => {},
      onError = (...args) => console.warn(...args),
      reducedMotion = false
    } = {}) {
      this.idlePlayer = idlePlayer;
      this.randomEnabled = Boolean(randomEnabled);
      this.actions = new Map(Object.entries(actions));
      this.idleGap = Math.max(0, Number(idleGap) || 10_000);
      this.transitionMs = Math.max(150, Math.min(250, Number(transitionMs) || 180));
      this.chooseAction = chooseAction;
      this.onStateChange = onStateChange;
      this.onPhaseChange = onPhaseChange;
      this.onError = onError;
      this.reducedMotion = Boolean(reducedMotion);
      this.enabled = false;
      this.visible = true;
      this.paused = false;
      this.state = 'idle';
      this.phase = 'idle';
      this.current = null;
      this.idleTimer = null;
      this.serial = 0;
      this.lastRandomAction = '';
      this.destroyed = false;
    }

    register(name, definition) {
      if (!name || !definition) throw new TypeError('Animation name and definition are required.');
      this.actions.set(String(name), definition);
      return this;
    }

    clearIdleTimer() {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    setPhase(phase, metadata = {}) {
      this.phase = String(phase || 'idle');
      this.onPhaseChange(this.phase, { state: this.state, ...metadata });
    }

    setState(state, metadata = {}) {
      this.state = String(state || 'idle');
      this.onStateChange(this.state, metadata);
      this.syncIdleVisual();
    }

    syncIdleVisual() {
      // The same state owner starts/stops idle playback, including interruption and hiding.
      try {
        this.idlePlayer?.setActive(this.enabled && this.visible && !this.paused &&
          !this.reducedMotion && !this.destroyed &&
          (this.state === 'idle' || Boolean(this.actions.get(this.state)?.continuousVisual)));
      } catch (error) {
        this.onError(error, { action: 'idle' });
      }
    }

    createContext(run, definition, options) {
      const controller = this;
      return {
        controller,
        signal: run.abortController.signal,
        transitionMs: options.transitionMs,
        duration: Math.max(0, Number(options.duration ?? definition.duration) || 0),
        data: Object.create(null),
        wait(milliseconds) { return wait(milliseconds, run.abortController.signal); },
        setPhase(phase) {
          if (controller.current?.id === run.id) controller.setPhase(phase, { action: run.action });
        },
        async animate(element, keyframes, timing = {}) {
          throwIfAborted(run.abortController.signal);
          if (!element || typeof element.animate !== 'function') {
            await wait(Number(timing.duration) || 0, run.abortController.signal);
            return;
          }
          const animation = element.animate(keyframes, {
            fill: 'both',
            iterations: 1,
            easing: 'linear',
            ...timing
          });
          run.animations.add(animation);
          const onAbort = () => animation.cancel();
          run.abortController.signal.addEventListener('abort', onAbort, { once: true });
          try {
            await animation.finished;
          } catch (error) {
            if (run.abortController.signal.aborted) throw abortError(run.abortController.signal.reason);
            throw error;
          } finally {
            run.abortController.signal.removeEventListener('abort', onAbort);
            run.animations.delete(animation);
            try { animation.cancel(); } catch {}
          }
        }
      };
    }

    cancelCurrent(reason = 'cancelled') {
      const run = this.current;
      if (!run) return;
      this.current = null;
      if (!run.abortController.signal.aborted) run.abortController.abort(reason);
      for (const animation of run.animations) {
        try { animation.cancel(); } catch {}
      }
      run.animations.clear();
      if (run.manual) run.finish?.({ action: run.action, status: 'interrupted', reason });
    }

    scheduleRandom(delay = this.idleGap) {
      this.clearIdleTimer();
      if (!this.randomEnabled || !this.enabled || this.paused || !this.visible || this.reducedMotion || this.destroyed) return;
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (!this.enabled || this.paused || !this.visible || this.current) return;
        const action = this.chooseAction({ lastAction: this.lastRandomAction, state: this.state });
        if (!action || !this.actions.has(action)) {
          this.scheduleRandom();
          return;
        }
        this.lastRandomAction = action;
        void this.request(action, { priority: PET_ANIMATION_PRIORITIES.random, source: 'random' });
      }, Math.max(0, delay));
    }

    settleIdle({ schedule = true, reason = 'idle' } = {}) {
      if (this.destroyed) return;
      this.setState('idle', { label: '待机呼吸', reason });
      this.setPhase('idle', { reason });
      if (schedule) this.scheduleRandom();
    }

    start({ intro = true } = {}) {
      if (this.destroyed) return Promise.resolve({ status: 'destroyed' });
      this.enabled = true;
      this.paused = false;
      this.clearIdleTimer();
      this.cancelCurrent('restart');
      if (intro && this.actions.has('enter') && !this.reducedMotion) {
        return this.request('enter', { priority: PET_ANIMATION_PRIORITIES.explicit, source: 'system', force: true });
      }
      this.settleIdle();
      return Promise.resolve({ action: 'idle', status: 'completed', reason: 'started' });
    }

    stop(reason = 'stopped') {
      this.enabled = false;
      this.clearIdleTimer();
      this.cancelCurrent(reason);
      this.settleIdle({ schedule: false, reason });
    }

    pause(reason = 'paused') {
      this.paused = true;
      this.clearIdleTimer();
      this.cancelCurrent(reason);
      this.settleIdle({ schedule: false, reason });
    }

    resume() {
      if (!this.enabled || this.destroyed) return;
      this.paused = false;
      this.settleIdle();
    }

    setVisibility(visible) {
      const next = Boolean(visible);
      if (this.visible === next) return;
      this.visible = next;
      if (!next) this.pause('hidden');
      else if (this.enabled) this.resume();
    }

    setReducedMotion(enabled) {
      this.reducedMotion = Boolean(enabled);
      if (this.reducedMotion) {
        this.clearIdleTimer();
        if (this.current?.priority <= PET_ANIMATION_PRIORITIES.random ||
          this.actions.get(this.current?.action)?.continuousVisual) this.cancelCurrent('reduced-motion');
        this.settleIdle({ schedule: false, reason: 'reduced-motion' });
      } else if (this.enabled && this.visible && !this.paused) {
        this.scheduleRandom();
      }
      this.syncIdleVisual();
    }

    hold(action, { priority = PET_ANIMATION_PRIORITIES.drag, label = '', source = 'interaction', onFinish } = {}) {
      if (!this.enabled || this.destroyed || !this.actions.has(action)) return null;
      if (this.current && priority < this.current.priority) return null;
      this.clearIdleTimer();
      this.cancelCurrent(`preempted-by-${action}`);
      const definition = this.actions.get(action);
      const abortController = new AbortController();
      const run = {
        id: ++this.serial,
        action,
        priority,
        source,
        manual: true,
        abortController,
        animations: new Set(),
        finish: onFinish
      };
      this.current = run;
      this.setState(action, { label: label || definition.label || action, priority, source, manual: true });
      this.setPhase('active', { action, source, manual: true });
      definition.hold?.(this.createContext(run, definition, { duration: 0, transitionMs: this.transitionMs }));
      return run.id;
    }

    async request(action, options = {}) {
      const name = String(action || '');
      const definition = this.actions.get(name);
      if (!definition) return { action: name, status: 'failed', reason: 'unknown-action' };
      if ((!this.enabled && !options.force) || this.destroyed) return { action: name, status: 'ignored', reason: 'disabled' };
      if (definition.ignoreRepeat && this.current?.action === name) {
        const result = { action: name, status: 'ignored', reason: 'already-playing' };
        options.onFinish?.(result);
        return result;
      }
      const priority = Number(options.priority ?? definition.priority ?? PET_ANIMATION_PRIORITIES.explicit);
      if (this.current && priority < this.current.priority && !options.force) {
        const result = { action: name, status: 'ignored', reason: 'lower-priority' };
        options.onFinish?.(result);
        return result;
      }

      this.clearIdleTimer();
      this.cancelCurrent(`preempted-by-${name}`);
      const abortController = new AbortController();
      const run = {
        id: ++this.serial,
        action: name,
        priority,
        source: options.source || 'explicit',
        manual: false,
        abortController,
        animations: new Set()
      };
      this.current = run;
      const transitionMs = Math.max(150, Math.min(250, Number(options.transitionMs) || this.transitionMs));
      const context = this.createContext(run, definition, {
        transitionMs,
        duration: options.duration
      });
      const metadata = {
        label: options.label || definition.label || name,
        priority,
        source: run.source,
        transitionMs
      };
      let result;
      try {
        this.setState(name, metadata);
        this.setPhase('prepare', { action: name });
        if (definition.enter) await definition.enter(context);
        else await context.wait(transitionMs);
        throwIfAborted(abortController.signal);
        this.setPhase('active', { action: name });
        if (definition.play) await definition.play(context);
        else await context.wait(Math.max(0, context.duration - transitionMs * 2));
        throwIfAborted(abortController.signal);
        this.setPhase('settle', { action: name });
        if (definition.exit) await definition.exit(context);
        else await context.wait(transitionMs);
        throwIfAborted(abortController.signal);
        result = { action: name, status: 'completed', reason: 'finished' };
        definition.onComplete?.(result);
        options.onComplete?.(result);
      } catch (error) {
        if (isAbortError(error) || abortController.signal.aborted) {
          result = { action: name, status: 'interrupted', reason: String(abortController.signal.reason || 'cancelled') };
          try { await definition.cancel?.(context, result); } catch {}
        } else {
          result = { action: name, status: 'failed', reason: error?.message || 'animation-error' };
          this.onError(error, { action: name, source: run.source });
          try { await definition.recover?.(context, error); } catch {}
        }
      } finally {
        try { await definition.cleanup?.(context, result); } catch {}
        for (const animation of run.animations) {
          try { animation.cancel(); } catch {}
        }
        run.animations.clear();
        options.onFinish?.(result);
        if (this.current?.id === run.id) {
          this.current = null;
          this.settleIdle({ schedule: this.enabled && this.visible && !this.paused, reason: result?.reason });
        }
      }
      return result;
    }

    destroy() {
      this.destroyed = true;
      this.enabled = false;
      this.clearIdleTimer();
      this.cancelCurrent('destroyed');
      this.actions.clear();
      this.idlePlayer?.destroy();
    }
  }

  return { PetAnimationController, PET_ANIMATION_PRIORITIES, petAnimationWait: wait };
});
