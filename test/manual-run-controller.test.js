const assert = require('node:assert/strict');
const test = require('node:test');

const { JSDOM } = require('jsdom');
const {
  createManualRunController,
  parseDuration,
} = require('../src/renderer/manual-run-controller');

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createHarness(overrides = {}) {
  const dom = new JSDOM(`
    <div id="manualEntryModal">
      <button></button>
      <span id="manualEntryTitle"></span>
      <span id="manualSubmitLabel"></span>
      <button id="manualSaveBtn"></button>
      <select id="manualTier"><option value=""></option><option value="T4">T4</option></select>
      <select id="manualWeather"><option value=""></option><option value="Gamma">Gamma</option></select>
      <select id="manualOutcome"><option>Survived</option><option>Died</option></select>
      <input id="manualDuration">
      <input id="manualDate">
      <select id="manualShipClass"><option>Unknown</option><option>Cruiser</option></select>
      <input id="manualHullName">
      <input id="manualSystemName">
      <input id="manualTags">
      <textarea id="manualNotes"></textarea>
      <textarea id="manualCargoBefore"></textarea>
      <textarea id="manualCargoAfter"></textarea>
      <textarea id="manualDroneBefore"></textarea>
      <textarea id="manualDroneAfter"></textarea>
      <span id="manualSpinner"></span>
      <div id="manualEntryStatus"></div>
      <div id="manualCargoAfterCol"></div>
    </div>
  `);
  const state = {
    activeCharId: 9001,
    hasJaniceKey: true,
    settings: { default_tier: 'T4', default_weather: 'Gamma' },
  };
  const calls = { close: [], open: [], refresh: 0, save: [], update: [] };
  const api = {
    janice: { appraise: async () => ({}) },
    runs: {
      getById: async () => null,
      save: async run => { calls.save.push(run); return 1; },
      update: async (id, update) => { calls.update.push([id, update]); return true; },
    },
  };
  const appraisal = {
    appraiseSurvivedInventory: async () => ({
      loot_value: 120,
      consumed_cost: 20,
      net_isk: 100,
      items: [{ item_name: 'Loot', qty: 1, type: 'gained' }],
    }),
    appraiseLostInventory: async () => ({ total_loss: 200, items: [] }),
  };
  Object.assign(api.runs, overrides.runs || {});
  Object.assign(appraisal, overrides.appraisal || {});
  const controller = createManualRunController({
    document: dom.window.document,
    api,
    state,
    appraisal,
    parseTags: value => value.split(',').map(tag => tag.trim()).filter(Boolean),
    parseInventory: value => value ? [{ item_name: value, qty: 1 }] : [],
    mergeInventory: (left, right) => [...left, ...right],
    setInventoryText: (id, value) => { dom.window.document.getElementById(id).value = value; },
    formatIsk: String,
    escapeHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    openModal: id => calls.open.push(id),
    closeModal: id => calls.close.push(id),
    refreshSavedRunViews: async () => { calls.refresh++; },
    now: () => 1_800_000_000_000,
  });
  return { calls, controller, document: dom.window.document, state };
}

test('manual run controller opens defaults and saves a current-character run', async () => {
  const { calls, controller, document } = createHarness();
  controller.openNew();
  assert.equal(document.getElementById('manualTier').value, 'T4');
  assert.equal(document.getElementById('manualWeather').value, 'Gamma');
  assert.equal(calls.open.at(-1), 'manualEntryModal');
  document.getElementById('manualDuration').value = '12:34';
  document.getElementById('manualHullName').value = 'Gila';
  document.getElementById('manualCargoAfter').value = 'Loot';

  await controller.submit(true);
  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0].character_id, 9001);
  assert.equal(calls.save[0].duration, 754);
  assert.equal(calls.save[0].hull_name, 'Gila');
  assert.equal(calls.refresh, 1);
  assert.equal(calls.close.at(-1), 'manualEntryModal');
});

test('manual run controller ignores a stale edit response after character change', async () => {
  const gate = deferred();
  const { calls, controller, state } = createHarness({
    runs: { getById: async () => gate.promise },
  });
  const opening = controller.openEdit(7);
  state.activeCharId = 9002;
  gate.resolve({ id: 7, outcome: 'Survived', duration: 600, tags: [] });
  await opening;
  assert.deepEqual(calls.open, []);
});

test('manual appraisal is single-flight and cannot save after a character switch', async () => {
  const gate = deferred();
  let appraisalCalls = 0;
  const { calls, controller, document, state } = createHarness({
    appraisal: {
      appraiseSurvivedInventory: async () => {
        appraisalCalls++;
        return gate.promise;
      },
    },
  });
  controller.openNew();
  const first = controller.submit(true);
  const second = controller.submit(true);
  state.activeCharId = 9002;
  gate.resolve({ loot_value: 1, consumed_cost: 0, net_isk: 1, items: [] });
  await Promise.all([first, second]);

  assert.equal(appraisalCalls, 1);
  assert.equal(calls.save.length, 0);
  assert.match(document.getElementById('manualEntryStatus').textContent, /active character changed/i);
  assert.equal(document.getElementById('manualTier').disabled, false);
});

test('manual edit stages re-appraisal until an explicit save', async () => {
  const { calls, controller, document } = createHarness({
    runs: {
      getById: async () => ({
        id: 7,
        tier: 'T4',
        weather: 'Gamma',
        outcome: 'Survived',
        duration: 600,
        started_at: 1_700_000_000,
        hull_name: 'Gila',
        ship_class: 'Cruiser',
        tags: ['Farm'],
        total_loss: 0,
      }),
    },
  });
  await controller.openEdit(7);
  await controller.submit(true);
  assert.equal(calls.update.length, 0);
  assert.match(document.getElementById('manualEntryStatus').textContent, /preview/i);

  await controller.submit(false);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0][0], 7);
  assert.equal(calls.update[0][1].appraisal.net_isk, 100);
  assert.equal(calls.refresh, 1);
});

test('manual duration parsing supports seconds, minutes, and hours', () => {
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('12:34'), 754);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration(''), 0);
});
