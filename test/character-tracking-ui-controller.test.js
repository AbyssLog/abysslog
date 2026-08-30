const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const {
  createCharacterTrackingUiController,
} = require('../src/renderer/character-tracking-ui-controller');

test('character dropdown carries concurrent status and preparations remain character scoped', () => {
  const dom = new JSDOM(`
    <select id="charSelect"><option value="1001">First</option><option value="1002">Second</option></select>
    <span id="trackingSummary" hidden></span>
    <div id="activeEncounterStatus" hidden><span id="activeEncounterText"></span><span id="encounterCandidateActions" hidden></span></div>
    <select id="tierSelect"><option>T2</option><option>T5</option></select>
    <select id="weatherSelect"><option>Dark</option><option>Gamma</option></select>
    <textarea id="cargoBeforeText"></textarea>
    <textarea id="droneBeforeText"></textarea>
    <textarea id="activeRunNotes"></textarea>
    <input id="activeRunTags">
  `);
  const document = dom.window.document;
  const state = {
    characters: [{ id: 1001, name: 'First' }, { id: 1002, name: 'Second' }],
    activeCharId: 1001,
    activeRun: {
      character_id: 1001,
      encounter_uid: '550e8400-e29b-41d4-a716-446655440000',
    },
    runState: 'in-abyss',
  };
  const controller = createCharacterTrackingUiController({
    document,
    state,
    parseTags: value => value.split(',').map(tag => tag.trim()).filter(Boolean),
    setInventoryText: (id, value) => { document.getElementById(id).value = value; },
  });

  controller.applyDraft({
    tier: 'T2', weather: 'Dark', cargo_before: 'Filament\t3', drone_before: '',
    notes: 'Prepared', tags: ['Group'],
  });
  assert.equal(controller.createDraft().cargo_before, 'Filament\t3');
  controller.renderStatuses(characterId => characterId === 1002 ? 'Needs Cargo' : 'Monitoring');
  assert.deepEqual([...document.getElementById('charSelect').options].map(option => option.textContent), [
    'First · In Abyss', 'Second · Needs Cargo',
  ]);
  assert.equal(document.getElementById('trackingSummary').textContent, '1 active · 1 needs attention');

  controller.renderEncounter(
    () => [{ character_name: 'First' }, { character_name: 'Second' }],
    () => []
  );
  assert.equal(document.getElementById('activeEncounterStatus').hidden, false);
  assert.match(document.getElementById('activeEncounterText').textContent, /2 characters/);
});
