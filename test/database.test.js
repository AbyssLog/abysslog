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
  previousDatabase.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      portrait_url TEXT,
      client_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      tier TEXT,
      weather TEXT,
      outcome TEXT NOT NULL,
      loot_value REAL DEFAULT 0,
      consumed_cost REAL DEFAULT 0,
      net_isk REAL DEFAULT 0,
      total_loss REAL DEFAULT 0,
      system_id INTEGER,
      notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    INSERT INTO characters (id, name, portrait_url, client_id)
    VALUES (8999, 'Legacy Pilot', '', 'legacy-client');
    INSERT INTO runs (
      character_id, started_at, duration, tier, weather, outcome,
      loot_value, consumed_cost, net_isk, total_loss, notes
    ) VALUES (
      8999, 1600000000, 780, 'T3', 'Dark', 'Survived',
      90, 20, 70, 0, 'Created by the original schema'
    );
  `);
  previousDatabase.close();

  database.init();
  database.hardenSensitiveStorage();

  const exitStatus = database.createExitBackup();
  assert.equal(exitStatus.schemaVersion, 2);
  const migratedRun = database.getRuns({ character_id: 8999 })[0];
  assert.equal(migratedRun.notes, 'Created by the original schema');
  assert.equal(migratedRun.cargo_before, null);
  assert.equal(migratedRun.drone_after, null);
  assert.equal(migratedRun.ship_class, null);
  assert.equal(exitStatus.automaticBackupRetention, 7);
  assert.ok(exitStatus.latestBackup);
  assert.equal(fs.existsSync(exitStatus.latestBackup.filePath), true);

  const backupDirectoryEntries = () => fs.readdirSync(exitStatus.backupDirectory);
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-auto-')).length, 1);

  database.setSetting('exit_backup_marker', 'replacement state');
  const replacedStatus = database.createExitBackup();
  assert.equal(replacedStatus.latestBackup.filePath, exitStatus.latestBackup.filePath);
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-auto-')).length, 1);
  const replacedBackup = new Database(replacedStatus.latestBackup.filePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    replacedBackup.prepare('SELECT value FROM settings WHERE key = ?').get('exit_backup_marker').value,
    'replacement state'
  );
  replacedBackup.close();

  fs.writeFileSync(exitStatus.latestBackup.filePath, 'corrupt backup');
  const repairedStatus = database.createExitBackup();
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
  assert.deepEqual(database.inspectBackup(manualStatus.filePath), {
    schemaVersion: 2,
    characterCount: 4,
    runCount: 3,
    size: fs.statSync(manualStatus.filePath).size,
  });

  database.saveRun({
    ...sourceRun,
    started_at: sourceRun.started_at + 1,
    notes: 'Created after the recovery point',
  });
  assert.equal(database.getRuns({ character_id: 9001 }).length, 2);

  const corruptRestorePath = path.join(userDataDirectory, 'corrupt-restore.db');
  fs.writeFileSync(corruptRestorePath, 'not a SQLite database');
  assert.throws(
    () => database.restoreBackup(corruptRestorePath),
    /database|backup|file/i
  );
  assert.equal(database.getRuns({ character_id: 9001 }).length, 2);

  const newerRestorePath = path.join(userDataDirectory, 'newer-restore.db');
  const newerDatabase = new Database(newerRestorePath);
  newerDatabase.pragma('user_version = 999');
  newerDatabase.close();
  assert.throws(
    () => database.inspectBackup(newerRestorePath),
    /newer version of AbyssLog/
  );

  const lookalikeRestorePath = path.join(userDataDirectory, 'lookalike-restore.db');
  const lookalikeDatabase = new Database(lookalikeRestorePath);
  lookalikeDatabase.exec(`
    CREATE TABLE characters (unexpected TEXT);
    CREATE TABLE settings (unexpected TEXT);
    CREATE TABLE runs (unexpected TEXT);
    CREATE TABLE run_items (unexpected TEXT);
    CREATE TABLE run_fitting (unexpected TEXT);
    CREATE TABLE run_implants (unexpected TEXT);
    CREATE TABLE active_run_state (unexpected TEXT);
    PRAGMA user_version = 2;
  `);
  lookalikeDatabase.close();
  assert.throws(
    () => database.inspectBackup(lookalikeRestorePath),
    /not an AbyssLog full backup/
  );
  assert.throws(
    () => database.restoreBackup(database.getDataStatus().databasePath),
    /cannot be selected as its own backup/
  );

  const restoreResult = database.restoreBackup(manualStatus.filePath);
  assert.equal(restoreResult.schemaVersion, 2);
  assert.equal(restoreResult.characterCount, 4);
  assert.equal(restoreResult.runCount, 3);
  assert.equal(fs.existsSync(restoreResult.safetyBackupPath), true);
  assert.equal(
    backupDirectoryEntries().filter(name => name.includes('-before-restore-')).length,
    1
  );
  assert.equal(database.getRuns({ character_id: 9001 }).length, 1);
  assert.equal(
    database.getRuns({ character_id: 9001 })[0].notes,
    sourceRun.notes
  );

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

test('character deletion rolls back credentials and settings when the database delete fails', () => {
  const Database = require('better-sqlite3');
  const characterId = 9099;
  const triggerName = 'prevent_character_delete_test';
  const databasePath = database.getDataStatus().databasePath;

  database.saveCharacter({
    id: characterId,
    name: 'Rollback Pilot',
    portrait_url: '',
    client_id: 'rollback-client',
  });
  database.setSetting(`tokens_${characterId}`, 'encrypted-token');
  database.setSetting(`inventory_baseline_cleared_run_${characterId}`, '42');

  const installTrigger = new Database(databasePath);
  installTrigger.exec(`
    CREATE TRIGGER ${triggerName}
    BEFORE DELETE ON characters
    WHEN OLD.id = ${characterId}
    BEGIN
      SELECT RAISE(ABORT, 'simulated character deletion failure');
    END;
  `);
  installTrigger.close();

  try {
    assert.throws(
      () => database.deleteCharacter(characterId),
      /simulated character deletion failure/
    );
    assert.ok(database.getCharacters().some(character => character.id === characterId));
    assert.equal(database.getSetting(`tokens_${characterId}`), 'encrypted-token');
    assert.equal(
      database.getSetting(`inventory_baseline_cleared_run_${characterId}`),
      '42'
    );
  } finally {
    const removeTrigger = new Database(databasePath);
    removeTrigger.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    removeTrigger.close();
  }

  assert.equal(database.deleteCharacter(characterId), true);
  assert.equal(database.getCharacters().some(character => character.id === characterId), false);
  assert.equal(database.getSetting(`tokens_${characterId}`), null);
  assert.equal(database.getSetting(`inventory_baseline_cleared_run_${characterId}`), null);
});

test('manual run edits commit metadata and appraisal changes atomically', () => {
  database.saveCharacter({
    id: 9020,
    name: 'Edit Pilot',
    portrait_url: '',
    client_id: 'edit-client',
  });
  const runId = database.saveRun({
    character_id: 9020,
    started_at: 1_710_000_000,
    duration: 600,
    tier: 'T3',
    weather: 'Dark',
    outcome: 'Survived',
    loot_value: 100,
    consumed_cost: 20,
    net_isk: 80,
    total_loss: 0,
    cargo_before: 'Nanite Repair Paste, 10',
    cargo_after: 'Triglavian Survey Database, 1',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 5',
    ship_name: 'Gila',
    ship_class: 'Cruiser',
    items: [{
      item_name: 'Triglavian Survey Database',
      qty: 1,
      type: 'gained',
      unit_price_buy: 100,
      unit_price_sell: 110,
    }],
    fitting: [],
    implants: [],
  });
  const changedMeta = {
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    duration: 700,
    started_at: 1_710_000_100,
    total_loss: 0,
    ship_name: null,
    ship_class: 'Cruiser',
  };
  const changedAppraisal = {
    loot_value: 250,
    consumed_cost: 50,
    net_isk: 200,
    cargo_before: 'Nanite Repair Paste, 8',
    cargo_after: 'Triglavian Survey Database, 2',
    drone_before: '',
    drone_after: '',
    items: [{
      item_name: 'Invalid item',
      qty: 1,
      type: 'invalid',
      unit_price_buy: 0,
      unit_price_sell: 0,
    }],
  };

  assert.throws(
    () => database.updateRun(runId, { meta: changedMeta, cargo: null, appraisal: changedAppraisal }),
    /constraint/i
  );
  const rolledBack = database.getRunById(runId);
  assert.equal(rolledBack.tier, 'T3');
  assert.equal(rolledBack.started_at, 1_710_000_000);
  assert.equal(rolledBack.net_isk, 80);
  assert.equal(rolledBack.drone_before, 'Vespa II, 5');
  assert.equal(rolledBack.items.length, 1);
  assert.equal(rolledBack.items[0].item_name, 'Triglavian Survey Database');

  changedAppraisal.items = [{
    item_name: 'Triglavian Survey Database',
    qty: 2,
    type: 'gained',
    unit_price_buy: 125,
    unit_price_sell: 130,
  }];
  assert.equal(
    database.updateRun(runId, { meta: changedMeta, cargo: null, appraisal: changedAppraisal }),
    true
  );
  const appraised = database.getRunById(runId);
  assert.equal(appraised.tier, 'T4');
  assert.equal(appraised.started_at, 1_710_000_100);
  assert.equal(appraised.net_isk, 200);
  assert.equal(appraised.drone_before, '');
  assert.equal(appraised.drone_after, '');
  assert.equal(appraised.items[0].qty, 2);

  assert.equal(database.updateRun(runId, {
    meta: { ...changedMeta, tier: 'T5', duration: 800 },
    cargo: {
      cargo_before: 'Nanite Repair Paste, 6',
      cargo_after: '',
      drone_before: 'Vespa II, 4',
      drone_after: '',
    },
    appraisal: null,
  }), true);
  const cargoOnly = database.getRunById(runId);
  assert.equal(cargoOnly.tier, 'T5');
  assert.equal(cargoOnly.duration, 800);
  assert.equal(cargoOnly.net_isk, 200);
  assert.equal(cargoOnly.cargo_before, 'Nanite Repair Paste, 6');
  assert.equal(cargoOnly.items[0].qty, 2);
});

test('statistics include death losses and apply consistent date ranges', () => {
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

  const stats = database.getStats({ character_id: 9010 });
  assert.equal(stats.overall.total_net_isk, 50);
  assert.equal(stats.overall.avg_net_isk, 25);
  assert.equal(stats.byTier[0].avg_net_isk, 25);
  assert.equal(stats.byWeather[0].avg_net_isk, 25);
  assert.equal(stats.iskPerHour, 900);
  assert.deepEqual(database.getDailyStats({ character_id: 9010 }), [{
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

  const daily = database.getDailyStats({ character_id: 9011 });
  assert.equal(daily.length, 70);
  assert.equal(daily[0].day, '2025-01-01');
  assert.equal(daily.at(-1).day, '2025-03-11');
  assert.equal(database.getStats({ character_id: 9011 }).iskPerHour, 1242);

  const range = {
    character_id: 9011,
    range_start: baseRun.started_at + 10 * 86_400,
    range_end: baseRun.started_at + 13 * 86_400,
  };
  const filtered = database.getStats(range);
  assert.equal(filtered.overall.total_runs, 3);
  assert.equal(filtered.byTier[0].total_runs, 3);
  assert.equal(filtered.overall.total_net_isk, 33);
  assert.equal(filtered.iskPerHour, 396);
  const filteredDaily = database.getDailyStats(range);
  assert.deepEqual(
    filteredDaily.map(day => [day.day, day.net_isk]),
    [['2025-01-11', 10], ['2025-01-12', 11], ['2025-01-13', 12]]
  );
});

test('cleared inventory baselines stay cleared until a newer survived run', () => {
  database.saveCharacter({
    id: 9040,
    name: 'Baseline Pilot',
    portrait_url: '',
    client_id: 'baseline-client',
  });
  const olderRunId = database.saveRun({
    character_id: 9040,
    started_at: 1_719_999_000,
    duration: 550,
    tier: 'T3',
    weather: 'Dark',
    outcome: 'Survived',
    cargo_before: 'Nanite Repair Paste, 20',
    cargo_after: 'Triglavian Survey Database, 1',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 5',
    ship_class: 'Cruiser',
  });
  const firstRunId = database.saveRun({
    character_id: 9040,
    started_at: 1_720_000_000,
    duration: 600,
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    cargo_before: 'Nanite Repair Paste, 10',
    cargo_after: 'Triglavian Survey Database, 2',
    drone_before: 'Vespa II, 5',
    drone_after: '',
    ship_class: 'Cruiser',
  });

  assert.equal(database.getInventoryBaseline(9040).id, firstRunId);
  assert.equal(database.clearInventoryBaseline(9040, firstRunId), true);
  assert.equal(database.getInventoryBaseline(9040), null);

  database.close();
  database.init();
  assert.equal(database.getInventoryBaseline(9040), null);
  assert.equal(database.deleteRun(firstRunId), true);
  assert.equal(database.getRunById(olderRunId).id, olderRunId);
  assert.equal(database.getInventoryBaseline(9040), null);

  const secondRunId = database.saveRun({
    character_id: 9040,
    started_at: 1_720_001_000,
    duration: 650,
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    cargo_before: 'Triglavian Survey Database, 2',
    cargo_after: 'Triglavian Survey Database, 5',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 4',
    ship_class: 'Cruiser',
  });

  assert.equal(database.getInventoryBaseline(9040).id, secondRunId);
  assert.equal(database.clearInventoryBaseline(9040, firstRunId), false);
  assert.equal(database.getInventoryBaseline(9040).id, secondRunId);
});
