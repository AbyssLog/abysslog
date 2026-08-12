const path = require('node:path');

const { app } = require('electron');
const { createSchema, migrateSchema, SCHEMA_VERSION } = require('./schema');
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

  function init() {
    const userDataDirectory = app.getPath('userData');
    databasePath = path.join(userDataDirectory, 'abysslog.db');
    backupDirectory = path.join(userDataDirectory, 'backups');

    try {
      connection = openConnection(databasePath);
      connection.pragma('journal_mode = WAL');
      connection.pragma('secure_delete = ON');
      connection.pragma('foreign_keys = ON');
      assertConnectionIntegrity(connection);

      const currentVersion = connection.pragma('user_version', { simple: true });
      if (currentVersion > SCHEMA_VERSION) {
        throw new Error('Database was created by a newer version of AbyssLog');
      }
      runInTransaction(connection, () => {
        createSchema(connection);
        migrateSchema(connection, currentVersion);
      });
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
    close,
    getConnection,
    getPaths,
    init,
    openConnection,
  });
}

module.exports = { createDatabaseLifecycle };
