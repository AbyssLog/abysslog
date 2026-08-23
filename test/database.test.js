const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { parseCsv } = require('../src/shared/csv');
const { buildCharacter } = require('./support/builders');

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

test('database backup lifecycle round-trips current data safely', () => {
  const Database = require('better-sqlite3');
  database.init();
  database.hardenSensitiveStorage();

  const exitStatus = database.createExitBackup();
  assert.equal(exitStatus.schemaVersion, 6);
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
    hull_name: 'Gila',
    ship_class: 'Cruiser',
    loot_value: 125,
    consumed_cost: 25,
    net_isk: 100,
    total_loss: 0,
    system_id: 32_000_123,
    system_name: 'Abyssal #32000123',
    appraised_at: 1_700_000_900,
    tags: ['Experimental', 'Farm'],
    killmail_ids: [9_001_001],
    cargo_before: '=Tritanium, 2\r\nPLEX, 1',
    cargo_after: 'Triglavian Survey Database, 3',
    drone_before: 'Vespa II, 5\nHammerhead II, 5',
    drone_after: 'Vespa II, 4',
    notes: "'Literal apostrophe\nA \"quoted\" note",
  };
  const sourceRunId = database.saveRun(sourceRun);

  const exported = database.exportRunsCSV({ character_id: 9001 });
  const csv = exported.csv;
  assert.equal(exported.count, 1);
  const parsed = parseCsv(csv);
  assert.equal(parsed[0].includes('run_uid'), true);
  assert.equal(parsed[1][parsed[0].indexOf('format')], 'abysslog-history');
  const exportedInventory = JSON.parse(
    parsed[1][parsed[0].indexOf('inventory_snapshots')]
  );
  assert.equal(
    exportedInventory.find(snapshot =>
      snapshot.phase === 'before' && snapshot.location === 'cargo'
    ).raw_text,
    sourceRun.cargo_before
  );

  assert.deepEqual(database.importRunsCSV(csv, 9002), {
    imported: 0,
    skipped: 1,
    errors: [],
  });
  database.deleteRun(sourceRunId);
  assert.deepEqual(database.importRunsCSV(csv, 9002), {
    imported: 1,
    skipped: 0,
    errors: [],
  });
  database.saveRun(sourceRun);

  const importedSummary = database.getRuns({ character_id: 9002 })[0];
  const importedRun = database.getRunById(importedSummary.id);
  for (const field of [
    'started_at',
    'duration',
    'tier',
    'weather',
    'outcome',
    'hull_name',
    'ship_class',
    'system_id',
    'system_name',
    'appraised_at',
    'cargo_before',
    'cargo_after',
    'drone_before',
    'drone_after',
    'notes',
  ]) {
    assert.equal(importedRun[field], sourceRun[field], field);
  }
  assert.deepEqual(importedRun.tags, sourceRun.tags);
  assert.deepEqual(importedRun.killmail_ids, sourceRun.killmail_ids);

  const manualStatus = database.createManualBackup();
  assert.equal(fs.existsSync(manualStatus.filePath), true);
  assert.equal(backupDirectoryEntries().filter(name => name.includes('-manual-')).length, 1);
  assert.deepEqual(database.inspectBackup(manualStatus.filePath), {
    schemaVersion: 6,
    characterCount: 3,
    runCount: 2,
    size: fs.statSync(manualStatus.filePath).size,
  });
  assert.equal(fs.existsSync(`${manualStatus.filePath}-shm`), false);
  assert.equal(fs.existsSync(`${manualStatus.filePath}-wal`), false);
  const retainedMigrationBackup = path.join(
    manualStatus.backupDirectory,
    'abysslog-before-schema-v6-20260823T000000000Z.db'
  );
  fs.copyFileSync(manualStatus.filePath, retainedMigrationBackup);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(retainedMigrationBackup, future, future);
  assert.notEqual(database.getDataStatus().latestBackup?.filePath, retainedMigrationBackup);

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
    /schema v999.*requires schema v6/i
  );

  const foreignRestorePath = path.join(userDataDirectory, 'foreign-restore.db');
  fs.copyFileSync(manualStatus.filePath, foreignRestorePath);
  const foreignDatabase = new Database(foreignRestorePath);
  foreignDatabase.pragma('application_id = 1234');
  foreignDatabase.close();
  assert.throws(
    () => database.inspectBackup(foreignRestorePath),
    /valid AbyssLog database identity/
  );

  const incompleteRestorePath = path.join(userDataDirectory, 'incomplete-restore.db');
  fs.copyFileSync(manualStatus.filePath, incompleteRestorePath);
  const incompleteRestore = new Database(incompleteRestorePath);
  incompleteRestore.exec('DROP INDEX idx_run_tags_tag');
  incompleteRestore.close();
  assert.throws(
    () => database.inspectBackup(incompleteRestorePath),
    /missing index idx_run_tags_tag/i
  );

  const unsupportedCredentialRestorePath = path.join(
    userDataDirectory,
    'unsupported-credential-restore.db'
  );
  fs.copyFileSync(manualStatus.filePath, unsupportedCredentialRestorePath);
  const unsupportedCredentialRestore = new Database(unsupportedCredentialRestorePath);
  unsupportedCredentialRestore.pragma('ignore_check_constraints = ON');
  unsupportedCredentialRestore.prepare(`
    INSERT INTO credentials (kind, character_id, ciphertext, format_version)
    VALUES ('oauth', 9001, 'legacy-ciphertext', 0)
  `).run();
  unsupportedCredentialRestore.pragma('ignore_check_constraints = OFF');
  unsupportedCredentialRestore.close();
  assert.throws(
    () => database.inspectBackup(unsupportedCredentialRestorePath),
    /unsupported credential format|integrity check failed/i
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
    /schema v2.*requires schema v6/i
  );
  assert.throws(
    () => database.restoreBackup(database.getDataStatus().databasePath),
    /cannot be selected as its own backup/
  );

  const restoreResult = database.restoreBackup(manualStatus.filePath);
  assert.equal(restoreResult.schemaVersion, 6);
  assert.equal(restoreResult.characterCount, 3);
  assert.equal(restoreResult.runCount, 2);
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
    version: 2,
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
      hull_name: 'Gila',
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
    hull_name: 'Gila',
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
  }), /invalid|constraint/i);
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
  database.setCredential('oauth', characterId, 'encrypted-token');
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
    assert.equal(database.getCredential('oauth', characterId), 'encrypted-token');
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
  assert.equal(database.getCredential('oauth', characterId), null);
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
    hull_name: 'Gila',
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
    hull_name: null,
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
    /invalid|constraint/i
  );
  const rolledBack = database.getRunById(runId);
  assert.equal(rolledBack.tier, 'T3');
  assert.equal(rolledBack.started_at, 1_710_000_000);
  assert.equal(rolledBack.net_isk, 80);
  assert.equal(rolledBack.drone_before, 'Vespa II, 5');
  assert.equal(rolledBack.items.length, 1);
  assert.equal(rolledBack.items[0].item_name, 'Triglavian Survey Database');
  assert.equal(database.getAppraisalHistory(runId).length, 1);

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
  const appraisalHistory = database.getAppraisalHistory(runId);
  assert.equal(appraisalHistory.length, 2);
  assert.equal(appraisalHistory.filter(entry => entry.is_current === 1).length, 1);
  assert.equal(appraisalHistory.find(entry => entry.is_current === 1).net_isk, 200);
  assert.equal(appraisalHistory.find(entry => entry.is_current === 0).net_isk, 80);

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
  assert.equal(database.getAppraisalHistory(runId).length, 2);
});

test('history search finds rich metadata and all item names', () => {
  database.saveCharacter({
    id: 9050,
    name: 'Search Pilot',
    portrait_url: '',
    client_id: 'search-client',
  });
  const runId = database.saveRun({
    character_id: 9050,
    started_at: 1_730_000_000,
    duration: 750,
    tier: 'T5',
    weather: 'Gamma',
    outcome: 'Survived',
    hull_name: 'Ishtar',
    ship_class: 'Cruiser',
    system_id: 32_000_456,
    system_name: 'Abyssal #32000456',
    notes: 'Triple battleship room; overheat the second wave.',
    tags: ['New Fit', 'Farm'],
    killmail_ids: [9_050_001],
    items: [
      {
        item_name: 'Unstable Large Plasma Mutaplasmid',
        qty: 1,
        type: 'gained',
        unit_price_buy: 0,
        unit_price_sell: 0,
      },
      {
        item_name: 'Caldari Navy Inferno Heavy Missile',
        qty: 200,
        type: 'consumed',
        unit_price_buy: 0,
        unit_price_sell: 1200,
      },
    ],
  });

  assert.deepEqual(
    database.getRuns({ character_id: 9050, search: 'plasma' })
      .map(run => run.id),
    [runId]
  );
  assert.equal(database.getRuns({ character_id: 9050, search: 'inferno' }).length, 1);
  assert.equal(database.getRuns({ character_id: 9050, search: 'battleship' }).length, 1);
  assert.equal(database.getRuns({ character_id: 9050, search: '9050001' }).length, 1);
  assert.equal(database.getRuns({ character_id: 9050, tag: 'new fit' }).length, 1);
  assert.equal(database.getRuns({ character_id: 9050, ship: 'ishtar' }).length, 1);
  assert.equal(database.getRuns({
    character_id: 9050,
    date_from: 1_729_999_999,
    date_to: 1_730_000_001,
  }).length, 1);

  const match = database.getRuns({
    character_id: 9050,
    search: 'plasma',
  })[0];
  assert.deepEqual(match.tags, ['Farm', 'New Fit']);
  assert.deepEqual(match.matching_items, [{
    item_name: 'Unstable Large Plasma Mutaplasmid',
    type: 'gained',
  }]);
  assert.deepEqual(
    database.getRuns({ character_id: 9050, search: 'inferno' })[0].matching_items,
    [{ item_name: 'Caldari Navy Inferno Heavy Missile', type: 'consumed' }]
  );

  const detail = database.getRunById(runId);
  assert.equal(detail.system_name, 'Abyssal #32000456');
  assert.deepEqual(detail.tags, ['Farm', 'New Fit']);
  assert.deepEqual(detail.killmail_ids, [9_050_001]);
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
    hull_name: 'Gila',
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
    items: [{
      item_name: 'Triglavian Survey Database',
      qty: 3,
      type: 'gained',
      unit_price_buy: 100,
      unit_price_sell: 110,
    }],
    fitting: [
      { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
      { type_id: 12_345, type_name: 'Rapid Light Missile Launcher II', qty: 4, slot: 'HiSlot0' },
    ],
  });
  const representativeFitRunId = database.saveRun({
    ...baseRun,
    started_at: baseRun.started_at + 300,
    outcome: 'Died',
    total_loss: 50,
    items: [{
      item_name: 'Vespa II',
      qty: 5,
      type: 'lost',
      unit_price_buy: 1,
      unit_price_sell: 10,
    }],
    fitting: [
      { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
      { type_id: 12_345, type_name: 'Rapid Light Missile Launcher II', qty: 4, slot: 'HiSlot0' },
    ],
  });

  const stats = database.getStats({ character_id: 9010 });
  assert.equal(stats.overall.total_net_isk, 50);
  assert.equal(stats.overall.avg_net_isk, 25);
  assert.equal(stats.byTier[0].avg_net_isk, 25);
  assert.equal(stats.byTier[0].avg_duration, 100);
  assert.equal(stats.byWeather[0].avg_net_isk, 25);
  assert.equal(stats.byWeather[0].avg_duration, 100);
  assert.equal(stats.byHull[0].hull_name, 'Gila');
  assert.equal(stats.byHull[0].total_runs, 2);
  assert.equal(stats.byHull[0].avg_duration, 100);
  assert.equal(stats.byFit[0].total_runs, 2);
  assert.equal(stats.byFit[0].avg_duration, 100);
  assert.equal(Number(stats.byFit[0].representative_run_id), Number(representativeFitRunId));
  assert.equal(stats.items.gained[0].item_name, 'Triglavian Survey Database');
  assert.equal(stats.items.lost[0].item_name, 'Vespa II');
  assert.equal(stats.latestSession.total_runs, 2);
  assert.equal(stats.latestSession.total_net_isk, 50);
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

test('fit statistics merge equivalent module layouts and captured hulls', () => {
  database.saveCharacter(buildCharacter({
    id: 9012,
    name: 'Fit Pilot',
    portrait_url: '',
    client_id: 'fit-client',
  }));
  const baseRun = {
    character_id: 9012,
    started_at: 1_735_732_800,
    duration: 600,
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    loot_value: 100,
    consumed_cost: 20,
    net_isk: 80,
    total_loss: 0,
    ship_class: 'Cruiser',
    cargo_before: '',
    cargo_after: '',
    drone_before: '',
    drone_after: '',
    items: [],
    implants: [{ type_id: 22_101, type_name: 'Mid-grade Crystal Alpha', slot: 1 }],
  };
  const firstRunId = database.saveRun({
    ...baseRun,
    hull_name: 'Gila',
    fitting: [
      { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
      { type_id: 33_201, type_name: 'Rapid Light Missile Launcher II', qty: 4, slot: 'HiSlot0' },
      { type_id: 21_638, type_name: 'Vespa II', qty: 5, slot: 'DroneBay' },
    ],
  });
  const latestRunId = database.saveRun({
    ...baseRun,
    started_at: baseRun.started_at + 900,
    weather: 'Gamma',
    hull_name: 'Gila',
    fitting: [
      { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
      { type_id: 33_201, type_name: 'Rapid Light Missile Launcher II', qty: 2, slot: 'HiSlot1' },
      { type_id: 33_201, type_name: 'Rapid Light Missile Launcher II', qty: 2, slot: 'HiSlot4' },
      { type_id: 21_638, type_name: 'Vespa II', qty: 5, slot: 'DroneBay' },
    ],
  });
  database.saveRun({
    ...baseRun,
    started_at: baseRun.started_at + 1800,
    weather: 'Dark',
    hull_name: 'Gila',
    implants: [{ type_id: 22_201, type_name: 'Mid-grade Asklepian Alpha', slot: 1 }],
    fitting: [
      { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
      { type_id: 33_201, type_name: 'Rapid Light Missile Launcher II', qty: 4, slot: 'HiSlot0' },
      { type_id: 21_638, type_name: 'Vespa II', qty: 5, slot: 'DroneBay' },
    ],
  });



  const fits = database.getStats({ character_id: 9012 }).byFit;
  assert.equal(fits.length, 2);
  assert.equal(fits[0].total_runs, 2);
  assert.equal(fits[0].avg_duration, 600);
  assert.equal(fits[0].hull_name, 'Gila');
  assert.equal(Number(fits[0].representative_run_id), Number(latestRunId));
  const renamed = database.setFitDisplayName(fits[0].fit_identity_id, 'Gamma Gila');
  assert.equal(renamed.display_name, 'Gamma Gila');
  const namedFit = database.getStats({ character_id: 9012 }).byFit
    .find(fit => fit.fit_identity_id === fits[0].fit_identity_id);
  assert.equal(namedFit.display_name, 'Gamma Gila');
  assert.ok(database.getRuns({ fit_identity_id: fits[0].fit_identity_id })
    .every(run => run.fit_display_name === 'Gamma Gila'));

  assert.deepEqual(
    database.getRuns({ character_id: 9012, fit_identity_id: fits[0].fit_identity_id }).map(run => run.id),
    [latestRunId, firstRunId]
  );
});

test('versioned CSV round-trips exact snapshots and appraisal history', () => {
  database.saveCharacter({ id: 9014, name: 'CSV Source', portrait_url: '', client_id: 'csv-source' });
  database.saveCharacter({ id: 9015, name: 'CSV Target', portrait_url: '', client_id: 'csv-target' });
  const runId = database.saveRun({
    character_id: 9014,
    started_at: 1_740_000_000,
    duration: 700,
    tier: 'T5',
    weather: 'Gamma',
    outcome: 'Survived',
    hull_name: 'Gila',
    ship_class: 'Cruiser',
    cargo_before: 'Nanite Repair Paste, 10',
    cargo_after: 'Triglavian Survey Database, 1',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 4',
    loot_value: 120,
    consumed_cost: 20,
    net_isk: 100,
    appraised_at: 1_740_000_700,
    tags: ['CSV'],
    killmail_ids: [9_014_001],
    items: [{
      item_name: 'Triglavian Survey Database', qty: 1, type: 'gained',
      unit_price_buy: 120, unit_price_sell: 130,
    }],
    fitting: [
      { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull', unit_price_sell: 300_000_000 },
      { type_id: 33_201, type_name: 'Launcher II', qty: 4, slot: 'HiSlot0', unit_price_sell: 2_000_000 },
    ],
    implants: [{
      type_id: 22_101, type_name: 'Crystal Alpha', slot: 1, unit_price_sell: 20_000_000,
    }],
  });
  const fitIdentityId = database.getRunById(runId).fit_identity_id;
  database.setFitDisplayName(fitIdentityId, 'CSV Gamma Gila');
  database.updateAppraisal(runId, {
    loot_value: 280,
    consumed_cost: 40,
    net_isk: 240,
    cargo_before: 'Nanite Repair Paste, 10',
    cargo_after: 'Triglavian Survey Database, 2',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 4',
    appraised_at: 1_740_001_000,
    items: [{
      item_name: 'Triglavian Survey Database', qty: 2, type: 'gained',
      unit_price_buy: 140, unit_price_sell: 150,
    }],
  });

  const csv = database.exportRunsCSV({ character_id: 9014 }).csv;
  const parsed = parseCsv(csv);
  const exportedUid = parsed[1][parsed[0].indexOf('run_uid')];
  assert.equal(JSON.parse(parsed[1][parsed[0].indexOf('appraisals')]).length, 2);
  database.deleteRun(runId);

  assert.deepEqual(database.importRunsCSV(csv, 9015), {
    imported: 1,
    skipped: 0,
    errors: [],
  });
  const imported = database.getRunById(database.getRuns({ character_id: 9015 })[0].id);
  assert.equal(imported.run_uid, exportedUid);
  assert.equal(imported.fit_display_name, 'CSV Gamma Gila');
  assert.equal(imported.fitting.length, 2);
  assert.equal(imported.implants.length, 1);
  assert.equal(imported.cargo_after, 'Triglavian Survey Database, 2');
  assert.deepEqual(imported.tags, ['CSV']);
  assert.deepEqual(imported.killmail_ids, [9_014_001]);
  const history = database.getAppraisalHistory(imported.id);
  assert.deepEqual(history.map(appraisal => appraisal.net_isk), [240, 100]);
  assert.deepEqual(history.map(appraisal => appraisal.is_current), [1, 0]);
});

test('CSV import accepts only the versioned 1.2 history format', () => {
  database.saveCharacter({
    id: 9013,
    name: 'CSV Pilot',
    portrait_url: '',
    client_id: 'csv-client',
  });
  const legacyCsv = [
    'started_at,tier,weather,outcome,ship_name,ship_class',
    '1735732800,T4,Electrical,Survived,Gila,Cruiser',
  ].join('\n');
  assert.throws(
    () => database.importRunsCSV(legacyCsv, 9013),
    /supported AbyssLog 1\.2 history format/
  );

  database.saveRun({
    character_id: 9013,
    started_at: 1735732800,
    duration: 600,
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    hull_name: 'Gila',
    ship_class: 'Cruiser',
  });

  const headers = parseCsv(database.exportRunsCSV({ character_id: 9013 }).csv)[0];
  assert.equal(headers.includes('format_version'), true);
  assert.equal(headers.includes('run_uid'), true);
  assert.equal(headers.includes('hull_name'), true);
  assert.equal(headers.includes('ship_name'), false);
});
