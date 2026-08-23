const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const { ABYSSLOG_APPLICATION_ID } = require('../src/main/database/schema');
const { SCHEMA_VERSION_V6, createFreshSchemaV6 } = require('../src/main/database/schema-v6');

test('fresh schema v6 creates the normalized storage contract', () => {
  const connection = new Database(':memory:');
  try {
    connection.pragma('foreign_keys = ON');
    createFreshSchemaV6(connection);
    connection.pragma('user_version = ' + SCHEMA_VERSION_V6);
    connection.pragma('application_id = ' + ABYSSLOG_APPLICATION_ID);
    const tables = new Set(connection.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table'"
    ).all().map(row => row.name));
    for (const table of [
      'runs',
      'inventory_snapshots',
      'inventory_snapshot_items',
      'fit_snapshots',
      'fit_snapshot_items',
      'fit_snapshot_implants',
      'appraisals',
      'appraisal_lines',
    ]) {
      assert.equal(tables.has(table), true, table);
    }
    for (const removed of ['run_items', 'run_fitting', 'run_implants']) {
      assert.equal(tables.has(removed), false, removed);
    }
    assert.equal(connection.pragma('foreign_key_check').length, 0);
    assert.equal(connection.pragma('quick_check', { simple: true }), 'ok');
  } finally {
    connection.close();
  }
});
