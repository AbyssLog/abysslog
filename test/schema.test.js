const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const {
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  migrateSchema,
} = require('../src/main/database/schema');

function createVersionFourDatabase() {
  const connection = new Database(':memory:');
  connection.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      portrait_url TEXT,
      client_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
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
      system_name TEXT,
      appraised_at INTEGER,
      cargo_before TEXT,
      cargo_after TEXT,
      drone_before TEXT,
      drone_after TEXT,
      hull_name TEXT,
      ship_class TEXT,
      notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE TABLE run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('gained','consumed','lost')),
      unit_price_buy REAL DEFAULT 0,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE run_fitting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      slot TEXT,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE run_implants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      slot INTEGER,
      unit_price_sell REAL DEFAULT 0,
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
    INSERT INTO characters (id, name) VALUES (9001, 'Schema Four Pilot');
    INSERT INTO settings (key, value) VALUES
      ('tokens_9001', 'safe:v1:oauth-ciphertext'),
      ('secret_janice_api_key', 'safe:v1:janice-ciphertext');
    INSERT INTO runs (
      character_id, started_at, duration, tier, weather, outcome, hull_name, ship_class
    ) VALUES (9001, 1700000000, 600, 'T5', 'Gamma', 'Survived', 'Gila', 'Cruiser');
    INSERT INTO run_fitting (run_id, type_id, type_name, qty, slot) VALUES
      (1, 17715, 'Gila', 1, 'hull'),
      (1, 2048, 'Damage Control II', 1, 'LoSlot0');
    INSERT INTO run_implants (run_id, type_id, type_name, slot)
      VALUES (1, 9941, 'Memory Augmentation - Basic', 1);
    INSERT INTO active_run_state (character_id, snapshot) VALUES
      (9001, '{"version":2,"state":"in-abyss","run":{"character_id":9001,"hull_name":"Gila"}}');
    PRAGMA user_version = 4;
  `);
  return connection;
}

function tables(connection) {
  return connection.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'table'
  `).all().map(row => row.name);
}

test('schema v5 transactionally migrates the v1.1.5 baseline', () => {
  const connection = createVersionFourDatabase();
  try {
    connection.transaction(() => migrateSchema(connection, 4))();

    assert.equal(connection.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(connection.prepare(
      "SELECT COUNT(*) AS count FROM settings WHERE key LIKE 'tokens_%' OR key = 'secret_janice_api_key'"
    ).get().count, 0);
    assert.deepEqual(connection.prepare(`
      SELECT kind, character_id, ciphertext, format_version FROM credentials ORDER BY kind DESC
    `).all(), [
      { kind: 'oauth', character_id: 9001, ciphertext: 'safe:v1:oauth-ciphertext', format_version: 0 },
      { kind: 'janice', character_id: null, ciphertext: 'safe:v1:janice-ciphertext', format_version: 0 },
    ]);

    const run = connection.prepare(`
      SELECT fit_identity_id FROM runs WHERE id = 1
    `).get();
    assert.ok(Number.isSafeInteger(run.fit_identity_id));
    const identity = connection.prepare(`
      SELECT signature, signature_hash, hull_name, display_name
      FROM fit_identities WHERE id = ?
    `).get(run.fit_identity_id);
    assert.match(identity.signature, /Gila|type:17715/i);
    assert.match(identity.signature_hash, /^[0-9a-f]{8}$/);
    assert.equal(identity.hull_name, 'Gila');
    assert.equal(identity.display_name, null);
    assert.equal(
      JSON.parse(connection.prepare('SELECT snapshot FROM active_run_state').get().snapshot).version,
      2
    );

    assert.throws(
      () => connection.prepare(`
        INSERT INTO runs (character_id, started_at, outcome) VALUES (9001, 1700000000, 'Survived')
      `).run(),
      /unique/i
    );
    assert.throws(
      () => connection.prepare(`
        INSERT INTO runs (character_id, started_at, duration, outcome)
        VALUES (9001, 1700000001, -1, 'Survived')
      `).run(),
      /invalid/i
    );

    const before = connection.prepare('SELECT COUNT(*) AS count FROM fit_identities').get().count;
    connection.transaction(() => migrateSchema(connection, SCHEMA_VERSION))();
    assert.equal(connection.prepare('SELECT COUNT(*) AS count FROM fit_identities').get().count, before);
  } finally {
    connection.close();
  }
});

test('schema v5 migration rollback preserves the complete v4 database', () => {
  const connection = createVersionFourDatabase();
  try {
    connection.prepare(`
      INSERT INTO runs (character_id, started_at, outcome) VALUES (9001, 1700000000, 'Died')
    `).run();

    assert.throws(
      () => connection.transaction(() => migrateSchema(connection, 4))(),
      /duplicate run timestamps/
    );
    assert.equal(connection.pragma('user_version', { simple: true }), 4);
    assert.equal(tables(connection).includes('credentials'), false);
    assert.equal(tables(connection).includes('fit_identities'), false);
    assert.equal(connection.pragma('table_info(runs)').some(column =>
      column.name === 'fit_identity_id'), false);
    assert.equal(connection.prepare("SELECT value FROM settings WHERE key = 'tokens_9001'").get().value,
      'safe:v1:oauth-ciphertext');
  } finally {
    connection.close();
  }
});

test('schemas older than the v1.1.5 baseline are rejected without mutation', () => {
  const connection = new Database(':memory:');
  try {
    connection.exec(`CREATE TABLE marker (value TEXT); PRAGMA user_version = 3;`);
    assert.throws(
      () => connection.transaction(() => migrateSchema(connection, 3))(),
      /AbyssLog 1\.1\.5 first/
    );
    assert.equal(connection.pragma('user_version', { simple: true }), 3);
    assert.deepEqual(tables(connection).filter(name => name !== 'sqlite_sequence'), ['marker']);
    assert.equal(MIN_SUPPORTED_SCHEMA_VERSION, 4);
  } finally {
    connection.close();
  }
});
