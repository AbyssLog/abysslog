const fs = require('node:fs');
const path = require('node:path');

const { CURRENT_SCHEMA_CONTRACT: V6_SCHEMA_CONTRACT } = require('./schema-contract-v6');
const { getSchemaIssues } = require('./schema-validator');
const { migrateSchemaV6ToV7 } = require('./schema-v7');
const { runInTransaction } = require('./transaction');

function migrationTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

function removeSidecars(filePath) {
  for (const suffix of ['-shm', '-wal']) {
    const sidecar = `${filePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

function migrateFromSchemaV6({
  connection,
  databasePath,
  backupDirectory,
  openConnection,
  assertConnectionIntegrity,
}) {
  const issues = getSchemaIssues(connection, V6_SCHEMA_CONTRACT);
  if (issues.length) throw new Error(`Schema v6 is invalid: ${issues.join('; ')}`);

  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  connection.pragma('wal_checkpoint(FULL)');
  const backupPath = path.join(
    backupDirectory,
    `abysslog-before-schema-v7-${migrationTimestamp()}.db`
  );
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  let backup;
  try {
    backup = openConnection(backupPath, { readonly: true, fileMustExist: true });
    assertConnectionIntegrity(backup);
    if (backup.pragma('user_version', { simple: true }) !== 6) {
      throw new Error('Migration backup schema version is invalid');
    }
    if (getSchemaIssues(backup, V6_SCHEMA_CONTRACT).length > 0) {
      throw new Error('Migration backup schema is invalid');
    }
    if (backup.pragma('foreign_key_check').length > 0) {
      throw new Error('Migration backup contains inconsistent related data');
    }
  } catch (error) {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    throw error;
  } finally {
    if (backup?.open) backup.close();
    removeSidecars(backupPath);
  }

  runInTransaction(connection, () => migrateSchemaV6ToV7(connection));
  return backupPath;
}

module.exports = { migrateFromSchemaV6 };
