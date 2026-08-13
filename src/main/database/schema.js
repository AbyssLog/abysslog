const { createFitIdentity } = require('../../shared/fit-identity');

const SCHEMA_VERSION = 5;
const MIN_SUPPORTED_SCHEMA_VERSION = 4;
const ABYSSLOG_APPLICATION_ID = 0x4142594c;

function tableColumns(connection, tableName) {
  return new Set(connection.pragma(`table_info(${tableName})`).map(column => column.name));
}

function ensureColumn(connection, tableName, columnName, definition) {
  if (tableColumns(connection, tableName).has(columnName)) return;
  connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function createValidationTriggers(connection) {
  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS validate_runs_insert
    BEFORE INSERT ON runs
    WHEN NEW.duration < 0 OR NEW.loot_value < 0 OR NEW.consumed_cost < 0
      OR NEW.total_loss < 0
    BEGIN
      SELECT RAISE(ABORT, 'run numeric values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_runs_update
    BEFORE UPDATE ON runs
    WHEN NEW.duration < 0 OR NEW.loot_value < 0 OR NEW.consumed_cost < 0
      OR NEW.total_loss < 0
    BEGIN
      SELECT RAISE(ABORT, 'run numeric values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_items_insert
    BEFORE INSERT ON run_items
    WHEN NEW.qty <= 0 OR NEW.unit_price_buy < 0 OR NEW.unit_price_sell < 0
      OR NEW.type NOT IN ('gained', 'consumed', 'lost')
    BEGIN
      SELECT RAISE(ABORT, 'run item values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_items_update
    BEFORE UPDATE ON run_items
    WHEN NEW.qty <= 0 OR NEW.unit_price_buy < 0 OR NEW.unit_price_sell < 0
      OR NEW.type NOT IN ('gained', 'consumed', 'lost')
    BEGIN
      SELECT RAISE(ABORT, 'run item values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_fitting_insert
    BEFORE INSERT ON run_fitting
    WHEN NEW.qty <= 0 OR NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'fitting values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_fitting_update
    BEFORE UPDATE ON run_fitting
    WHEN NEW.qty <= 0 OR NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'fitting values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_implants_insert
    BEFORE INSERT ON run_implants
    WHEN NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'implant values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_implants_update
    BEFORE UPDATE ON run_implants
    WHEN NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'implant values are invalid');
    END;
  `);
}

function createSchema(connection) {
  connection.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      portrait_url TEXT,
      client_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('oauth', 'janice')),
      character_id INTEGER,
      ciphertext TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version >= 0),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      CHECK(
        (kind = 'oauth' AND character_id IS NOT NULL)
        OR (kind = 'janice' AND character_id IS NULL)
      ),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE fit_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT NOT NULL UNIQUE,
      signature_hash TEXT NOT NULL,
      hull_name TEXT NOT NULL,
      display_name TEXT CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0 CHECK(duration >= 0),
      tier TEXT,
      weather TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('Survived', 'Died')),
      loot_value REAL NOT NULL DEFAULT 0 CHECK(loot_value >= 0),
      consumed_cost REAL NOT NULL DEFAULT 0 CHECK(consumed_cost >= 0),
      net_isk REAL NOT NULL DEFAULT 0,
      total_loss REAL NOT NULL DEFAULT 0 CHECK(total_loss >= 0),
      system_id INTEGER,
      system_name TEXT,
      appraised_at INTEGER,
      cargo_before TEXT,
      cargo_after TEXT,
      drone_before TEXT,
      drone_after TEXT,
      hull_name TEXT,
      ship_class TEXT,
      fit_identity_id INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (fit_identity_id) REFERENCES fit_identities(id) ON DELETE SET NULL
    );

    CREATE TABLE run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0),
      type TEXT NOT NULL CHECK(type IN ('gained','consumed','lost')),
      unit_price_buy REAL NOT NULL DEFAULT 0 CHECK(unit_price_buy >= 0),
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_fitting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1 CHECK(qty > 0),
      slot TEXT,
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_implants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      slot INTEGER,
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_tags (
      run_id INTEGER NOT NULL,
      tag TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (run_id, tag),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_killmails (
      run_id INTEGER NOT NULL,
      killmail_id INTEGER NOT NULL,
      PRIMARY KEY (run_id, killmail_id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE active_run_state (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX credential_oauth_character
      ON credentials(character_id) WHERE kind = 'oauth';
    CREATE UNIQUE INDEX credential_janice_singleton
      ON credentials(kind) WHERE kind = 'janice';
    CREATE UNIQUE INDEX runs_character_started
      ON runs(character_id, started_at);
    CREATE INDEX idx_runs_character_started
      ON runs(character_id, started_at DESC);
    CREATE INDEX idx_runs_fit_identity_started
      ON runs(fit_identity_id, started_at DESC);
    CREATE INDEX idx_fit_identities_hash
      ON fit_identities(signature_hash);
    CREATE INDEX idx_run_items_run_type_name
      ON run_items(run_id, type, item_name COLLATE NOCASE);
    CREATE INDEX idx_run_tags_tag
      ON run_tags(tag COLLATE NOCASE);
  `);
  createValidationTriggers(connection);
}

function assertVersionFourDataCanMigrate(connection) {
  const duplicateRun = connection.prepare(`
    SELECT character_id, started_at, COUNT(*) AS count
    FROM runs
    GROUP BY character_id, started_at
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();
  if (duplicateRun) {
    throw new Error('Schema v4 contains duplicate run timestamps and cannot be migrated safely');
  }

  const invalidRun = connection.prepare(`
    SELECT id FROM runs
    WHERE duration < 0 OR loot_value < 0 OR consumed_cost < 0 OR total_loss < 0
      OR outcome NOT IN ('Survived', 'Died')
    LIMIT 1
  `).get();
  const invalidItem = connection.prepare(`
    SELECT id FROM run_items
    WHERE qty <= 0 OR unit_price_buy < 0 OR unit_price_sell < 0
      OR type NOT IN ('gained', 'consumed', 'lost')
    LIMIT 1
  `).get();
  const invalidFitting = connection.prepare(`
    SELECT id FROM run_fitting WHERE qty <= 0 OR unit_price_sell < 0 LIMIT 1
  `).get();
  const invalidImplant = connection.prepare(`
    SELECT id FROM run_implants WHERE unit_price_sell < 0 LIMIT 1
  `).get();
  if (invalidRun || invalidItem || invalidFitting || invalidImplant) {
    throw new Error('Schema v4 contains invalid historical values and cannot be migrated safely');
  }
  if (connection.prepare("SELECT 1 FROM settings WHERE key = 'janice_api_key'").get()) {
    throw new Error('Schema v4 still contains a legacy plaintext Janice key; open it in 1.1.5 first');
  }
}

function createVersionFiveTables(connection) {
  connection.exec(`
    CREATE TABLE credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('oauth', 'janice')),
      character_id INTEGER,
      ciphertext TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version >= 0),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      CHECK(
        (kind = 'oauth' AND character_id IS NOT NULL)
        OR (kind = 'janice' AND character_id IS NULL)
      ),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX credential_oauth_character
      ON credentials(character_id) WHERE kind = 'oauth';
    CREATE UNIQUE INDEX credential_janice_singleton
      ON credentials(kind) WHERE kind = 'janice';

    CREATE TABLE fit_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT NOT NULL UNIQUE,
      signature_hash TEXT NOT NULL,
      hull_name TEXT NOT NULL,
      display_name TEXT CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX idx_fit_identities_hash ON fit_identities(signature_hash);
  `);
  ensureColumn(
    connection,
    'runs',
    'fit_identity_id',
    'INTEGER REFERENCES fit_identities(id) ON DELETE SET NULL'
  );
}

function migrateCredentialSettings(connection) {
  const insert = connection.prepare(`
    INSERT INTO credentials (kind, character_id, ciphertext, format_version)
    VALUES (?, ?, ?, 0)
  `);
  const tokenRows = connection.prepare(`
    SELECT key, value FROM settings WHERE key GLOB 'tokens_[0-9]*'
  `).all();
  for (const row of tokenRows) {
    const match = /^tokens_(\d+)$/.exec(row.key);
    if (!match) continue;
    const characterId = Number(match[1]);
    if (!Number.isSafeInteger(characterId)) continue;
    if (!connection.prepare('SELECT 1 FROM characters WHERE id = ?').get(characterId)) continue;
    insert.run('oauth', characterId, row.value);
    connection.prepare('DELETE FROM settings WHERE key = ?').run(row.key);
  }
  const janice = connection.prepare(
    "SELECT value FROM settings WHERE key = 'secret_janice_api_key'"
  ).get();
  if (janice) {
    insert.run('janice', null, janice.value);
    connection.prepare("DELETE FROM settings WHERE key = 'secret_janice_api_key'").run();
  }
}

function backfillFitIdentities(connection) {
  const fittingByRun = new Map();
  const implantsByRun = new Map();
  for (const row of connection.prepare(`
    SELECT run_id, type_id, type_name, qty, slot
    FROM run_fitting ORDER BY run_id, id
  `).all()) {
    if (!fittingByRun.has(row.run_id)) fittingByRun.set(row.run_id, []);
    fittingByRun.get(row.run_id).push(row);
  }
  for (const row of connection.prepare(`
    SELECT run_id, type_id, type_name, slot
    FROM run_implants ORDER BY run_id, id
  `).all()) {
    if (!implantsByRun.has(row.run_id)) implantsByRun.set(row.run_id, []);
    implantsByRun.get(row.run_id).push(row);
  }

  const insertIdentity = connection.prepare(`
    INSERT OR IGNORE INTO fit_identities
      (signature, signature_hash, hull_name)
    VALUES (?, ?, ?)
  `);
  const findIdentity = connection.prepare(
    'SELECT id FROM fit_identities WHERE signature = ?'
  );
  const linkRun = connection.prepare(
    'UPDATE runs SET fit_identity_id = ? WHERE id = ?'
  );
  for (const run of connection.prepare('SELECT id FROM runs ORDER BY id').all()) {
    const identity = createFitIdentity(
      fittingByRun.get(run.id) || [],
      implantsByRun.get(run.id) || []
    );
    if (!identity) continue;
    insertIdentity.run(identity.signature, identity.key, identity.hull_name);
    linkRun.run(findIdentity.get(identity.signature).id, run.id);
  }
}

function migrateVersionFourToFive(connection) {
  assertVersionFourDataCanMigrate(connection);
  createVersionFiveTables(connection);
  migrateCredentialSettings(connection);
  backfillFitIdentities(connection);
  connection.exec(`
    CREATE UNIQUE INDEX runs_character_started
      ON runs(character_id, started_at);
    CREATE INDEX idx_runs_fit_identity_started
      ON runs(fit_identity_id, started_at DESC);
  `);
  createValidationTriggers(connection);
}

const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 5, up: migrateVersionFourToFive }),
]);

function migrateSchema(connection, currentVersion) {
  if (currentVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Schema v${currentVersion} is no longer supported; open it in AbyssLog 1.1.5 first`
    );
  }
  let version = currentVersion;
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    migration.up(connection);
    connection.pragma(`user_version = ${migration.version}`);
    version = migration.version;
  }
  return version;
}

module.exports = {
  ABYSSLOG_APPLICATION_ID,
  MIGRATIONS,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  createSchema,
  migrateSchema,
  tableColumns,
};
