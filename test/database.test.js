const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseCsv } = require('../src/shared/csv');

const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-db-test-'));
const originalLoad = Module._load;
let database;

try {
  Module._load = function loadWithElectronMock(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => userDataDirectory } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  database = require('../src/main/database');
} finally {
  Module._load = originalLoad;
}

test.after(() => {
  database.close();
  fs.rmSync(userDataDirectory, { recursive: true, force: true });
});

test('database lifecycle creates verified backups and round-trips multiline CSV safely', () => {
  database.init();
  database.hardenSensitiveStorage();

  const startupStatus = database.finishStartup();
  assert.equal(startupStatus.schemaVersion, 1);
  assert.equal(startupStatus.automaticBackupRetention, 7);
  assert.ok(startupStatus.latestBackup);
  assert.equal(fs.existsSync(startupStatus.latestBackup.filePath), true);

  const backupDirectoryEntries = () => fs.readdirSync(startupStatus.backupDirectory);
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-auto-')).length, 1);
  database.finishStartup();
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-auto-')).length, 1);

  fs.writeFileSync(startupStatus.latestBackup.filePath, 'corrupt backup');
  const repairedStatus = database.finishStartup();
  assert.ok(repairedStatus.latestBackup.size > 'corrupt backup'.length);
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-auto-')).length, 1);

  database.saveCharacter({
    id: 9001,
    name: 'Source Pilot',
    portrait_url: 'https://images.evetech.net/characters/9001/portrait',
    client_id: 'source-client',
  });
  database.saveCharacter({
    id: 9002,
    name: 'Imported Pilot',
    portrait_url: 'https://images.evetech.net/characters/9002/portrait',
    client_id: 'target-client',
  });

  const sourceRun = {
    character_id: 9001,
    started_at: 1_700_000_000,
    duration: 900,
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    ship_name: 'Gila',
    ship_class: 'Cruiser',
    loot_value: 125,
    consumed_cost: 25,
    net_isk: 100,
    total_loss: 0,
    cargo_before: '=Tritanium, 2\r\nPLEX, 1',
    cargo_after: 'Triglavian Survey Database, 3',
    drone_before: 'Vespa II, 5\nHammerhead II, 5',
    drone_after: 'Vespa II, 4',
    notes: "'Literal apostrophe\nA \"quoted\" note",
  };
  database.saveRun(sourceRun);

  const csv = database.exportRunsCSV(9001);
  const parsed = parseCsv(csv);
  assert.equal(parsed[0].includes('character_id'), true);
  assert.equal(parsed[1][parsed[0].indexOf('cargo_before')], `'${
    sourceRun.cargo_before
  }`);

  assert.deepEqual(database.importRunsCSV(csv, 9002), {
    imported: 1,
    skipped: 0,
    errors: [],
  });
  assert.deepEqual(database.importRunsCSV(csv, 9002), {
    imported: 0,
    skipped: 1,
    errors: [],
  });

  const importedRun = database.getRuns({ character_id: 9002 })[0];
  for (const field of [
    'started_at',
    'duration',
    'tier',
    'weather',
    'outcome',
    'ship_name',
    'ship_class',
    'cargo_before',
    'cargo_after',
    'drone_before',
    'drone_after',
    'notes',
  ]) {
    assert.equal(importedRun[field], sourceRun[field], field);
  }

  const manualStatus = database.createManualBackup();
  assert.equal(fs.existsSync(manualStatus.filePath), true);
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-manual-')).length, 1);
});
