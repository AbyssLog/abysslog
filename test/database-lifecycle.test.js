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

test('older schema is rejected without creating a migration backup', () => {
  withLifecycle(
    connection => connection.exec('CREATE TABLE marker (value TEXT); PRAGMA user_version = 4;'),
    (lifecycle, databasePath) => {
      assert.throws(() => lifecycle.init(), /schema v4 is not supported.*requires schema v5/i);
      const rejected = new Database(databasePath, { readonly: true, fileMustExist: true });
      assert.equal(rejected.pragma('user_version', { simple: true }), 4);
      assert.ok(rejected.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'marker'").get());
      rejected.close();
      assert.equal(fs.existsSync(path.join(path.dirname(databasePath), 'backups')), false);
    }
  );
});

test('current schema rejects unsupported credential formats', () => {
  withLifecycle(
    connection => {
      createCurrentDatabase(connection);
      connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
        .run(8998, 'Unsupported Credential Pilot');
      connection.prepare(`
        INSERT INTO credentials (kind, character_id, ciphertext, format_version)
        VALUES ('oauth', 8998, 'legacy-ciphertext', 0)
      `).run();
    },
    lifecycle => assert.throws(() => lifecycle.init(), /unsupported credential format/i)
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
