const test = require('node:test');
const assert = require('node:assert/strict');
const { PetIdlePlayer, sampleIdleMotion, idleBand, IDLE_CYCLE_MS } = require('../src/pet-idle-player.js');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const timers = new Map(), images = [], warnings = [];
  let next = 1, clock = 0;
  const ctx = { drawImage() {}, clearRect() {}, setTransform() {}, save() {}, restore() {}, scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, transform() {},
    fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }) };
  const canvas = () => ({ getContext: () => ctx, setAttribute() {} });
  class FakeImage {
    constructor() { this.naturalWidth = 1476; this.naturalHeight = 1168; images.push(this); }
    decode() { return Promise.resolve(); }
  }
  const owner = { dataset: {} }, element = { dataset: {}, replaceChildren() {} };
  const player = new PetIdlePlayer({ owner, element, asset: './idle.png', ImageCtor: FakeImage,
    createCanvas: canvas, pixelRatio: 1,
    requestFrame: cb => { const id = next++; timers.set(id, cb); return id; },
    cancelFrame: id => timers.delete(id), warn: message => warnings.push(message) });
  const step = () => { const [id, cb] = timers.entries().next().value; timers.delete(id); clock += 1000/60; cb(clock); };
  return { player, owner, element, images, timers, step, warnings, ctx };
}
test('loop position and velocity are continuous; feet never move', () => {
  assert.deepEqual(sampleIdleMotion(0), sampleIdleMotion(IDLE_CYCLE_MS));
  for (let t = 0; t < IDLE_CYCLE_MS; t += 16) {
    const m = sampleIdleMotion(t);
    const band = idleBand(284, m);
    assert.deepEqual(band, { x: 0, y: 284, scaleX: 1 });
    assert.ok(m.blink >= 0 && m.blink <= 1);
  }
  for (const key of ['breath', 'lift', 'sway', 'follow', 'blink']) {
    const before = sampleIdleMotion(IDLE_CYCLE_MS - .01)[key];
    const after = sampleIdleMotion(.01)[key];
    const center = sampleIdleMotion(0)[key];
    assert.ok(Math.abs((center-before) - (after-center)) < .000001, key);
  }
  assert.equal(sampleIdleMotion(2480).blink, 1);
  assert.equal(sampleIdleMotion(2640).blink, 0);
});
test('continuous clock draws without duplicate queues or repeated decodes', async () => {
  const f = fixture();
  f.player.setActive(true); await f.images[0].onload(); await flush();
  for (let i = 0; i < 400; i++) {
    f.player.setActive(true); assert.equal(f.timers.size, 1); f.step();
  }
  assert.ok(f.player.renderCount >= 390);
  assert.equal(f.images.length, 1);
  assert.equal(f.owner.dataset.idleActive, 'true');
  f.player.destroy(); assert.equal(f.timers.size, 0);
});
test('drag/hide cancels immediately; resume excludes time spent hidden', async () => {
  const f = fixture(); f.player.setActive(true); f.player.setActive(false);
  await f.images[0].onload(); await flush();
  assert.equal(f.timers.size, 0); assert.equal(f.owner.dataset.idleActive, undefined);
  f.player.setActive(true); f.step(); f.step();
  const phase = f.player.elapsed;
  f.player.setActive(false); assert.equal(f.timers.size, 0);
  f.player.setActive(true); f.step();
  assert.equal(f.player.elapsed, phase);
  f.player.destroy();
});
test('asset, size and drawing failures recover locally without retry loops', async () => {
  for (const kind of ['load', 'size', 'draw']) {
    const f = fixture(); f.player.setActive(true);
    if (kind === 'load') f.images[0].onerror();
    else {
      if (kind === 'size') f.images[0].naturalWidth = 3;
      await f.images[0].onload(); await flush();
      if (kind === 'draw') { f.ctx.drawImage = () => { throw Error('context lost'); }; f.step(); }
    }
    await flush(); f.player.setActive(true);
    assert.equal(f.timers.size, 0); assert.equal(f.owner.dataset.idleActive, undefined);
    assert.equal(f.images.length, 1); assert.equal(f.warnings.length, 1);
  }
});
test('destroy during preload never schedules or displays frames', async () => {
  const f = fixture(); f.player.setActive(true); f.player.destroy();
  await f.images[0].onload(); await flush();
  assert.equal(f.timers.size, 0); assert.equal(f.owner.dataset.idleActive, undefined);
});

test('early preload decodes once without showing a canvas or scheduling frames', async () => {
  const f=fixture(); const ready=f.player.preload();
  await f.images[0].onload(); assert.equal(await ready,true);
  assert.equal(f.timers.size,0); assert.equal(f.owner.dataset.idleActive,undefined);
  f.player.setActive(true);
  assert.equal(f.owner.dataset.idleActive,'true'); assert.equal(f.images.length,1);
  f.player.destroy();
});

test('greeting uses one existing clock, resolves once and resumes exact idle phase', async () => {
  const f=fixture(); f.player.setActive(true); await f.images[0].onload(); await flush();
  const abort=new AbortController(), phases=[];
  const greeting=f.player.playGreeting({signal:abort.signal,setPhase:p=>phases.push(p)});
  await flush();
  for(let i=0;i<180;i++) { assert.equal(f.timers.size,1); f.step(); }
  assert.equal(await greeting,true); assert.equal(f.player.greeting,null);
  assert.deepEqual(phases,['anticipate','acknowledge','nod','recover','settle']);
  assert.equal(f.owner.dataset.idleActive,'true'); assert.equal(f.images.length,1);
  assert.ok(f.player.elapsed>2800);
  f.player.destroy();
});

test('greeting abort and render failure do not strand a promise or a RAF loop', async () => {
  for(const failure of ['abort','draw']) {
    const f=fixture(); f.player.setActive(true); await f.images[0].onload(); await flush();
    const abort=new AbortController();
    const greeting=f.player.playGreeting({signal:abort.signal,setPhase(){}});
    const rejected=assert.rejects(greeting,{name:'AbortError'});
    await flush();
    if(failure==='abort') abort.abort();
    else { f.ctx.drawImage=()=>{throw Error('context lost');}; f.step(); }
    await rejected;
    assert.equal(f.player.greeting,null);
    if(failure==='draw') { assert.equal(f.timers.size,0); assert.equal(f.warnings.length,1); }
    f.player.destroy();
  }
});
