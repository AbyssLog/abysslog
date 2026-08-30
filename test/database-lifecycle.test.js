const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');
const {
  ABYSSLOG_APPLICATION_ID,
  SCHEMA_VERSION,
  createSchema,
} = require('../src/main/database/schema');
const { createFreshSchemaV6 } = require('../src/main/database/schema-v6');

function withLifecycle(setup, assertion) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-lifecycle-test-'));
  const databasePath = path.join(directory, 'abysslog.db');
  const originalLoad = Module._load;
  const lifecyclePath = require.resolve('../src/main/database/lifecycle-service');
  let lifecycle;
  try {
    const connection = new Database(databasePath);
    setup(connection);
    connection.close();
    Module._load = function loadWithElectronMock(request, parent, isMain) {
      if (request === 'electron') return { app: { getPath: () => directory } };
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[lifecyclePath];
    const { createDatabaseLifecycle } = require(lifecyclePath);
    lifecycle = createDatabaseLifecycle();
    assertion(lifecycle, databasePath);
  } finally {
    try { lifecycle?.close(); } catch {}
    Module._load = originalLoad;
    delete require.cache[lifecyclePath];
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function createCurrentDatabase(connection) {
  connection.pragma('foreign_keys = ON');
  createSchema(connection);
  connection.pragma(`user_version = ${SCHEMA_VERSION}`);
  connection.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
}

test('fresh foreign database identity is rejected without mutation', () => {
  withLifecycle(
    connection => connection.pragma('application_id = 1234'),
    (lifecycle, databasePath) => {
      assert.throws(() => lifecycle.init(), /belongs to another application/i);
      const rejected = new Database(databasePath, { readonly: true, fileMustExist: true });
      assert.equal(rejected.pragma('application_id', { simple: true }), 1234);
      assert.equal(rejected.pragma('user_version', { simple: true }), 0);
      assert.equal(rejected.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' "
        + "AND name NOT LIKE 'sqlite_%'"
      ).get().count, 0);
      rejected.close();
    }
  );
});

test('schema v5 is rejected without mutation or migration backup', () => {
  withLifecycle(
    connection => connection.exec('CREATE TABLE marker (value TEXT); PRAGMA user_version = 5;'),
    (lifecycle, databasePath) => {
      assert.throws(() => lifecycle.init(), /schema v5 is not supported.*requires schema v7/i);
      const rejected = new Database(databasePath, { readonly: true, fileMustExist: true });
      assert.equal(rejected.pragma('user_version', { simple: true }), 5);
      assert.ok(rejected.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'marker'").get());
      rejected.close();
      assert.equal(fs.existsSync(path.join(path.dirname(databasePath), 'backups')), false);
    }
  );
});

test('schema v6 migrates transactionally with a verified pre-migration backup', () => {
  withLifecycle(
    connection => {
      connection.pragma('foreign_keys = ON');
      createFreshSchemaV6(connection);
      connection.pragma('user_version = 6');
      connection.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
      connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
        .run(9001, 'Migration Pilot');
      connection.prepare(`
        INSERT INTO runs (run_uid, character_id, started_at, duration, tier, weather, outcome)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        '550e8400-e29b-41d4-a716-446655440000',
        9001,
        1_800_000_000,
        600,
        'T2',
        'Dark',
        'Survived'
      );
      connection.prepare(`
        INSERT INTO active_run_state (character_id, snapshot) VALUES (?, ?)
      `).run(9001, JSON.stringify({
        version: 2,
        state: 'in-abyss',
        run: { character_id: 9001 },
      }));
    },
    (lifecycle, databasePath) => {
      lifecycle.init();
      const migrated = lifecycle.getConnection();
      assert.equal(migrated.pragma('user_version', { simple: true }), 7);
      assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM encounters').get().count, 1);
      assert.ok(migrated.prepare('SELECT encounter_id FROM runs').get().encounter_id);
      const snapshot = JSON.parse(
        migrated.prepare('SELECT snapshot FROM active_run_state').get().snapshot
      );
      assert.equal(snapshot.version, 3);
      assert.match(snapshot.run.encounter_uid, /^[0-9a-f-]{36}$/);

      const backupDirectory = path.join(path.dirname(databasePath), 'backups');
      const backups = fs.readdirSync(backupDirectory)
        .filter(name => name.startsWith('abysslog-before-schema-v7-') && name.endsWith('.db'));
      assert.equal(backups.length, 1);
      const backup = new Database(path.join(backupDirectory, backups[0]), {
        readonly: true,
        fileMustExist: true,
      });
      assert.equal(backup.pragma('user_version', { simple: true }), 6);
      assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 1);
      backup.close();
    }
  );
});

test('current schema rejects unsupported credential formats', () => {
  withLifecycle(
    connection => {
      createCurrentDatabase(connection);
      connection.pragma('ignore_check_constraints = ON');
      connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
        .run(8998, 'Unsupported Credential Pilot');
      connection.prepare(`
        INSERT INTO credentials (kind, character_id, ciphertext, format_version)
        VALUES ('oauth', 8998, 'legacy-ciphertext', 0)
      `).run();
      connection.pragma('ignore_check_constraints = OFF');
    },
    lifecycle => assert.throws(
      () => lifecycle.init(),
      /unsupported credential format|integrity check failed/i
    )
  );
});

test('current schema rejects missing structural objects', () => {
  withLifecycle(
    connection => {
      createCurrentDatabase(connection);
      connection.exec('DROP INDEX idx_run_tags_tag');
    },
    lifecycle => assert.throws(() => lifecycle.init(), /missing index idx_run_tags_tag/i)
  );
});
