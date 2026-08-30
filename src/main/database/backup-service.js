const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ABYSSLOG_APPLICATION_ID,
  SCHEMA_VERSION,
  getCurrentSchemaIssues,
} = require('./schema');
const { CURRENT_SCHEMA_CONTRACT: V6_SCHEMA_CONTRACT } = require('./schema-contract-v6');
const { getSchemaIssues } = require('./schema-validator');

const AUTOMATIC_BACKUP_RETENTION = 7;

function backupTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createBackupService(lifecycle) {
  if (!lifecycle?.getConnection || !lifecycle?.getPaths || !lifecycle?.openConnection) {
    throw new TypeError('Backup service requires a database lifecycle');
  }

  function removeDatabaseSidecars(filePath) {
    for (const suffix of ['-shm', '-wal']) {
      const sidecarPath = `${filePath}${suffix}`;
      if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
    }
  }

  function inspectBackup(filePath, { allowSchemaV6 = false } = {}) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('Backup path is invalid');
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('The selected backup is not a non-empty file');
    }

    const inspectionDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'abysslog-backup-inspect-')
    );
    const inspectionPath = path.join(inspectionDirectory, 'backup.db');
    let backupDb;
    try {
      fs.copyFileSync(filePath, inspectionPath, fs.constants.COPYFILE_EXCL);
      backupDb = lifecycle.openConnection(inspectionPath, { readonly: true, fileMustExist: true });
      lifecycle.assertConnectionIntegrity(backupDb);
      const schemaVersion = backupDb.pragma('user_version', { simple: true });
      const applicationId = backupDb.pragma('application_id', { simple: true });
      if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0) {
        throw new Error('The selected backup has an invalid schema version');
      }
      if (schemaVersion !== SCHEMA_VERSION && !(allowSchemaV6 && schemaVersion === 6)) {
        throw new Error(
          `The selected backup uses schema v${schemaVersion}; `
          + `this version requires schema v${SCHEMA_VERSION}`
        );
      }
      if (applicationId !== ABYSSLOG_APPLICATION_ID) {
        throw new Error('The selected backup does not have a valid AbyssLog database identity');
      }

      const schemaIssues = schemaVersion === SCHEMA_VERSION
        ? getCurrentSchemaIssues(backupDb)
        : getSchemaIssues(backupDb, V6_SCHEMA_CONTRACT);
      if (schemaIssues.length) {
        throw new Error(
          `The selected file is not an AbyssLog full backup: ${schemaIssues.join('; ')}`
        );
      }
      if (backupDb.prepare('SELECT 1 FROM credentials WHERE format_version <> 1').get()) {
        throw new Error('The selected backup contains an unsupported credential format');
      }
      if (backupDb.pragma('foreign_key_check').length > 0) {
        throw new Error('The selected backup contains inconsistent related data');
      }
      return {
        schemaVersion,
        characterCount: backupDb.prepare('SELECT COUNT(*) AS count FROM characters').get().count,
        runCount: backupDb.prepare('SELECT COUNT(*) AS count FROM runs').get().count,
        size: stat.size,
      };
    } finally {
      if (backupDb?.open) backupDb.close();
      fs.rmSync(inspectionDirectory, { recursive: true, force: true });
    }
  }

  function verifyBackup(filePath, options) {
    try {
      inspectBackup(filePath, options);
    } finally {
      // AbyssLog-created copies are standalone and must not retain WAL state.
      removeDatabaseSidecars(filePath);
    }
  }

  function copyDatabaseToBackup(fileName, { replaceExisting = false } = {}) {
    const { databasePath, backupDirectory } = lifecycle.getPaths();
    const connection = lifecycle.getConnection();
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    connection.pragma('wal_checkpoint(FULL)');
    const destination = path.join(backupDirectory, fileName);
    if (!replaceExisting && fs.existsSync(destination)) {
      throw new Error('A backup with this name already exists');
    }

    const operationId = `${process.pid}-${Date.now()}`;
    const temporary = path.join(backupDirectory, `.${fileName}.${operationId}.tmp`);
    const previous = path.join(backupDirectory, `.${fileName}.${operationId}.previous`);
    let previousMoved = false;
    let newInstalled = false;
    try {
      fs.copyFileSync(databasePath, temporary, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(temporary).size === 0) throw new Error('Database backup was empty');
      verifyBackup(temporary);
      if (replaceExisting && fs.existsSync(destination)) {
        removeDatabaseSidecars(destination);
        fs.renameSync(destination, previous);
        previousMoved = true;
      }
      fs.renameSync(temporary, destination);
      newInstalled = true;
    } catch (error) {
      let rollbackError = null;
      if (previousMoved && !newInstalled && fs.existsSync(previous)) {
        try {
          fs.renameSync(previous, destination);
          previousMoved = false;
        } catch (failure) {
          rollbackError = failure;
        }
      }
      if (rollbackError) {
        const message = error instanceof Error ? error.message : 'Unknown backup error';
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : 'Unknown rollback error';
        throw new Error(
          `Backup failed: ${message}. The previous backup could not be restored: ${rollbackMessage}`
        );
      }
      throw error;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (newInstalled && fs.existsSync(previous)) fs.unlinkSync(previous);
    }
    return destination;
  }

  function samePath(left, right) {
    const normalize = value => {
      const resolved = path.resolve(value);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normalize(left) === normalize(right);
  }

  function restoreBackup(sourcePath) {
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
      throw new TypeError('Backup path is invalid');
    }
    const { databasePath } = lifecycle.getPaths();
    if (samePath(sourcePath, databasePath)) {
      throw new Error('The active AbyssLog database cannot be selected as its own backup');
    }

    const inspection = inspectBackup(sourcePath, { allowSchemaV6: true });
    const operationId = `${process.pid}-${Date.now()}`;
    const stagedPath = path.join(path.dirname(databasePath), `.abysslog-restore-${operationId}.tmp`);
    const displacedPath = path.join(
      path.dirname(databasePath), `.abysslog-before-restore-${operationId}.tmp`
    );
    let safetyBackupPath = null;
    let currentMoved = false;
    let restoredInstalled = false;
    let restoredOpened = false;

    try {
      fs.copyFileSync(sourcePath, stagedPath, fs.constants.COPYFILE_EXCL);
      verifyBackup(stagedPath, { allowSchemaV6: true });
      safetyBackupPath = copyDatabaseToBackup(
        `abysslog-before-restore-${backupTimestamp()}.db`
      );

      lifecycle.close();
      removeDatabaseSidecars(databasePath);
      fs.renameSync(databasePath, displacedPath);
      currentMoved = true;
      fs.renameSync(stagedPath, databasePath);
      restoredInstalled = true;

      lifecycle.init();
      restoredOpened = true;
      fs.unlinkSync(displacedPath);
      currentMoved = false;
      return { ...inspection, safetyBackupPath };
    } catch (error) {
      if (restoredOpened) lifecycle.close();
      let connectionUnavailable = false;
      try {
        lifecycle.getConnection();
      } catch {
        connectionUnavailable = true;
      }
      if (connectionUnavailable) lifecycle.close();

      let rollbackError = null;
      if (currentMoved) {
        try {
          removeDatabaseSidecars(databasePath);
          if (restoredInstalled && fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
          fs.renameSync(displacedPath, databasePath);
          currentMoved = false;
          lifecycle.init();
        } catch (failure) {
          rollbackError = failure;
        }
      } else if (connectionUnavailable && fs.existsSync(databasePath)) {
        try {
          lifecycle.init();
        } catch (failure) {
          rollbackError = failure;
        }
      }

      const message = error instanceof Error ? error.message : 'Unknown restore error';
      if (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : 'Unknown rollback error';
        throw new Error(
          `Restore failed: ${message}. Automatic rollback also failed: ${rollbackMessage}. `
          + `The safety backup is ${safetyBackupPath || 'unavailable'}.`
        );
      }
      throw new Error(`Restore failed and the previous database was preserved: ${message}`);
    } finally {
      if (fs.existsSync(stagedPath)) fs.unlinkSync(stagedPath);
      if (!currentMoved && fs.existsSync(displacedPath)) fs.unlinkSync(displacedPath);
    }
  }

  function listBackups() {
    const { backupDirectory } = lifecycle.getPaths();
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    return fs.readdirSync(backupDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^abysslog-(?:auto-\d{4}-\d{2}-\d{2}|manual-\d+T\d+Z|before-(?:restore|schema-v7)-\d+T\d+Z)\.db$/.test(entry.name))
      .map(entry => {
        const filePath = path.join(backupDirectory, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name,
          filePath,
          createdAt: stat.mtimeMs,
          size: stat.size,
          automatic: entry.name.startsWith('abysslog-auto-'),
        };
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  function getDataStatus() {
    const { databasePath, backupDirectory } = lifecycle.getPaths();
    const backups = listBackups();
    const latest = backups[0] || null;
    return {
      databasePath,
      backupDirectory,
      databaseSize: fs.statSync(databasePath).size,
      schemaVersion: lifecycle.getConnection().pragma('user_version', { simple: true }),
      latestBackup: latest
        ? { filePath: latest.filePath, createdAt: latest.createdAt, size: latest.size }
        : null,
      automaticBackupRetention: AUTOMATIC_BACKUP_RETENTION,
    };
  }

  function pruneAutomaticBackups() {
    const automatic = listBackups().filter(backup => backup.automatic);
    for (const backup of automatic.slice(AUTOMATIC_BACKUP_RETENTION)) {
      fs.unlinkSync(backup.filePath);
    }
  }

  function createExitBackup() {
    const filePath = copyDatabaseToBackup(
      `abysslog-auto-${localDateStamp()}.db`,
      { replaceExisting: true }
    );
    pruneAutomaticBackups();
    return { filePath, ...getDataStatus() };
  }

  function createManualBackup() {
    const filePath = copyDatabaseToBackup(`abysslog-manual-${backupTimestamp()}.db`);
    return { filePath, ...getDataStatus() };
  }

  return Object.freeze({
    createExitBackup,
    createManualBackup,
    getDataStatus,
    inspectBackup,
    restoreBackup,
  });
}

module.exports = { AUTOMATIC_BACKUP_RETENTION, createBackupService };
