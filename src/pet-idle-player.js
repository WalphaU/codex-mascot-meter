(function attachIdlePlayer(root, factory) {
  const api = factory(typeof module === 'object' && module.exports
    ? require('./pet-greeting-motion.js') : root.CodexPetAnimation);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CodexPetAnimation = Object.assign(root.CodexPetAnimation || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, (greetingAPI) => {
  'use strict';
  const { GREETING_DURATION_MS, sampleGreetingMotion, greetingPoint } = greetingAPI;
  const IDLE_CYCLE_MS = 6400;
  const W = 246, H = 292;
  const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t*t*t*(t*(t*6-15)+10); };
  // Pure animation clock: position AND velocity agree at the loop boundary.
  function sampleIdleMotion(milliseconds) {
    const t = ((milliseconds % IDLE_CYCLE_MS) + IDLE_CYCLE_MS) % IDLE_CYCLE_MS;
    const phase = t / IDLE_CYCLE_MS * Math.PI * 2;
    const breath = (1 - Math.cos(phase * 2)) / 2;
    const blinkTime = t - 2400;
    const blink = blinkTime < 0 || blinkTime >= 240 ? 0
      : blinkTime < 80 ? smooth(blinkTime / 80)
      : blinkTime < 110 ? 1 : 1 - smooth((blinkTime - 110) / 130);
    return { breath, lift: 2.2 * breath, sway: .8 * Math.sin(phase),
      follow: .65 * (Math.sin(phase * 2 - .65) - Math.sin(-.65)), blink };
  }
  function idleBand(y, motion) {
    const upper = 1 - smooth((y - 140) / 108);
    if (upper === 0) return { x: 0, y, scaleX: 1 };
    const hair = Math.exp(-Math.pow((y - 175) / 46, 2)) * upper;
    const chest = Math.exp(-Math.pow((y - 189) / 30, 2)) * upper;
    return { x: motion.sway * upper + motion.follow * hair,
      y: y - motion.lift * upper, scaleX: 1 + .008 * motion.breath * chest };
  }
  // Kept for integrations which address the original 24 source drawings.
  function idleFramePosition(frame) {
    const index = ((Math.trunc(frame) % 24) + 24) % 24;
    return `${index % 6 * 20}% ${Math.floor(index / 6) * 100 / 3}%`;
  }
  class PetIdlePlayer {
    constructor({ element, owner, asset, ImageCtor = globalThis.Image,
      requestFrame = callback => requestAnimationFrame(callback),
      cancelFrame = handle => cancelAnimationFrame(handle),
      createCanvas = () => document.createElement('canvas'),
      pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1),
      warn = (...args) => console.warn(...args) } = {}) {
      Object.assign(this, { element, owner, asset, ImageCtor, requestFrame, cancelFrame, createCanvas, pixelRatio, warn });
      this.active = false; this.ready = false; this.failed = false; this.destroyed = false;
      this.loading = null; this.timer = null; this.image = null;
      this.elapsed = 0; this.lastTime = null; this.lastDraw = -Infinity; this.renderCount = 0;
      this.canvas = null; this.context = null; this.base = null; this.closed = null; this.texture = null;
      this.greeting = null;
    }
    makeSurface() {
      const canvas = this.createCanvas(); canvas.width = W; canvas.height = H;
      if (!canvas.getContext('2d')) throw new Error('Canvas unavailable');
      return canvas;
    }
    prepare(image) {
      this.base = this.makeSurface(); this.closed = this.makeSurface(); this.texture = this.makeSurface();
      this.base.getContext('2d').drawImage(image, 0, 0, W, H, 0, 0, W, H);
      const closedCtx = this.closed.getContext('2d');
      closedCtx.drawImage(this.base, 0, 0);
      // Only borrow the closed eyelids. Never switch the head, silhouette or feet.
      // Each patch has a feathered perimeter, completely outside the iris.
      for (const box of [
        { x: 84, y: 118, w: 35, h: 27, sx: 85, sy: 121 },
        { x: 128, y: 108, w: 38, h: 29, sx: 132, sy: 113 }
      ]) {
        const patch = this.createCanvas(); patch.width = box.w; patch.height = box.h;
        const ctx = patch.getContext('2d');
        ctx.drawImage(image, W + box.sx, H + box.sy, box.w, box.h, 0, 0, box.w, box.h);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.save(); ctx.scale(box.w / 2, box.h / 2);
        const mask = ctx.createRadialGradient(1, 1, .78, 1, 1, 1);
        mask.addColorStop(0, '#fff'); mask.addColorStop(1, 'transparent');
        ctx.fillStyle = mask; ctx.fillRect(0, 0, 2, 2); ctx.restore();
        closedCtx.drawImage(patch, box.x, box.y);
      }
      this.canvas = this.createCanvas();
      this.canvas.width = Math.round(W * this.pixelRatio);
      this.canvas.height = Math.round(H * this.pixelRatio);
      this.canvas.setAttribute('aria-hidden', 'true');
      this.context = this.canvas.getContext('2d', { alpha: true });
      if (!this.context) throw new Error('Canvas unavailable');
      this.element.replaceChildren(this.canvas);
      this.element.dataset.renderer = 'continuous-idle';
    }
    fail(error) {
      if (this.failed || this.destroyed) return;
      this.failed = true; this.setActive(false);
      this.warn('[dynamic-pet] idle rendering failed; using static fallback', error?.message || error);
    }
    preload() {
      if (this.ready || this.failed || this.destroyed) return Promise.resolve(this.ready);
      if (this.loading) return this.loading;
      this.loading = new Promise(resolve => {
        try {
          const image = this.image = new this.ImageCtor();
          image.onerror = () => { this.fail('asset unavailable'); resolve(false); };
          image.onload = async () => {
            try {
              if (typeof image.decode === 'function') await image.decode();
              if (this.destroyed) return resolve(false);
              if (image.naturalWidth !== 1476 || image.naturalHeight !== 1168) throw new Error('Unexpected atlas dimensions');
              this.prepare(image); this.ready = true; resolve(true);
            } catch (error) { this.fail(error); resolve(false); }
          };
          image.src = this.asset;
        } catch (error) { this.fail(error); resolve(false); }
      });
      return this.loading;
    }
    renderAt(milliseconds, greetingTime = null) {
      const motion = sampleIdleMotion(milliseconds);
      const greeting = greetingTime === null ? null : sampleGreetingMotion(greetingTime);
      if (greeting) motion.blink = Math.max(motion.blink, greeting.blink);
      const textureCtx = this.texture.getContext('2d');
      textureCtx.clearRect(0, 0, W, H);
      textureCtx.drawImage(this.base, 0, 0);
      if (motion.blink > 0) {
        textureCtx.globalAlpha = motion.blink;
        textureCtx.drawImage(this.closed, 0, 0);
        textureCtx.globalAlpha = 1;
      }
      const ctx = this.context;
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (greeting) {
        this.drawGreetingMesh(ctx, motion, greeting);
      } else {
      // Continuous connected scanline deformation: no detached cutout joints.
      // A fixed foot zone pins the character independently from the window/button.
      for (let y = 0; y < H; y += 2) {
        const top = idleBand(y, motion), bottom = idleBand(y + 2, motion);
        const width = W * top.scaleX;
        ctx.drawImage(this.texture, 0, y, W, 2,
          (W - width) / 2 + top.x, top.y, width, bottom.y - top.y + .15);
      }
      }
      this.renderCount++;
      this.element.dataset.frame = String(Math.floor((milliseconds % IDLE_CYCLE_MS) / IDLE_CYCLE_MS * 24));
      this.owner.dataset.idleActive = 'true';
    }
    drawGreetingMesh(ctx, idle, greeting) {
      const point = (x, y) => {
        const band = idleBand(y, idle);
        return greetingPoint((x-W/2)*band.scaleX+W/2+band.x, band.y, greeting);
      };
      const triangle = (source, target) => {
        const [a,b,c] = source, [p,q,r] = target;
        const det = (b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
        const A = ((q.x-p.x)*(c.y-a.y)-(r.x-p.x)*(b.y-a.y))/det;
        const B = ((q.y-p.y)*(c.y-a.y)-(r.y-p.y)*(b.y-a.y))/det;
        const C = ((r.x-p.x)*(b.x-a.x)-(q.x-p.x)*(c.x-a.x))/det;
        const D = ((r.y-p.y)*(b.x-a.x)-(q.y-p.y)*(c.x-a.x))/det;
        ctx.save();
        ctx.beginPath();
        // Subpixel overlap prevents anti-aliased cracks between shared edges.
        const cx=(p.x+q.x+r.x)/3, cy=(p.y+q.y+r.y)/3;
        for (const [i,v] of target.entries()) {
          const dx=v.x-cx, dy=v.y-cy, length=Math.hypot(dx,dy);
          const x=v.x+dx/length*.35, y=v.y+dy/length*.35;
          if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
        }
        ctx.closePath(); ctx.clip();
        ctx.transform(A,B,C,D,p.x-A*a.x-C*a.y,p.y-B*a.x-D*a.y);
        ctx.drawImage(this.texture,0,0);
        ctx.restore();
      };
      // 16px connected grid, only while greeting; ordinary idle keeps its cheap strips.
      for (let y=0;y<H;y+=16) for(let x=0;x<W;x+=16) {
        const right=Math.min(W,x+16), bottom=Math.min(H,y+16);
        const a={x,y}, b={x:right,y}, c={x:right,y:bottom}, d={x,y:bottom};
        const p=point(x,y), q=point(right,y), r=point(right,bottom), s=point(x,bottom);
        triangle([a,b,c],[p,q,r]); triangle([a,c,d],[p,r,s]);
      }
    }
    async playGreeting(context) {
      if (context.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (!await this.preload() || !this.active) return false;
      if (context.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return new Promise((resolve, reject) => {
        const run = { start: this.elapsed, phase: '', signal: context.signal, context, resolve, reject };
        run.onAbort = () => this.finishGreeting(run, Object.assign(new Error('aborted'), { name: 'AbortError' }));
        this.greeting = run;
        context.signal.addEventListener('abort', run.onAbort, { once: true });
      });
    }
    finishGreeting(run, error = null) {
      if (this.greeting !== run) return;
      this.greeting = null;
      run.signal.removeEventListener('abort',run.onAbort);
      if (error) run.reject(error); else run.resolve(true);
    }
    queue() {
      if (!this.active || !this.ready || this.destroyed || this.timer !== null) return;
      this.timer = this.requestFrame(timestamp => {
        this.timer = null;
        if (!this.active || this.destroyed) return;
        if (this.lastTime !== null) this.elapsed += Math.max(0, Math.min(100, timestamp - this.lastTime));
        this.lastTime = timestamp;
        try {
          // 60fps target; skip redundant callbacks on high-refresh displays.
          if (timestamp - this.lastDraw >= 1000 / 60 - 1) {
            const run = this.greeting;
            const time = run ? Math.min(GREETING_DURATION_MS, this.elapsed-run.start) : null;
            this.renderAt(this.elapsed, time); this.lastDraw = timestamp;
            if (run) {
              const phase = sampleGreetingMotion(time).phase;
              if (phase !== run.phase) { run.phase=phase; run.context.setPhase(phase); }
              if (time >= GREETING_DURATION_MS) this.finishGreeting(run);
            }
          }
          this.queue();
        } catch (error) { this.fail(error); }
      });
    }
    setActive(active) {
      const next = Boolean(active) && !this.destroyed && !this.failed && !!this.element && !!this.owner;
      this.active = next;
      if (!next) {
        if (this.greeting) this.finishGreeting(this.greeting,
          Object.assign(new Error('greeting stopped'), { name: 'AbortError' }));
        if (this.timer !== null) this.cancelFrame(this.timer);
        this.timer = null; this.lastTime = null; this.lastDraw = -Infinity;
        if (this.owner) delete this.owner.dataset.idleActive;
        return;
      }
      const begin = () => {
        if (!this.active || this.destroyed || this.failed || this.timer !== null) return;
        try {
          this.renderAt(this.elapsed, this.greeting ? this.elapsed-this.greeting.start : null);
          this.queue();
        } catch (error) { this.fail(error); }
      };
      if (this.ready) begin();
      else void this.preload().then(ready => { if (ready) begin(); });
    }
    destroy() {
      this.setActive(false); this.destroyed = true;
      this.element?.replaceChildren();
      this.image = this.base = this.closed = this.texture = this.canvas = this.context = null;
    }
  }
  return { PetIdlePlayer, IDLE_CYCLE_MS, sampleIdleMotion, idleBand, idleFramePosition };
});
