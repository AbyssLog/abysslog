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
  const Database = require('better-sqlite3');
  const previousDatabase = new Database(path.join(userDataDirectory, 'abysslog.db'));
  previousDatabase.pragma('user_version = 1');
  previousDatabase.close();

  database.init();
  database.hardenSensitiveStorage();

  const startupStatus = database.finishStartup();
  assert.equal(startupStatus.schemaVersion, 2);
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
  database.saveCharacter({
    id: 9003,
    name: 'Recovery Pilot',
    portrait_url: 'https://images.evetech.net/characters/9003/portrait',
    client_id: 'recovery-client',
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

  const activeSnapshot = {
    version: 1,
    state: 'in-abyss',
    run: {
      character_id: 9003,
      started_at: 1_800_000_000,
      duration: 0,
      tier: 'T5',
      weather: 'Gamma',
      outcome: null,
      system_id: 32_000_001,
      cargoBefore: 'Nanite Repair Paste, 20',
      cargoAfter: '',
      droneBefore: 'Vespa II, 5',
      droneAfter: '',
      ship_name: 'Gila',
      ship_class: 'Cruiser',
      fitting: [],
      implants: [],
      fitCaptured: false,
    },
  };
  database.saveActiveRun(activeSnapshot);
  assert.deepEqual(database.getActiveRun(9003), activeSnapshot);

  const completedRun = {
    character_id: 9003,
    started_at: 1_800_000_000,
    duration: 1_000,
    tier: 'T5',
    weather: 'Gamma',
    outcome: 'Survived',
    loot_value: 500,
    consumed_cost: 100,
    net_isk: 400,
    total_loss: 0,
    system_id: 30_000_142,
    cargo_before: activeSnapshot.run.cargoBefore,
    cargo_after: 'Triglavian Survey Database, 2',
    drone_before: activeSnapshot.run.droneBefore,
    drone_after: activeSnapshot.run.droneBefore,
    ship_name: 'Gila',
    ship_class: 'Cruiser',
    items: [],
    fitting: [],
    implants: [],
  };
  assert.throws(() => database.completeActiveRun({
    ...completedRun,
    items: [{
      item_name: 'Invalid item',
      qty: 1,
      type: 'invalid',
      unit_price_buy: 0,
      unit_price_sell: 0,
    }],
  }), /constraint/i);
  assert.deepEqual(database.getActiveRun(9003), activeSnapshot);
  assert.equal(database.getRuns({ character_id: 9003 }).length, 0);

  const completedId = database.completeActiveRun(completedRun);
  assert.equal(database.getActiveRun(9003), null);
  assert.equal(database.getRunById(completedId).net_isk, 400);
  assert.equal(database.completeActiveRun(completedRun), completedId);
  assert.equal(database.getRuns({ character_id: 9003 }).length, 1);
});

test('statistics include death losses and daily activity keeps the latest 60 days', () => {
  database.saveCharacter({
    id: 9010,
    name: 'Profit Pilot',
    portrait_url: '',
    client_id: 'profit-client',
  });

  const baseRun = {
    character_id: 9010,
    started_at: Math.floor(Date.UTC(2025, 0, 1, 12) / 1000),
    duration: 100,
    tier: 'T4',
    weather: 'Electrical',
    ship_name: 'Gila',
    ship_class: 'Cruiser',
    loot_value: 0,
    consumed_cost: 0,
    net_isk: 0,
    total_loss: 0,
    cargo_before: '',
    cargo_after: '',
    drone_before: '',
    drone_after: '',
    items: [],
    fitting: [],
    implants: [],
  };
  database.saveRun({
    ...baseRun,
    outcome: 'Survived',
    net_isk: 100,
  });
  database.saveRun({
    ...baseRun,
    started_at: baseRun.started_at + 300,
    outcome: 'Died',
    total_loss: 50,
  });

  const stats = database.getStats(9010);
  assert.equal(stats.overall.total_net_isk, 50);
  assert.equal(stats.overall.avg_net_isk, 25);
  assert.equal(stats.byTier[0].avg_net_isk, 25);
  assert.equal(stats.byWeather[0].avg_net_isk, 25);
  assert.equal(stats.iskPerHour, 900);
  assert.deepEqual(database.getDailyStats(9010), [{
    day: '2025-01-01',
    total_runs: 2,
    survived: 1,
    net_isk: 50,
    total_loss: 50,
  }]);

  database.saveCharacter({
    id: 9011,
    name: 'Daily Pilot',
    portrait_url: '',
    client_id: 'daily-client',
  });
  for (let day = 0; day < 70; day++) {
    database.saveRun({
      ...baseRun,
      character_id: 9011,
      started_at: baseRun.started_at + day * 86_400,
      outcome: 'Survived',
      net_isk: day,
    });
  }

  const daily = database.getDailyStats(9011);
  assert.equal(daily.length, 60);
  assert.equal(daily[0].day, '2025-01-11');
  assert.equal(daily.at(-1).day, '2025-03-11');
});
