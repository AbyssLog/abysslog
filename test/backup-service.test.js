const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');
const { createBackupService } = require('../src/main/database/backup-service');
const { ABYSSLOG_APPLICATION_ID } = require('../src/main/database/schema');
const { createFreshSchemaV6 } = require('../src/main/database/schema-v6');

test('restore inspection accepts verified schema-v6 migration sources only when requested', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-v6-backup-test-'));
  const filePath = path.join(directory, 'schema-v6.db');
  try {
    const source = new Database(filePath);
    source.pragma('foreign_keys = ON');
    createFreshSchemaV6(source);
    source.pragma('user_version = 6');
    source.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
    source.close();

    const lifecycle = {
      getConnection: () => { throw new Error('Not used'); },
      getPaths: () => ({ databasePath: filePath, backupDirectory: directory }),
      openConnection: (target, options) => new Database(target, options),
      assertConnectionIntegrity: connection => {
        assert.equal(connection.pragma('quick_check', { simple: true }), 'ok');
      },
    };
    const backups = createBackupService(lifecycle);
    assert.throws(() => backups.inspectBackup(filePath), /requires schema v7/i);
    assert.deepEqual(backups.inspectBackup(filePath, { allowSchemaV6: true }), {
      schemaVersion: 6,
      characterCount: 0,
      runCount: 0,
      size: fs.statSync(filePath).size,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
