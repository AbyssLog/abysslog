const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const {
  ABYSSLOG_APPLICATION_ID,
  SCHEMA_VERSION,
  createSchema,
  getCurrentSchemaIssues,
  CURRENT_SCHEMA_CONTRACT,
} = require('../src/main/database/schema');
const { getSchemaIssues } = require('../src/main/database/schema-validator');

test('schema creation provides the normalized v7 contract', () => {
  const connection = new Database(':memory:');
  try {
    connection.pragma('foreign_keys = ON');
    connection.transaction(() => {
      createSchema(connection);
      connection.pragma(`user_version = ${SCHEMA_VERSION}`);
      connection.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
    })();

    assert.equal(connection.pragma('user_version', { simple: true }), 7);
    assert.equal(
      connection.pragma('application_id', { simple: true }),
      ABYSSLOG_APPLICATION_ID
    );
    const tables = new Set(connection.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'table'
    `).all().map(row => row.name));
    for (const table of [
      'credentials', 'fit_identities', 'fit_snapshots', 'runs',
      'inventory_snapshots', 'appraisals', 'active_run_state',
      'encounters', 'tracking_drafts',
    ]) {
      assert.equal(tables.has(table), true, table);
    }
    assert.equal(
      connection.pragma('table_info(runs)').some(column => column.name === 'fit_snapshot_id'),
      true
    );
    assert.equal(
      connection.pragma('table_info(runs)').some(column => column.name === 'encounter_id'),
      true
    );
    assert.deepEqual(getCurrentSchemaIssues(connection), []);
    assert.match(
      connection.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'credentials'"
      ).get().sql,
      /CHECK\s*\(format_version\s*=\s*1\)/
    );

    connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)').run(9001, 'Pilot');
    assert.throws(() => connection.prepare(`
      INSERT INTO credentials (kind, character_id, ciphertext, format_version)
      VALUES ('oauth', 9001, 'ciphertext', 0)
    `).run(), /constraint/i);
    assert.throws(
      () => connection.prepare(`
        INSERT INTO runs (run_uid, character_id, started_at, duration, outcome)
        VALUES ('d9428888-122b-4d54-b1f8-7b86acb06e79', 9001, 1700000000, -1, 'Survived')
      `).run(),
      /constraint|invalid|required/i
    );
  } finally {
    connection.close();
  }
});

test('schema contract reports structural drift', () => {
  const connection = new Database(':memory:');
  try {
    connection.pragma('foreign_keys = ON');
    createSchema(connection);
    connection.exec(`
      DROP INDEX idx_run_tags_tag;
      CREATE INDEX idx_run_tags_tag ON run_tags(run_id);
      CREATE TABLE unexpected_extension (value TEXT);
      ALTER TABLE runs DROP COLUMN system_name;
    `);

    const issues = getCurrentSchemaIssues(connection);
    assert.ok(issues.some(issue => /invalid index idx_run_tags_tag/.test(issue)));
    assert.ok(issues.some(issue => /unexpected tables unexpected_extension/.test(issue)));
    assert.ok(issues.some(issue => /invalid columns for runs; missing system_name/.test(issue)));
  } finally {
    connection.close();
  }
});

test('schema contract validates security-sensitive table definitions', () => {
  const connection = new Database(':memory:');
  try {
    connection.pragma('foreign_keys = ON');
    createSchema(connection);
    const contract = {
      ...CURRENT_SCHEMA_CONTRACT,
      tableSqlIncludes: {
        ...CURRENT_SCHEMA_CONTRACT.tableSqlIncludes,
        credentials: ['CHECK THAT DOES NOT EXIST'],
      },
    };
    assert.ok(getSchemaIssues(connection, contract).includes(
      'invalid definition for credentials'
    ));
  } finally {
    connection.close();
  }
});
