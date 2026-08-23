const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const {
  ABYSSLOG_APPLICATION_ID,
  SCHEMA_VERSION,
  createSchema,
  getCurrentSchemaIssues,
} = require('../src/main/database/schema');

test('schema creation preserves the released v5 contract', () => {
  const connection = new Database(':memory:');
  try {
    connection.pragma('foreign_keys = ON');
    connection.transaction(() => {
      createSchema(connection);
      connection.pragma(`user_version = ${SCHEMA_VERSION}`);
      connection.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
    })();

    assert.equal(connection.pragma('user_version', { simple: true }), 5);
    assert.equal(
      connection.pragma('application_id', { simple: true }),
      ABYSSLOG_APPLICATION_ID
    );
    const tables = new Set(connection.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'table'
    `).all().map(row => row.name));
    for (const table of ['credentials', 'fit_identities', 'runs', 'active_run_state']) {
      assert.equal(tables.has(table), true, table);
    }
    assert.equal(
      connection.pragma('table_info(runs)').some(column => column.name === 'fit_identity_id'),
      true
    );
    assert.deepEqual(getCurrentSchemaIssues(connection), []);
    assert.match(
      connection.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'credentials'"
      ).get().sql,
      /CHECK\s*\(format_version\s*>=\s*0\)/
    );

    connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)').run(9001, 'Pilot');
    connection.prepare(`
      INSERT INTO credentials (kind, character_id, ciphertext, format_version)
      VALUES ('oauth', 9001, 'ciphertext', 0)
    `).run();
    assert.throws(
      () => connection.prepare(`
        INSERT INTO runs (character_id, started_at, duration, outcome)
        VALUES (9001, 1700000000, -1, 'Survived')
      `).run(),
      /constraint|invalid/i
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
      DROP TRIGGER validate_runs_update;
      CREATE TABLE unexpected_extension (value TEXT);
      ALTER TABLE runs DROP COLUMN system_name;
    `);

    const issues = getCurrentSchemaIssues(connection);
    assert.ok(issues.some(issue => /invalid index idx_run_tags_tag/.test(issue)));
    assert.ok(issues.some(issue => /missing trigger validate_runs_update/.test(issue)));
    assert.ok(issues.some(issue => /unexpected tables unexpected_extension/.test(issue)));
    assert.ok(issues.some(issue => /invalid columns for runs; missing system_name/.test(issue)));
  } finally {
    connection.close();
  }
});
