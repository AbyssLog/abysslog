const assert = require('node:assert/strict');
const test = require('node:test');

const runTracking = require('../src/shared/run-tracking');
const {
  createConcurrentTrackingController,
} = require('../src/renderer/concurrent-tracking-controller');

test('background characters track independently and join the foreground encounter', async () => {
  let observedAt = 1_800_000_000_000;
  const saved = [];
  const statuses = [];
  const locations = [32_000_482, 32_000_482, 30_000_142, 30_000_142];
  const foreground = {
    character_id: 1001,
    encounter_uid: '550e8400-e29b-41d4-a716-446655440000',
    started_at: 1_800_000_000,
    system_id: 32_000_482,
    ship_class: 'Frigate',
  };
  const controller = createConcurrentTrackingController({
    api: {
      runs: {
        getActive: async () => null,
        getTrackingDraft: async characterId => ({
          version: 1,
          character_id: characterId,
          tier: 'T2',
          weather: 'Dark',
          cargo_before: 'Calm Dark Filament\t3',
          drone_before: '',
          notes: '',
          tags: [],
        }),
        getInventoryBaseline: async () => null,
        saveActive: async snapshot => {
          saved.push(structuredClone(snapshot));
          return true;
        },
      },
      esi: {
        getLocation: async () => ({ solar_system_id: locations.shift() }),
        getShip: async () => ({ ship_type_id: 11381 }),
        getTypeNames: async () => ({ 11381: 'Hawk' }),
        getSystemName: async () => 'Jita',
      },
    },
    runTracking,
    getCharacters: () => [
      { id: 1001, name: 'Foreground' },
      { id: 1002, name: 'Background' },
    ],
    getCapabilities: () => ({ tracking: true, fitting: false, implants: false }),
    getSelectedCharacterId: () => 1001,
    getForegroundRun: () => foreground,
    getSettings: () => ({ esi_poll_interval: '5' }),
    classifyShip: async () => 'Frigate',
    onStatusChange: (characterId, status) => statuses.push([characterId, status]),
    createUuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    now: () => observedAt,
  });

  await controller.refresh({ force: true });
  assert.notEqual(
    controller.assignEncounter(30_000_142, 1_800_000_000),
    foreground.encounter_uid,
    'manual runs outside the Abyss must remain independent'
  );
  for (let index = 0; index < 2; index++) {
    await controller.pollNow();
    observedAt += 5_000;
  }
  for (let attempt = 0; attempt < 10 && !saved.some(snapshot => (
    snapshot.run.ship_class === 'Frigate'
  )); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(saved[0].state, 'in-abyss');
  assert.equal(saved.some(snapshot => snapshot.run.ship_class === 'Frigate'), true);
  assert.notEqual(saved[0].run.encounter_uid, foreground.encounter_uid);
  assert.equal(controller.candidateGroupForRun(foreground).length, 2);
  assert.deepEqual(
    await controller.confirmGroupCandidate(foreground),
    [1001, 1002]
  );
  assert.equal(saved.at(-1).run.encounter_uid, foreground.encounter_uid);

  for (let index = 0; index < 2; index++) {
    await controller.pollNow();
    observedAt += 5_000;
  }

  assert.equal(saved.at(-1).state, 'awaiting-cargo');
  assert.equal(saved.at(-1).run.outcome, 'Survived');
  assert.equal(controller.statusFor(1002), 'Needs Cargo');
  assert.deepEqual(statuses.at(-1), [1002, 'Needs Cargo']);
});
