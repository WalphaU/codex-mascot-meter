const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PetAnimationController,
  PET_ANIMATION_PRIORITIES
} = require('../src/pet-animation-controller.js');
const { normalizedSequenceDefinition } = require('../src/pet-sequence-adapter.js');
const {
  createPetAnimationActions,
  PET_RANDOM_ACTIONS, sequenceAction
} = require('../src/pet-animation-clips.js');

test('higher-priority drag interrupts a random action atomically', async () => {
  const states = [];
  const controller = new PetAnimationController({
    idleGap: 60_000,
    actions: {
      slow: { label: 'slow', enter: async () => {}, play: (ctx) => ctx.wait(1000), exit: async () => {} },
      drag: { label: 'drag', hold: () => {} },
      land: { label: 'land', enter: async () => {}, play: async () => {}, exit: async () => {} }
    },
    onStateChange: (state) => states.push(state)
  });
  await controller.start({ intro: false });
  const slow = controller.request('slow', { priority: PET_ANIMATION_PRIORITIES.random });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const holdId = controller.hold('drag', { priority: PET_ANIMATION_PRIORITIES.drag });
  assert.ok(holdId);
  const slowResult = await slow;
  assert.equal(slowResult.status, 'interrupted');
  assert.equal(controller.state, 'drag');
  const land = await controller.request('land', { priority: PET_ANIMATION_PRIORITIES.interaction, force: true });
  assert.equal(land.status, 'completed');
  assert.equal(controller.state, 'idle');
  assert.ok(states.includes('drag'));
  controller.stop();
});

test('completion callback fires once and transition duration is clamped to 150-250ms', async () => {
  let completed = 0;
  let finished = 0;
  const controller = new PetAnimationController({
    idleGap: 60_000,
    transitionMs: 20,
    actions: {
      sample: {
        label: 'sample',
        enter: async () => {},
        play: async () => {},
        exit: async () => {}
      }
    }
  });
  assert.equal(controller.transitionMs, 150);
  await controller.start({ intro: false });
  const result = await controller.request('sample', {
    transitionMs: 900,
    onComplete: () => { completed += 1; },
    onFinish: () => { finished += 1; }
  });
  assert.equal(result.status, 'completed');
  assert.equal(completed, 1);
  assert.equal(finished, 1);
  controller.stop();
});

test('animation failure recovers to idle without rejecting the caller', async () => {
  const errors = [];
  const controller = new PetAnimationController({
    idleGap: 60_000,
    actions: {
      broken: { enter: async () => {}, play: async () => { throw new Error('broken clip'); }, exit: async () => {} }
    },
    onError: (error) => errors.push(error.message)
  });
  await controller.start({ intro: false });
  const result = await controller.request('broken');
  assert.equal(result.status, 'failed');
  assert.equal(controller.state, 'idle');
  assert.deepEqual(errors, ['broken clip']);
  controller.stop();
});

test('legacy eight-frame definitions remain compatible and normalized', () => {
  const definition = normalizedSequenceDefinition({
    asset: './legacy.webp',
    order: [0, 1, 2, 3, 4, 5, 6, 7]
  });
  assert.equal(definition.asset, './legacy.webp');
  assert.equal(definition.frameCount, 8);
  assert.equal(definition.columns, 4);
  assert.equal(definition.rows, 2);
  assert.deepEqual(definition.order, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('no random ambient action remains while interaction lifecycle effects stay available', () => {
  assert.deepEqual(PET_RANDOM_ACTIONS, []);
  const actions = createPetAnimationActions({ sequenceAdapter: {} });
  assert.deepEqual(Object.keys(actions).sort(), [...PET_RANDOM_ACTIONS, 'enter', 'pet', 'land', 'drag'].sort());
});


test('a failed sequence uses the retained local fallback', async () => {
  const played = [];
  const actions = createPetAnimationActions({
    sequenceAdapter: { play: async () => false },
    playLegacy: async (name) => played.push(name)
  });
  await sequenceAction('legacy', 'legacy', 800, {
    sequenceAdapter: { play: async () => false }, playLegacy: async name => played.push(name)
  }).play({ data: {}, transitionMs: 180, setPhase() {} });
  assert.deepEqual(played, ['legacy']);
});

test('controller owns idle player visibility, drag interruption, reduction and cleanup', async () => {
  const updates = [];
  let destroyed = false;
  const controller = new PetAnimationController({
    idlePlayer: { setActive: active => updates.push(active), destroy: () => { destroyed = true; } },
    idleGap: 60_000, actions: { drag: { hold() {} } }
  });
  await controller.start({ intro: false });
  assert.equal(updates.at(-1), true);
  controller.hold('drag');
  assert.equal(updates.at(-1), false);
  controller.cancelCurrent();
  controller.settleIdle();
  assert.equal(updates.at(-1), true);
  controller.setVisibility(false);
  assert.equal(updates.at(-1), false);
  controller.setVisibility(true);
  assert.equal(updates.at(-1), true);
  controller.setReducedMotion(true);
  assert.equal(updates.at(-1), false);
  controller.setReducedMotion(false);
  assert.equal(updates.at(-1), true);
  controller.stop();
  assert.equal(updates.at(-1), false);
  controller.destroy();
  assert.equal(destroyed, true);
});

test('disabled random actions never schedule a background wakeup', async () => {
  const controller = new PetAnimationController({ randomEnabled: false });
  await controller.start({ intro: false });
  assert.equal(controller.idleTimer, null);
  controller.resume(); controller.setReducedMotion(false);
  assert.equal(controller.idleTimer, null);
  controller.destroy();
});
