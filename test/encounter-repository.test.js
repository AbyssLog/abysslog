const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const { createFreshSchemaV7 } = require('../src/main/database/schema-v7');
const { createRunRepository } = require('../src/main/database/run-repository-v6');

test('group persistence permits only three frigates or two destroyers', () => {
  const connection = new Database(':memory:');
  try {
    connection.pragma('foreign_keys = ON');
    createFreshSchemaV7(connection);
    for (let id = 9101; id <= 9110; id++) {
      connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
        .run(id, `Pilot ${id}`);
    }
    const repository = createRunRepository(() => connection);
    const save = (characterId, encounterUid, shipClass, startedAt) => repository.saveRun({
      character_id: characterId,
      encounter_uid: encounterUid,
      started_at: startedAt,
      duration: 600,
      tier: 'T2',
      weather: 'Dark',
      outcome: 'Survived',
      hull_name: shipClass === 'Frigate' ? 'Hawk' : shipClass === 'Destroyer' ? 'Jackdaw' : 'Gila',
      ship_class: shipClass,
    });

    const frigates = '11111111-1111-4111-8111-111111111111';
    save(9101, frigates, 'Frigate', 1_800_000_000);
    save(9102, frigates, 'Frigate', 1_800_000_000);
    save(9103, frigates, 'Frigate', 1_800_000_000);
    assert.throws(
      () => save(9104, frigates, 'Frigate', 1_800_000_000),
      /three frigates or two destroyers/i
    );

    const destroyers = '22222222-2222-4222-8222-222222222222';
    save(9105, destroyers, 'Destroyer', 1_800_000_100);
    save(9106, destroyers, 'Destroyer', 1_800_000_100);
    assert.throws(
      () => save(9107, destroyers, 'Destroyer', 1_800_000_100),
      /three frigates or two destroyers/i
    );

    const cruisers = '33333333-3333-4333-8333-333333333333';
    save(9108, cruisers, 'Cruiser', 1_800_000_200);
    assert.throws(
      () => save(9109, cruisers, 'Cruiser', 1_800_000_200),
      /three frigates or two destroyers/i
    );
    assert.throws(
      () => save(9110, frigates, 'Destroyer', 1_800_000_000),
      /three frigates or two destroyers/i
    );

    const beforeAtomicFailure = connection.prepare('SELECT COUNT(*) AS count FROM runs').get().count;
    assert.throws(() => repository.saveEncounter([9108, 9109, 9110].map(characterId => ({
      character_id: characterId,
      started_at: 1_800_001_000,
      duration: 600,
      tier: 'T2',
      weather: 'Dark',
      outcome: 'Survived',
      hull_name: 'Jackdaw',
      ship_class: 'Destroyer',
    }))), /three frigates or two destroyers/i);
    assert.equal(
      connection.prepare('SELECT COUNT(*) AS count FROM runs').get().count,
      beforeAtomicFailure,
      'a rejected encounter must roll back every participant'
    );
  } finally {
    connection.close();
  }
});
