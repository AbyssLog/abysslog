const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createRunCsvRepository } = require('./database/run-csv-repository');
const { createStatisticsRepository } = require('./database/statistics-repository');

let db;
let Database;
let databasePath;
let backupDirectory;
const runCsvRepository = createRunCsvRepository(() => db);
const statisticsRepository = createStatisticsRepository(() => db);
const STORAGE_HARDENING_KEY = 'security_storage_hardened_v1';
const INVENTORY_BASELINE_CLEAR_PREFIX = 'inventory_baseline_cleared_run_';
const CHARACTER_TOKEN_PREFIX = 'tokens_';
const SCHEMA_VERSION = 2;
const AUTOMATIC_BACKUP_RETENTION = 7;

function init() {
  Database ||= require('better-sqlite3');
  const userDataDirectory = app.getPath('userData');
  databasePath = path.join(userDataDirectory, 'abysslog.db');
  backupDirectory = path.join(userDataDirectory, 'backups');
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

  try {
    db = new Database(databasePath);
    db.pragma('journal_mode = WAL');
    db.pragma('secure_delete = ON');
    db.pragma('foreign_keys = ON');
    assertDatabaseIntegrity();

    const currentVersion = db.pragma('user_version', { simple: true });
    if (currentVersion > SCHEMA_VERSION) {
      throw new Error('Database was created by a newer version of AbyssLog');
    }

    db.transaction(() => {
      createSchema();
      migrateSchema(currentVersion);
    })();
    assertDatabaseIntegrity();
  } catch (error) {
    if (db && db.open) db.close();
    db = null;
    const message = error instanceof Error ? error.message : 'Unknown database error';
    throw new Error(
      `AbyssLog could not safely open its database: ${message}. `
      + `The original file was left in place. Backups are stored in ${backupDirectory}.`
    );
  }
}

function assertConnectionIntegrity(connection) {
  const results = connection.pragma('quick_check');
  if (
    results.length !== 1
    || Object.values(results[0]).length !== 1
    || Object.values(results[0])[0] !== 'ok'
  ) {
    throw new Error('Database integrity check failed');
  }
}

function assertDatabaseIntegrity() {
  assertConnectionIntegrity(db);
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function copyDatabaseToBackup(fileName, { replaceExisting = false } = {}) {
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  db.pragma('wal_checkpoint(FULL)');
  const destination = path.join(backupDirectory, fileName);
  if (!replaceExisting && fs.existsSync(destination)) {
    throw new Error('A backup with this name already exists');
  }

  const operationId = `${process.pid}-${Date.now()}`;
  const temporary = path.join(backupDirectory, `.${fileName}.${operationId}.tmp`);
  const previous = path.join(backupDirectory, `.${fileName}.${operationId}.previous`);
  let previousMoved = false;
  let newInstalled = false;

  try {
    fs.copyFileSync(databasePath, temporary, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(temporary).size === 0) throw new Error('Database backup was empty');
    verifyBackup(temporary);

    if (replaceExisting && fs.existsSync(destination)) {
      removeDatabaseSidecars(destination);
      fs.renameSync(destination, previous);
      previousMoved = true;
    }
    fs.renameSync(temporary, destination);
    newInstalled = true;
  } catch (error) {
    let rollbackError = null;
    if (previousMoved && !newInstalled && fs.existsSync(previous)) {
      try {
        fs.renameSync(previous, destination);
        previousMoved = false;
      } catch (failure) {
        rollbackError = failure;
      }
    }
    if (rollbackError) {
      const message = error instanceof Error ? error.message : 'Unknown backup error';
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : 'Unknown rollback error';
      throw new Error(
        `Backup failed: ${message}. The previous backup could not be restored: ${rollbackMessage}`
      );
    }
    throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (newInstalled && fs.existsSync(previous)) fs.unlinkSync(previous);
  }
  return destination;
}

function inspectBackup(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Backup path is invalid');
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error('The selected backup is not a non-empty file');
  }

  let backupDb;
  try {
    backupDb = new Database(filePath, { readonly: true, fileMustExist: true });
    assertConnectionIntegrity(backupDb);

    const schemaVersion = backupDb.pragma('user_version', { simple: true });
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) {
      throw new Error('The selected backup has an invalid schema version');
    }
    if (schemaVersion > SCHEMA_VERSION) {
      throw new Error('The selected backup was created by a newer version of AbyssLog');
    }

    const tables = new Set(backupDb.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table'
    `).all().map(row => row.name));
    const requiredColumns = {
      characters: ['id', 'name', 'portrait_url', 'client_id', 'created_at'],
      settings: ['key', 'value'],
      runs: [
        'id', 'character_id', 'started_at', 'duration', 'tier', 'weather',
        'outcome', 'loot_value', 'consumed_cost', 'net_isk', 'total_loss',
        'system_id', 'notes', 'created_at',
      ],
      run_items: [
        'id', 'run_id', 'item_name', 'qty', 'type', 'unit_price_buy', 'unit_price_sell',
      ],
      run_fitting: [
        'id', 'run_id', 'type_id', 'type_name', 'qty', 'slot', 'unit_price_sell',
      ],
      run_implants: [
        'id', 'run_id', 'type_id', 'type_name', 'slot', 'unit_price_sell',
      ],
    };
    if (schemaVersion >= 1) {
      requiredColumns.runs.push(
        'cargo_before', 'cargo_after', 'drone_before', 'drone_after',
        'ship_name', 'ship_class'
      );
    }
    if (schemaVersion >= 2) {
      requiredColumns.active_run_state = ['character_id', 'snapshot', 'updated_at'];
    }

    for (const [table, expectedColumns] of Object.entries(requiredColumns)) {
      if (!tables.has(table)) {
        throw new Error('The selected file is not an AbyssLog full backup');
      }
      const columns = new Set(backupDb.pragma(`table_info(${table})`).map(column => column.name));
      if (expectedColumns.some(column => !columns.has(column))) {
        throw new Error('The selected file is not an AbyssLog full backup');
      }
    }
    if (backupDb.pragma('foreign_key_check').length > 0) {
      throw new Error('The selected backup contains inconsistent related data');
    }

    return {
      schemaVersion,
      characterCount: backupDb.prepare('SELECT COUNT(*) AS count FROM characters').get().count,
      runCount: backupDb.prepare('SELECT COUNT(*) AS count FROM runs').get().count,
      size: stat.size,
    };
  } finally {
    if (backupDb?.open) backupDb.close();
  }
}

function removeDatabaseSidecars(filePath) {
  for (const suffix of ['-shm', '-wal']) {
    const sidecarPath = `${filePath}${suffix}`;
    if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
  }
}

function verifyBackup(filePath) {
  try {
    inspectBackup(filePath);
  } finally {
    // Files created by AbyssLog are standalone backups and must not retain WAL state.
    // Never call this helper for a user-selected source file because its sidecars belong
    // to the user; restoreBackup validates a private staged copy instead.
    removeDatabaseSidecars(filePath);
  }
}

function samePath(left, right) {
  const normalize = value => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function restoreBackup(sourcePath) {
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    throw new TypeError('Backup path is invalid');
  }
  if (samePath(sourcePath, databasePath)) {
    throw new Error('The active AbyssLog database cannot be selected as its own backup');
  }

  const inspection = inspectBackup(sourcePath);
  const operationId = `${process.pid}-${Date.now()}`;
  const stagedPath = path.join(path.dirname(databasePath), `.abysslog-restore-${operationId}.tmp`);
  const displacedPath = path.join(path.dirname(databasePath), `.abysslog-before-restore-${operationId}.tmp`);
  let safetyBackupPath = null;
  let currentMoved = false;
  let restoredInstalled = false;
  let restoredOpened = false;

  try {
    fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
    verifyBackup(stagedPath);

    const safetyFileName = `abysslog-before-restore-${backupTimestamp()}.db`;
    safetyBackupPath = copyDatabaseToBackup(safetyFileName);

    close();
    removeDatabaseSidecars(databasePath);
    fs.renameSync(databasePath, displacedPath);
    currentMoved = true;
    fs.renameSync(stagedPath, databasePath);
    restoredInstalled = true;

    // Opening now exercises schema migration before the current database is discarded.
    // A migration failure therefore rolls back to the untouched database below.
    init();
    restoredOpened = true;
    fs.unlinkSync(displacedPath);
    currentMoved = false;

    return { ...inspection, safetyBackupPath };
  } catch (error) {
    if (restoredOpened || !db) close();

    let rollbackError = null;
    if (currentMoved) {
      try {
        removeDatabaseSidecars(databasePath);
        if (restoredInstalled && fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
        fs.renameSync(displacedPath, databasePath);
        currentMoved = false;
        init();
      } catch (failure) {
        rollbackError = failure;
      }
    } else if (!db && fs.existsSync(databasePath)) {
      try {
        init();
      } catch (failure) {
        rollbackError = failure;
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown restore error';
    if (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : 'Unknown rollback error';
      throw new Error(
        `Restore failed: ${message}. Automatic rollback also failed: ${rollbackMessage}. `
        + `The safety backup is ${safetyBackupPath || 'unavailable'}.`
      );
    }
    throw new Error(`Restore failed and the previous database was preserved: ${message}`);
  } finally {
    if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
    if (!currentMoved && fs.existsSync(displacedPath)) fs.unlinkSync(displacedPath);
  }
}

function listBackups() {
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  return fs.readdirSync(backupDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^abysslog-(?:auto-\d{4}-\d{2}-\d{2}|manual-\d+T\d+Z|before-restore-\d+T\d+Z)\.db$/.test(entry.name))
    .map(entry => {
      const filePath = path.join(backupDirectory, entry.name);
      const stat = fs.statSync(filePath);
      return {
        name: entry.name,
        filePath,
        createdAt: stat.mtimeMs,
        size: stat.size,
        automatic: entry.name.startsWith('abysslog-auto-'),
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt);
}

function pruneAutomaticBackups() {
  const automatic = listBackups().filter(backup => backup.automatic);
  for (const backup of automatic.slice(AUTOMATIC_BACKUP_RETENTION)) {
    fs.unlinkSync(backup.filePath);
  }
}

function createExitBackup() {
  const date = localDateStamp();
  const fileName = `abysslog-auto-${date}.db`;
  const filePath = copyDatabaseToBackup(fileName, { replaceExisting: true });
  pruneAutomaticBackups();
  return { filePath, ...getDataStatus() };
}

function createManualBackup() {
  const fileName = `abysslog-manual-${backupTimestamp()}.db`;
  const filePath = copyDatabaseToBackup(fileName);
  return { filePath, ...getDataStatus() };
}

function getDataStatus() {
  const backups = listBackups();
  const latest = backups[0] || null;
  return {
    databasePath,
    backupDirectory,
    databaseSize: fs.statSync(databasePath).size,
    schemaVersion: db.pragma('user_version', { simple: true }),
    latestBackup: latest
      ? { filePath: latest.filePath, createdAt: latest.createdAt, size: latest.size }
      : null,
    automaticBackupRetention: AUTOMATIC_BACKUP_RETENTION,
  };
}

function close() {
  if (!db) return;
  try {
    if (db.open) db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    if (db.open) db.close();
    db = null;
  }
}

function hardenSensitiveStorage() {
  if (getSetting(STORAGE_HARDENING_KEY) === '1') return;
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  setSetting(STORAGE_HARDENING_KEY, '1');
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      portrait_url TEXT,
      client_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
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
      cargo_before TEXT,
      cargo_after TEXT,
      drone_before TEXT,
      drone_after TEXT,
      ship_name TEXT,
      ship_class TEXT,
      notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('gained','consumed','lost')),
      unit_price_buy REAL DEFAULT 0,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_fitting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      slot TEXT,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_implants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      slot INTEGER,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS active_run_state (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);
}


function migrateSchema(currentVersion) {
  let version = currentVersion;

  if (version < 1) {
    // Add cargo columns to existing databases that predate this feature
    const cols = db.pragma('table_info(runs)').map(c => c.name);
    if (!cols.includes('cargo_before')) {
      db.exec('ALTER TABLE runs ADD COLUMN cargo_before TEXT');
    }
    if (!cols.includes('cargo_after')) {
      db.exec('ALTER TABLE runs ADD COLUMN cargo_after TEXT');
    }
    if (!cols.includes('drone_before')) {
      db.exec('ALTER TABLE runs ADD COLUMN drone_before TEXT');
    }
    if (!cols.includes('drone_after')) {
      db.exec('ALTER TABLE runs ADD COLUMN drone_after TEXT');
    }
    if (!cols.includes('ship_name')) {
      db.exec('ALTER TABLE runs ADD COLUMN ship_name TEXT');
    }
    if (!cols.includes('ship_class')) {
      db.exec('ALTER TABLE runs ADD COLUMN ship_class TEXT');
    }
    db.pragma('user_version = 1');
    version = 1;
  }

  if (version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS active_run_state (
        character_id INTEGER PRIMARY KEY,
        snapshot TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
      )
    `);
    db.pragma('user_version = 2');
  }
}

// ── Characters ────────────────────────────────────────────────────────────

function getCharacters() {
  return db.prepare('SELECT * FROM characters ORDER BY name').all();
}

function saveCharacter(character) {
  const existing = db.prepare('SELECT id FROM characters WHERE id = ?').get(character.id);
  if (existing) {
    db.prepare('UPDATE characters SET name = ?, portrait_url = ?, client_id = ? WHERE id = ?')
      .run(character.name, character.portrait_url, character.client_id, character.id);
  } else {
    db.prepare('INSERT INTO characters (id, name, portrait_url, client_id) VALUES (?, ?, ?, ?)')
      .run(character.id, character.name, character.portrait_url, character.client_id);
  }
  return character;
}

function deleteCharacter(characterId) {
  db.transaction(() => {
    deleteSetting(`${CHARACTER_TOKEN_PREFIX}${characterId}`);
    deleteSetting(inventoryBaselineClearKey(characterId));
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
  })();
  return true;
}

// ── Settings ──────────────────────────────────────────────────────────────

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  return true;
}


function inventoryBaselineClearKey(characterId) {
  return `${INVENTORY_BASELINE_CLEAR_PREFIX}${characterId}`;
}

function getInventoryBaseline(characterId) {
  const latestRun = db.prepare(`
    SELECT r.*, c.name AS character_name
    FROM runs r
    JOIN characters c ON r.character_id = c.id
    WHERE r.character_id = ?
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT 1
  `).get(characterId);
  if (!latestRun || latestRun.outcome !== 'Survived') return null;

  const clearedThroughRunId = Number(getSetting(inventoryBaselineClearKey(characterId)));
  if (
    Number.isSafeInteger(clearedThroughRunId)
    && latestRun.id <= clearedThroughRunId
  ) {
    return null;
  }
  return latestRun;
}

function clearInventoryBaseline(characterId, runId) {
  const latestRun = db.prepare(`
    SELECT id, outcome
    FROM runs
    WHERE character_id = ?
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get(characterId);
  if (
    !latestRun
    || latestRun.outcome !== 'Survived'
    || latestRun.id !== runId
  ) {
    return false;
  }
  return setSetting(inventoryBaselineClearKey(characterId), runId);
}

// ── Runs ──────────────────────────────────────────────────────────────────

function saveRun(runData) {
  const {
    character_id, started_at, duration, tier, weather, outcome,
    loot_value, consumed_cost, net_isk, total_loss, system_id,
    cargo_before, cargo_after, drone_before, drone_after, ship_name, ship_class, notes,
    items = [], fitting = [], implants = []
  } = runData;

  const insertRun = db.prepare(`
    INSERT INTO runs (character_id, started_at, duration, tier, weather, outcome,
      loot_value, consumed_cost, net_isk, total_loss, system_id, cargo_before, cargo_after, drone_before, drone_after, ship_name, ship_class, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO run_items (run_id, item_name, qty, type, unit_price_buy, unit_price_sell)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertFitting = db.prepare(`
    INSERT INTO run_fitting (run_id, type_id, type_name, qty, slot, unit_price_sell)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertImplant = db.prepare(`
    INSERT INTO run_implants (run_id, type_id, type_name, slot, unit_price_sell)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const info = insertRun.run(
      character_id, started_at, duration, tier, weather, outcome,
      loot_value || 0, consumed_cost || 0, net_isk || 0, total_loss || 0,
      system_id, cargo_before || null, cargo_after || null,
      drone_before || null, drone_after || null,
      ship_name || null, ship_class || null, notes
    );
    const runId = info.lastInsertRowid;

    for (const item of items) {
      insertItem.run(runId, item.item_name, item.qty, item.type,
        item.unit_price_buy || 0, item.unit_price_sell || 0);
    }
    for (const f of fitting) {
      insertFitting.run(runId, f.type_id, f.type_name, f.qty || 1, f.slot || null, f.unit_price_sell || 0);
    }
    for (const imp of implants) {
      insertImplant.run(runId, imp.type_id, imp.type_name, imp.slot || null, imp.unit_price_sell || 0);
    }

    return runId;
  });

  return transaction();
}

function saveActiveRun(snapshot) {
  db.prepare(`
    INSERT INTO active_run_state (character_id, snapshot, updated_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(character_id) DO UPDATE SET
      snapshot = excluded.snapshot,
      updated_at = excluded.updated_at
  `).run(snapshot.run.character_id, JSON.stringify(snapshot));
  return true;
}

function getActiveRun(characterId) {
  const row = db.prepare(
    'SELECT snapshot FROM active_run_state WHERE character_id = ?'
  ).get(characterId);
  if (!row) return null;
  try {
    return JSON.parse(row.snapshot);
  } catch {
    clearActiveRun(characterId);
    return null;
  }
}

function clearActiveRun(characterId) {
  db.prepare('DELETE FROM active_run_state WHERE character_id = ?').run(characterId);
  return true;
}

function completeActiveRun(runData) {
  return db.transaction(() => {
    const existing = db.prepare(
      'SELECT id FROM runs WHERE character_id = ? AND started_at = ? LIMIT 1'
    ).get(runData.character_id, runData.started_at);
    const runId = existing ? existing.id : saveRun(runData);
    clearActiveRun(runData.character_id);
    return runId;
  })();
}

function getRuns(filters = {}) {
  let query = 'SELECT r.*, c.name as character_name FROM runs r JOIN characters c ON r.character_id = c.id WHERE 1=1';
  const params = [];

  if (filters.character_id) {
    query += ' AND r.character_id = ?';
    params.push(filters.character_id);
  }
  if (filters.tier) {
    query += ' AND r.tier = ?';
    params.push(filters.tier);
  }
  if (filters.weather) {
    query += ' AND r.weather = ?';
    params.push(filters.weather);
  }
  if (filters.outcome) {
    query += ' AND r.outcome = ?';
    params.push(filters.outcome);
  }

  query += ' ORDER BY r.started_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  return db.prepare(query).all(...params);
}

function getRunById(runId) {
  const run = db.prepare('SELECT r.*, c.name as character_name FROM runs r JOIN characters c ON r.character_id = c.id WHERE r.id = ?').get(runId);
  if (!run) return null;

  run.items = db.prepare('SELECT * FROM run_items WHERE run_id = ? ORDER BY type, item_name').all(runId);
  run.fitting = db.prepare('SELECT * FROM run_fitting WHERE run_id = ? ORDER BY slot, type_name').all(runId);
  run.implants = db.prepare('SELECT * FROM run_implants WHERE run_id = ? ORDER BY slot').all(runId);

  return run;
}

function deleteRun(runId) {
  db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
  return true;
}

function getStats(filters = {}) {
  return statisticsRepository.getStats(filters);
}

function getDailyStats(filters = {}) {
  return statisticsRepository.getDailyStats(filters);
}

function exportRunsCSV(characterId) {
  return runCsvRepository.exportRunsCSV(characterId);
}

function importRunsCSV(csvText, characterId) {
  return runCsvRepository.importRunsCSV(csvText, characterId);
}

function deleteSetting(key) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  return true;
}

function requireUpdatedRun(result) {
  if (result.changes !== 1) throw new Error('Run not found');
}

function applyCargoUpdate(runId, { cargo_before, cargo_after, drone_before, drone_after }) {
  const result = db.prepare(
    'UPDATE runs SET cargo_before = ?, cargo_after = ?, drone_before = ?, drone_after = ? WHERE id = ?'
  ).run(cargo_before || null, cargo_after || null, drone_before || null, drone_after || null, runId);
  requireUpdatedRun(result);
}

function applyMetaUpdate(runId, { tier, weather, outcome, duration, started_at, total_loss, ship_name, ship_class }) {
  const result = db.prepare(`
    UPDATE runs SET tier = ?, weather = ?, outcome = ?, duration = ?, started_at = ?, total_loss = ?,
      ship_name = COALESCE(?, ship_name), ship_class = COALESCE(?, ship_class)
    WHERE id = ?
  `).run(tier, weather, outcome, duration, started_at, total_loss || 0, ship_name, ship_class, runId);
  requireUpdatedRun(result);
}

function applyAppraisalUpdate(runId, {
  loot_value,
  consumed_cost,
  net_isk,
  cargo_before,
  cargo_after,
  drone_before,
  drone_after,
  items,
}) {
  const result = db.prepare(`
    UPDATE runs SET loot_value = ?, consumed_cost = ?, net_isk = ?,
      cargo_before = ?, cargo_after = ?,
      drone_before = COALESCE(?, drone_before), drone_after = COALESCE(?, drone_after)
      WHERE id = ?
  `).run(
    loot_value,
    consumed_cost,
    net_isk,
    cargo_before,
    cargo_after,
    drone_before,
    drone_after,
    runId
  );
  requireUpdatedRun(result);

  // Appraisal updates provide the complete item set, including death-loss reappraisals.
  db.prepare('DELETE FROM run_items WHERE run_id = ?').run(runId);

  const insertItem = db.prepare(`
    INSERT INTO run_items (run_id, item_name, qty, type, unit_price_buy, unit_price_sell)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    insertItem.run(runId, item.item_name, item.qty, item.type,
      item.unit_price_buy || 0, item.unit_price_sell || 0);
  }
}

function updateAppraisal(runId, appraisal) {
  db.transaction(() => applyAppraisalUpdate(runId, appraisal))();
  return true;
}

function updateRun(runId, { meta, cargo, appraisal }) {
  const hasCargo = cargo !== null && cargo !== undefined;
  const hasAppraisal = appraisal !== null && appraisal !== undefined;
  if (hasCargo === hasAppraisal) {
    throw new TypeError('Run update requires exactly one cargo or appraisal update');
  }
  db.transaction(() => {
    applyMetaUpdate(runId, meta);
    if (hasAppraisal) applyAppraisalUpdate(runId, appraisal);
    else applyCargoUpdate(runId, cargo);
  })();
  return true;
}

module.exports = {
  init,
  close,
  createExitBackup,
  createManualBackup,
  inspectBackup,
  restoreBackup,
  getDataStatus,
  hardenSensitiveStorage,
  getCharacters,
  saveCharacter,
  deleteCharacter,
  getSetting,
  setSetting,
  deleteSetting,
  getInventoryBaseline,
  clearInventoryBaseline,
  saveRun,
  saveActiveRun,
  getActiveRun,
  clearActiveRun,
  completeActiveRun,
  updateAppraisal,
  updateRun,
  getRuns,
  getRunById,
  deleteRun,
  getStats,
  getDailyStats,
  exportRunsCSV,
  importRunsCSV,
};
