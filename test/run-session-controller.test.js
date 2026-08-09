const assert = require('node:assert/strict');
const test = require('node:test');
const { createRunSessionController } = require('../src/renderer/run-session-controller');

function createHarness() {
  let activeRun = { character_id: 1001 };
  const saves = [];
  const clears = [];
  const timers = new Map();
  let nextTimer = 1;
  let syncCount = 0;
  const controller = createRunSessionController({
    getActiveRun: () => activeRun,
    createSnapshot: () => activeRun ? {
      version: 1,
      run: { character_id: activeRun.character_id },
    } : null,
    saveActive: async snapshot => {
      saves.push(snapshot);
      return true;
    },
    clearActive: async characterId => {
      clears.push(characterId);
      return true;
    },
    syncInputs: () => { syncCount++; },
    setTimer: callback => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: id => timers.delete(id),
  });
  return {
    clears,
    controller,
    get activeRun() { return activeRun; },
    saves,
    set activeRun(value) { activeRun = value; },
    get syncCount() { return syncCount; },
    timers,
  };
}

test('finalization invalidates appraisal work and cancels checkpoints', () => {
  const harness = createHarness();
  const { controller, activeRun, timers } = harness;
  const generation = controller.beginAppraisal(activeRun);
  controller.scheduleCheckpoint();
  assert.equal(timers.size, 1);
  assert.equal(controller.isCurrentAppraisal(activeRun, generation), true);

  assert.equal(controller.beginFinalization(activeRun), true);
  assert.equal(activeRun.finalizing, true);
  assert.equal(timers.size, 0);
  assert.equal(controller.isCurrentAppraisal(activeRun, generation), false);
  assert.equal(controller.beginFinalization(activeRun), false);
  assert.equal(controller.rollbackFinalization(activeRun), true);
  assert.equal(activeRun.finalizing, false);
  assert.equal(controller.isCurrent(activeRun), true);
});

test('suspension is a lifecycle boundary and can be resumed after failure', () => {
  const harness = createHarness();
  const { controller, activeRun } = harness;
  const generation = controller.beginAppraisal(activeRun);

  assert.equal(controller.suspend(activeRun), true);
  assert.equal(controller.isCurrent(activeRun), false);
  assert.equal(controller.isCurrentAppraisal(activeRun, generation), false);
  assert.equal(controller.resume(activeRun), true);
  assert.equal(controller.isCurrent(activeRun), true);
});

test('scheduled checkpoints recheck run identity before saving', async () => {
  const harness = createHarness();
  harness.controller.scheduleCheckpoint();
  const callback = [...harness.timers.values()][0];
  harness.activeRun = { character_id: 1002 };
  callback();
  await Promise.resolve();

  assert.equal(harness.syncCount, 0);
  assert.deepEqual(harness.saves, []);
});

test('checkpoint saves and clears are serialized', async () => {
  const events = [];
  let releaseSave;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const run = { character_id: 1001 };
  const controller = createRunSessionController({
    getActiveRun: () => run,
    createSnapshot: () => ({ version: 1, run: { character_id: 1001 } }),
    saveActive: async () => {
      events.push('save:start');
      await saveGate;
      events.push('save:end');
    },
    clearActive: async () => {
      events.push('clear');
    },
  });

  const save = controller.persist();
  const clear = controller.clearPersisted(1001);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, ['save:start']);

  releaseSave();
  await Promise.all([save, clear]);
  assert.deepEqual(events, ['save:start', 'save:end', 'clear']);
});

test('invalid controller dependencies fail fast', () => {
  assert.throws(
    () => createRunSessionController({}),
    /getActiveRun must be a function/
  );
  assert.throws(
    () => createRunSessionController({
      getActiveRun: () => null,
      createSnapshot: () => null,
      saveActive: async () => {},
      clearActive: async () => {},
      debounceMs: -1,
    }),
    /debounceMs/
  );
});
