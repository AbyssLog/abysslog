const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const {
  createManualEncounterController,
} = require('../src/renderer/manual-encounter-controller');

test('manual group entry appraises participants and saves one atomic encounter request', async () => {
  const dom = new JSDOM('<div id="manualEncounterModalMount"></div>');
  const document = dom.window.document;
  const saved = [];
  const modalCalls = [];
  let refreshes = 0;
  const controller = createManualEncounterController({
    document,
    api: {
      runs: {
        saveEncounter: async encounter => { saved.push(encounter); return [1, 2, 3]; },
      },
      janice: { appraise: async () => ({}) },
    },
    state: {
      activeCharId: 1001,
      hasJaniceKey: true,
      settings: { default_tier: 'T2', default_weather: 'Dark' },
      characters: [
        { id: 1001, name: 'First' },
        { id: 1002, name: 'Second' },
        { id: 1003, name: 'Third' },
      ],
    },
    appraisal: {
      appraiseSurvivedInventory: async () => ({
        loot_value: 100,
        consumed_cost: 10,
        net_isk: 90,
        items: [],
      }),
      appraiseLostInventory: async () => ({ total_loss: 50, items: [] }),
    },
    inventoryEditors: { initialize: () => {} },
    parseTags: value => value.split(',').map(tag => tag.trim()).filter(Boolean),
    parseInventory: () => [],
    mergeInventory: () => [],
    escapeHtml: value => String(value),
    openModal: id => modalCalls.push(['open', id]),
    closeModal: id => modalCalls.push(['close', id]),
    refreshSavedRunViews: async () => { refreshes++; },
    now: () => Date.UTC(2026, 7, 29, 12, 0, 0),
  });

  controller.open();
  assert.equal(controller.hasUnsavedInput(), false);
  controller.addParticipant(1003);
  assert.equal(controller.hasUnsavedInput(), true);
  assert.equal(document.querySelectorAll('[data-manual-participant]').length, 3);
  document.getElementById('manualEncounterShipClass').value = 'Destroyer';
  controller.handleDefinitionChange(document.getElementById('manualEncounterShipClass'));
  assert.equal(document.querySelectorAll('[data-manual-participant]').length, 2);
  document.getElementById('manualEncounterShipClass').value = 'Frigate';
  controller.handleDefinitionChange(document.getElementById('manualEncounterShipClass'));
  controller.addParticipant(1003);

  const nodes = [...document.querySelectorAll('[data-manual-participant]')];
  nodes.forEach((node, position) => {
    const index = node.dataset.manualParticipant;
    document.getElementById(`manualEncounterCharacter${index}`).value = String(1001 + position);
    document.getElementById(`manualEncounterHull${index}`).value = 'Hawk';
    document.getElementById(`manualEncounterCargoBefore${index}`).value = 'Inferno Rocket\t1000';
    document.getElementById(`manualEncounterCargoAfter${index}`).value = 'Inferno Rocket\t700';
  });
  document.getElementById('manualEncounterDuration').value = '12:30';
  document.getElementById('manualEncounterSystem').value = 'Abyssal test';

  await controller.submit();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].participants.length, 3);
  assert.deepEqual(saved[0].participants.map(participant => participant.character_id), [
    1001, 1002, 1003,
  ]);
  assert.equal(saved[0].participants.every(participant => (
    participant.tier === 'T2'
    && participant.weather === 'Dark'
    && participant.duration === 750
    && participant.ship_class === 'Frigate'
  )), true);
  assert.equal(refreshes, 1);
  assert.deepEqual(modalCalls, [
    ['open', 'manualEncounterModal'],
    ['close', 'manualEncounterModal'],
  ]);
});
