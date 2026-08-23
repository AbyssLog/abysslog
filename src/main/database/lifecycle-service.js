const path = require('node:path');

const { app } = require('electron');
const {
  ABYSSLOG_APPLICATION_ID,
  SCHEMA_VERSION,
  createSchema,
  getCurrentSchemaIssues,
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
  const issues = getCurrentSchemaIssues(connection);
  if (issues.length) {
    throw new Error(`Schema v${SCHEMA_VERSION} is invalid: ${issues.join('; ')}`);
  }
  if (connection.prepare('SELECT 1 FROM credentials WHERE format_version <> 1').get()) {
    throw new Error('Database contains an unsupported credential format');
  }
  if (connection.pragma('foreign_key_check').length > 0) {
    throw new Error('Database contains inconsistent related data');
  }
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

      if (applicationId !== 0 && applicationId !== ABYSSLOG_APPLICATION_ID) {
        throw new Error('Database belongs to another application');
      }
      if (!isFresh && currentVersion !== SCHEMA_VERSION) {
        throw new Error(
          `Database schema v${currentVersion} is not supported; `
          + `this version requires schema v${SCHEMA_VERSION}`
        );
      }
      if (!isFresh && applicationId !== ABYSSLOG_APPLICATION_ID) {
        throw new Error('Database identity is invalid');
      }

      if (isFresh) {
        runInTransaction(connection, () => {
          createSchema(connection);
          connection.pragma(`user_version = ${SCHEMA_VERSION}`);
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
