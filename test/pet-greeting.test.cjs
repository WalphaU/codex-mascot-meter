const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleGreetingMotion, greetingPoint, GREETING_DURATION_MS } = require('../src/pet-greeting-motion.js');
const { PetAnimationController } = require('../src/pet-animation-controller.js');
const { createPetAnimationActions } = require('../src/pet-animation-clips.js');

test('greeting channels settle with zero endpoint velocity and pinned feet', () => {
  for (const key of ['nod','tilt','follow','blink']) {
    assert.equal(sampleGreetingMotion(0)[key],0);
    assert.ok(Math.abs(sampleGreetingMotion(GREETING_DURATION_MS)[key]) < 1e-12);
    assert.ok(Math.abs(sampleGreetingMotion(.01)[key]) < 1e-8);
    assert.ok(Math.abs(sampleGreetingMotion(GREETING_DURATION_MS-.01)[key]) < 1e-8);
  }
  for (let t=0;t<=2800;t+=16) {
    const motion=sampleGreetingMotion(t);
    for(let y=192;y<=292;y+=4) for(let x=0;x<=246;x+=4) {
      assert.deepEqual(greetingPoint(x,y,motion),{x,y}, 'hands and skirt must not move with greeting');
    }
    assert.deepEqual(greetingPoint(103,280,motion),{x:103,y:280});
    assert.deepEqual(greetingPoint(147,280,motion),{x:147,y:280});
    // No local triangle flips: the connected skin must never fold inside out.
    for (let y=160;y<250;y+=4) for(let x=30;x<116;x+=4) {
      const p=greetingPoint(x,y,motion), q=greetingPoint(x+1,y,motion), r=greetingPoint(x,y+1,motion);
      const det=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
      assert.ok(det>.02, `skin fold at ${t}/${x}/${y}: ${det}`);
    }
  }
});

test('greeting reuses continuous idle surface, coalesces clicks and yields to drag', async () => {
  let calls=0, finished=0;
  const active=[];
  const actions=createPetAnimationActions({sequenceAdapter:{},playLegacy:async()=>{},
    playGreeting:ctx=>{calls++; return ctx.wait(10000);}});
  const controller=new PetAnimationController({actions,randomEnabled:false,
    idlePlayer:{setActive:value=>active.push(value)}});
  await controller.start({intro:false});
  const playing=controller.request('pet',{onFinish:()=>finished++});
  await Promise.resolve(); await Promise.resolve();
  for(let i=0;i<20;i++) assert.equal((await controller.request('pet',{force:true})).reason,'already-playing');
  assert.equal(calls,1); assert.equal(active.at(-1),true);
  controller.hold('drag');
  assert.equal((await playing).status,'interrupted');
  assert.equal(active.at(-1),false); assert.equal(finished,1);
  controller.stop();
});

test('reduced motion, hidden mode and missing greeting renderer are safe', async () => {
  let calls=0;
  const actions=createPetAnimationActions({sequenceAdapter:{},playLegacy:async()=>{},
    playGreeting:ctx=>{calls++;return ctx.wait(10000);}});
  const controller=new PetAnimationController({actions,randomEnabled:false,reducedMotion:true});
  await controller.start({intro:false});
  assert.equal((await controller.request('pet')).status,'completed'); assert.equal(calls,0);
  controller.setReducedMotion(false);
  const pending=controller.request('pet'); await Promise.resolve(); await Promise.resolve();
  controller.setVisibility(false);
  assert.equal((await pending).status,'interrupted');
  controller.stop();
  const fallback=new PetAnimationController({randomEnabled:false,actions:createPetAnimationActions({sequenceAdapter:{}})});
  await fallback.start({intro:false});
  assert.equal((await fallback.request('pet')).status,'completed');
  fallback.stop();
});
