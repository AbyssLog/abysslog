const { createBackupService } = require('./backup-service');
const { createCharacterSettingsRepository } = require('./character-settings-repository');
const { createDatabaseLifecycle } = require('./lifecycle-service');
const { createInventoryBaselineRepository } = require('./inventory-baseline-repository');
const { createRunCsvRepository } = require('./run-csv-repository');
const { createRunRepository } = require('./run-repository');
const { createStatisticsRepository } = require('./statistics-repository');

const lifecycle = createDatabaseLifecycle();
const getConnection = () => lifecycle.getConnection();

const characterSettings = createCharacterSettingsRepository(getConnection);
const inventoryBaselines = createInventoryBaselineRepository(getConnection, characterSettings);
const runRepository = createRunRepository(getConnection);
const statisticsRepository = createStatisticsRepository(getConnection);
const runCsvRepository = createRunCsvRepository(getConnection, runRepository.getRuns);
const backups = createBackupService(lifecycle);

function deleteCharacter(characterId) {
  return characterSettings.deleteCharacter(
    characterId,
    [inventoryBaselines.clearMarkerKey(characterId)]
  );
}

module.exports = Object.freeze({
  init: lifecycle.init,
  close: lifecycle.close,
  createExitBackup: backups.createExitBackup,
  createManualBackup: backups.createManualBackup,
  inspectBackup: backups.inspectBackup,
  restoreBackup: backups.restoreBackup,
  getDataStatus: backups.getDataStatus,
  hardenSensitiveStorage: characterSettings.hardenSensitiveStorage,
  getCharacters: characterSettings.getCharacters,
  saveCharacter: characterSettings.saveCharacter,
  deleteCharacter,
  getSetting: characterSettings.getSetting,
  setSetting: characterSettings.setSetting,
  deleteSetting: characterSettings.deleteSetting,
  getInventoryBaseline: inventoryBaselines.getInventoryBaseline,
  clearInventoryBaseline: inventoryBaselines.clearInventoryBaseline,
  saveRun: runRepository.saveRun,
  saveActiveRun: runRepository.saveActiveRun,
  getActiveRun: runRepository.getActiveRun,
  clearActiveRun: runRepository.clearActiveRun,
  completeActiveRun: runRepository.completeActiveRun,
  updateAppraisal: runRepository.updateAppraisal,
  updateRun: runRepository.updateRun,
  getRuns: runRepository.getRuns,
  getRunById: runRepository.getRunById,
  deleteRun: runRepository.deleteRun,
  getStats: statisticsRepository.getStats,
  getDailyStats: statisticsRepository.getDailyStats,
  exportRunsCSV: runCsvRepository.exportRunsCSV,
  importRunsCSV: runCsvRepository.importRunsCSV,
});
