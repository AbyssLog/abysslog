const assert = require('node:assert/strict');
const test = require('node:test');

const loadouts = require('../src/shared/loadouts');

test('loadout presets retain only item names and combined quantities from EVE inventory pastes', () => {
  const preset = loadouts.createPresetFromInventoryText({
    id: 'gamma-t6',
    name: 'Gamma T6',
    cargoText: [
      "'Magpie' Mobile Tractor Unit\t\tMobile Tractor Unit\t190,122,586.21 ISK",
      'Cataclysmic Gamma Filament\t1\tAbyssal Filaments\t21,953,865.38 ISK',
      "Agency 'Hardshell' TB5 Dose II\t1\tBooster\t2,975,967.65 ISK",
      'Caldari Navy Inferno Heavy Missile\t200\tHeavy Missile\t205,830.00 ISK',
      'Inferno Fury Light Missile\t500\tAdvanced Light Missile\t31,075.00 ISK',
    ].join('\n'),
    droneText: [
      "'Augmented' Valkyrie\t\tCombat Drone\t12,747,993.82 ISK",
      "'Augmented' Valkyrie\t\tCombat Drone\t12,747,993.82 ISK",
      'Republic Fleet Valkyrie\t4\tCombat Drone\t6,903,915.88 ISK',
      'Republic Fleet Valkyrie\t\tCombat Drone\t1,725,978.97 ISK',
      'Republic Fleet Valkyrie\t\tCombat Drone\t1,725,978.97 ISK',
      'Valkyrie II\t\tCombat Drone\t871,970.90 ISK',
      'Valkyrie II\t\tCombat Drone\t871,970.90 ISK',
    ].join('\n'),
  });

  assert.deepEqual(preset.cargo, [
    { name: "'Magpie' Mobile Tractor Unit", qty: 1 },
    { name: 'Cataclysmic Gamma Filament', qty: 1 },
    { name: "Agency 'Hardshell' TB5 Dose II", qty: 1 },
    { name: 'Caldari Navy Inferno Heavy Missile', qty: 200 },
    { name: 'Inferno Fury Light Missile', qty: 500 },
  ]);
  assert.deepEqual(preset.drone, [
    { name: "'Augmented' Valkyrie", qty: 2 },
    { name: 'Republic Fleet Valkyrie', qty: 6 },
    { name: 'Valkyrie II', qty: 2 },
  ]);
  assert.equal(
    loadouts.formatInventoryItems(preset.drone),
    "'Augmented' Valkyrie\t2\nRepublic Fleet Valkyrie\t6\nValkyrie II\t2"
  );
});

test('loadout preset collections serialize canonically and reject unsafe data', () => {
  const presets = [{
    id: 'exotic-t5',
    name: 'Exotic T5',
    cargo: [{ name: 'Chaotic Exotic Filament', qty: 3 }],
    drone: [{ name: "'Augmented' Vespa", qty: 2 }],
  }];

  assert.deepEqual(loadouts.parseStoredPresets(loadouts.serializePresets(presets)), presets);
  assert.throws(() => loadouts.normalizePresets([
    presets[0],
    { ...presets[0], id: 'other', name: 'exotic t5' },
  ]), /names must be unique/);
  assert.throws(() => loadouts.normalizePreset({
    id: 'empty', name: 'Empty', cargo: [], drone: [],
  }), /at least one/);
  assert.throws(() => loadouts.normalizePreset({
    id: 'bad', name: 'Bad', cargo: [{ name: 'Missile', qty: 0 }], drone: [],
  }), /quantity is invalid/);
});
