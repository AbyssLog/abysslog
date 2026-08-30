const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const { createLoadoutController } = require('../src/renderer/loadout-controller');

test('loadout dropdowns sort saved presets alphabetically without changing selection', () => {
  const dom = new JSDOM(`
    <select id="loadoutPresetSelect"></select>
    <button id="applyLoadoutBtn"></button>
    <select id="loadoutManagerSelect"></select>
    <input id="loadoutNameInput">
    <textarea id="loadoutCargoText"></textarea>
    <textarea id="loadoutDroneText"></textarea>
    <textarea id="cargoBeforeText"></textarea>
    <textarea id="droneBeforeText"></textarea>
    <button id="deleteLoadoutBtn"></button>
    <div id="loadoutEditorStatus"></div>
  `);
  const document = dom.window.document;
  const state = {
    runState: 'awaiting',
    activeRun: null,
    loadoutPresets: [
      { id: 'zulu', name: 'Zulu', cargo: [], drone: [] },
      { id: 'alpha', name: 'alpha 2', cargo: [], drone: [] },
      { id: 'beta', name: 'Beta', cargo: [], drone: [] },
      { id: 'alpha-ten', name: 'Alpha 10', cargo: [], drone: [] },
    ],
  };
  const controller = createLoadoutController({
    document,
    api: { loadouts: { save: async presets => presets } },
    state,
    loadouts: { formatInventoryItems: () => '' },
    openModal: () => {},
    applyInventory: () => {},
    setInventoryText: (id, value) => { document.getElementById(id).value = value; },
    confirmAction: () => true,
    createId: () => 'created',
  });

  controller.renderPresetSelect('beta');
  const trackerSelect = document.getElementById('loadoutPresetSelect');
  assert.deepEqual([...trackerSelect.options].map(option => option.textContent), [
    '-- No presets saved --', 'alpha 2', 'Alpha 10', 'Beta', 'Zulu',
  ]);
  assert.equal(trackerSelect.value, 'beta');

  controller.openManager();
  const managerSelect = document.getElementById('loadoutManagerSelect');
  assert.deepEqual([...managerSelect.options].map(option => option.textContent), [
    '-- New preset --', 'alpha 2', 'Alpha 10', 'Beta', 'Zulu',
  ]);
  assert.equal(managerSelect.value, 'beta');
});
