const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const { SCHEMA_VERSION, migrateSchema } = require('../src/main/database/schema');

function createVersionThreeDatabase() {
  const connection = new Database(':memory:');
  connection.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      ship_name TEXT,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE TABLE active_run_state (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    INSERT INTO characters (id, name) VALUES (9001, 'Legacy Pilot');
    INSERT INTO runs (character_id, started_at, outcome, ship_name)
      VALUES (9001, 1700000000, 'Survived', 'Gila');
    PRAGMA user_version = 3;
  `);
  const snapshot = {
    version: 1,
    state: 'in-abyss',
    run: {
      character_id: 9001,
      started_at: 1_700_000_100,
      tier: 'T5',
      weather: 'Gamma',
      ship_name: 'Gila',
    },
  };
  connection.prepare(
    'INSERT INTO active_run_state (character_id, snapshot) VALUES (?, ?)'
  ).run(9001, JSON.stringify(snapshot));
  return connection;
}

function columnNames(connection) {
  return connection.pragma('table_info(runs)').map(column => column.name);
}

test('schema v4 transactionally migrates legacy hull data and active snapshots', () => {
  const connection = createVersionThreeDatabase();
  try {
    connection.transaction(() => migrateSchema(connection, 3))();

    assert.equal(connection.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(columnNames(connection).includes('ship_name'), false);
    assert.equal(columnNames(connection).includes('hull_name'), true);
    assert.equal(connection.prepare('SELECT hull_name FROM runs').get().hull_name, 'Gila');
    assert.deepEqual(
      JSON.parse(connection.prepare('SELECT snapshot FROM active_run_state').get().snapshot),
      {
        version: 2,
        state: 'in-abyss',
        run: {
          character_id: 9001,
          started_at: 1_700_000_100,
          tier: 'T5',
          weather: 'Gamma',
          hull_name: 'Gila',
        },
      }
    );

    const before = connection.prepare('SELECT snapshot FROM active_run_state').get().snapshot;
    connection.transaction(() => migrateSchema(connection, SCHEMA_VERSION))();
    assert.equal(connection.prepare('SELECT snapshot FROM active_run_state').get().snapshot, before);
  } finally {
    connection.close();
  }
});

test('schema migration rollback preserves the complete v3 database', () => {
  const connection = createVersionThreeDatabase();
  try {
    connection.exec(`
      CREATE TRIGGER reject_snapshot_migration
      BEFORE UPDATE ON active_run_state
      BEGIN
        SELECT RAISE(ABORT, 'snapshot migration rejected');
      END;
    `);

    assert.throws(
      () => connection.transaction(() => migrateSchema(connection, 3))(),
      /snapshot migration rejected/
    );
    assert.equal(connection.pragma('user_version', { simple: true }), 3);
    assert.equal(columnNames(connection).includes('ship_name'), true);
    assert.equal(columnNames(connection).includes('hull_name'), false);
    assert.equal(connection.prepare('SELECT ship_name FROM runs').get().ship_name, 'Gila');
    assert.equal(
      JSON.parse(connection.prepare('SELECT snapshot FROM active_run_state').get().snapshot).version,
      1
    );
  } finally {
    connection.close();
  }
});
