const fs = require('node:fs');
const path = require('node:path');

const { app } = require('electron');
const {
  ABYSSLOG_APPLICATION_ID,
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
  createSchema,
  migrateSchema,
  tableColumns,
} = require('./schema');
const { runInTransaction } = require('./transaction');

function assertConnectionIntegrity(connection) {
  const results = connection.pragma('quick_check');
  if (
    results.length !== 1
    || Object.values(results[0]).length !== 1
    || Object.values(results[0])[0] !== 'ok'
  ) {
    throw new Error('Database integrity check failed');
  }
}

function userTableNames(connection) {
  return new Set(connection.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map(row => row.name));
}

function assertCurrentSchema(connection) {
  const required = {
    characters: ['id', 'name'],
    settings: ['key', 'value'],
    credentials: ['id', 'kind', 'character_id', 'ciphertext', 'format_version'],
    fit_identities: ['id', 'signature', 'signature_hash', 'hull_name', 'display_name'],
    runs: ['id', 'character_id', 'started_at', 'hull_name', 'fit_identity_id'],
    run_items: ['id', 'run_id', 'item_name', 'qty', 'type'],
    run_fitting: ['id', 'run_id', 'type_id', 'type_name', 'qty', 'slot'],
    run_implants: ['id', 'run_id', 'type_id', 'type_name', 'slot'],
    run_tags: ['run_id', 'tag'],
    run_killmails: ['run_id', 'killmail_id'],
    active_run_state: ['character_id', 'snapshot', 'updated_at'],
  };
  const tables = userTableNames(connection);
  for (const [table, columns] of Object.entries(required)) {
    if (!tables.has(table)) throw new Error(`Schema v${SCHEMA_VERSION} is missing ${table}`);
    const actual = tableColumns(connection, table);
    if (columns.some(column => !actual.has(column))) {
      throw new Error(`Schema v${SCHEMA_VERSION} has an invalid ${table} table`);
    }
  }
  if (connection.pragma('foreign_key_check').length > 0) {
    throw new Error('Database contains inconsistent related data');
  }
}

function migrationTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

function createDatabaseLifecycle() {
  let connection = null;
  let Database = null;
  let databasePath = null;
  let backupDirectory = null;

  function databaseConstructor() {
    Database ||= require('better-sqlite3');
    return Database;
  }

  function getPaths() {
    if (!databasePath || !backupDirectory) {
      throw new Error('Database lifecycle is not initialized');
    }
    return { databasePath, backupDirectory };
  }

  function getConnection() {
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function openConnection(filePath, options) {
    const Constructor = databaseConstructor();
    return new Constructor(filePath, options);
  }

  function configureConnection(target) {
    target.pragma('journal_mode = WAL');
    target.pragma('secure_delete = ON');
    target.pragma('foreign_keys = ON');
  }

  function createPreMigrationBackup(currentVersion) {
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const fileName = `abysslog-before-migration-v${currentVersion}-to-v${SCHEMA_VERSION}-${migrationTimestamp()}.db`;
    const backupPath = path.join(backupDirectory, fileName);
    connection.pragma('wal_checkpoint(TRUNCATE)');
    connection.close();
    connection = null;
    try {
      fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(backupPath, 0o600);
      const backup = openConnection(backupPath, { readonly: true, fileMustExist: true });
      try {
        assertConnectionIntegrity(backup);
        if (backup.pragma('user_version', { simple: true }) !== currentVersion) {
          throw new Error('Pre-migration backup schema version did not match the source');
        }
      } finally {
        backup.close();
      }
      return backupPath;
    } catch (error) {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      throw error;
    } finally {
      connection = openConnection(databasePath);
      configureConnection(connection);
    }
  }

  function init() {
    const userDataDirectory = app.getPath('userData');
    databasePath = path.join(userDataDirectory, 'abysslog.db');
    backupDirectory = path.join(userDataDirectory, 'backups');

    try {
      connection = openConnection(databasePath);
      configureConnection(connection);
      assertConnectionIntegrity(connection);

      const currentVersion = connection.pragma('user_version', { simple: true });
      const applicationId = connection.pragma('application_id', { simple: true });
      const tables = userTableNames(connection);
      const isFresh = currentVersion === 0 && tables.size === 0;

      if (currentVersion > SCHEMA_VERSION) {
        throw new Error('Database was created by a newer version of AbyssLog');
      }
      if (applicationId !== 0 && applicationId !== ABYSSLOG_APPLICATION_ID) {
        throw new Error('Database belongs to another application');
      }
      if (!isFresh && currentVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
        throw new Error(
          `Database schema v${currentVersion} is no longer supported. `
          + 'Open this database in AbyssLog 1.1.5 first, then retry the upgrade.'
        );
      }

      if (isFresh) {
        runInTransaction(connection, () => {
          createSchema(connection);
          connection.pragma(`user_version = ${SCHEMA_VERSION}`);
          connection.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
        });
      } else if (currentVersion < SCHEMA_VERSION) {
        createPreMigrationBackup(currentVersion);
        runInTransaction(connection, () => {
          migrateSchema(connection, currentVersion);
          connection.pragma(`application_id = ${ABYSSLOG_APPLICATION_ID}`);
        });
      }

      if (connection.pragma('application_id', { simple: true }) !== ABYSSLOG_APPLICATION_ID) {
        throw new Error('Database identity is invalid');
      }
      assertCurrentSchema(connection);
      assertConnectionIntegrity(connection);
    } catch (error) {
      if (connection?.open) connection.close();
      connection = null;
      const message = error instanceof Error ? error.message : 'Unknown database error';
      throw new Error(
        `AbyssLog could not safely open its database: ${message}. `
        + `The original file was left in place. Backups are stored in ${backupDirectory}.`
      );
    }
  }

  function close() {
    if (!connection) return;
    try {
      if (connection.open) connection.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      if (connection.open) connection.close();
      connection = null;
    }
  }

  return Object.freeze({
    assertConnectionIntegrity,
    assertCurrentSchema,
    close,
    getConnection,
    getPaths,
    init,
    openConnection,
  });
}

module.exports = { createDatabaseLifecycle };
