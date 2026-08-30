const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createTrackingPreparationController,
} = require('../src/renderer/tracking-preparation-controller');

test('tracking preparation restores and checkpoints the selected character draft', async () => {
  const draft = {
    version: 1, character_id: 1001, tier: 'T2', weather: 'Dark',
    cargo_before: 'Filament\t3', drone_before: '', notes: '', tags: [],
  };
  const calls = [];
  let scheduled = null;
  const controller = createTrackingPreparationController({
    api: {
      runs: {
        getTrackingDraft: async () => draft,
        saveTrackingDraft: async value => { calls.push(['save', value]); return value; },
      },
    },
    state: { activeCharId: 1001, activeRun: null, runState: 'awaiting' },
    trackingUi: {
      applyDraft: value => calls.push(['apply', value]),
      createDraft: () => draft,
    },
    restoreBaseline: async () => calls.push(['baseline']),
    afterRestore: stored => calls.push(['restored', stored]),
    onSaved: value => calls.push(['saved', value]),
    onError: error => { throw error; },
    setTimer: callback => { scheduled = callback; return 1; },
    clearTimer: () => {},
  });

  await controller.restore(1001);
  assert.deepEqual(calls.slice(0, 3), [
    ['apply', draft], ['saved', draft], ['restored', true],
  ]);
  controller.schedule();
  scheduled();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-2), ['save', draft]);
  assert.deepEqual(calls.at(-1), ['saved', draft]);
});
