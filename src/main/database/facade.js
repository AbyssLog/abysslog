const { createBackupService } = require('./backup-service');
const { createCharacterSettingsRepository } = require('./character-settings-repository');
const { createCredentialRepository } = require('./credential-repository');
const { createDatabaseLifecycle } = require('./lifecycle-service');
const { createInventoryBaselineRepository } = require('./inventory-baseline-repository-v6');
const { createTrackingDraftRepository } = require('./tracking-draft-repository');
const { createRunCsvRepository } = require('./run-csv-repository-v6');
const { createRunRepository } = require('./run-repository-v6');
const { createStatisticsRepository } = require('./statistics-repository-v6');
const { createStatisticsReportRepository } = require('./statistics-report-repository');

const lifecycle = createDatabaseLifecycle();
const getConnection = () => lifecycle.getConnection();

const characterSettings = createCharacterSettingsRepository(getConnection);
const credentials = createCredentialRepository(getConnection);
const inventoryBaselines = createInventoryBaselineRepository(getConnection, characterSettings);
const trackingDrafts = createTrackingDraftRepository(getConnection);
const runRepository = createRunRepository(getConnection);
const statisticsRepository = createStatisticsRepository(getConnection);
const statisticsReports = createStatisticsReportRepository(getConnection);
const runCsvRepository = createRunCsvRepository(
  getConnection,
  runRepository.getRuns,
  runRepository.saveRun
);
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
  getCredential: credentials.getCredential,
  setCredential: credentials.setCredential,
  deleteCredential: credentials.deleteCredential,
  getInventoryBaseline: inventoryBaselines.getInventoryBaseline,
  clearInventoryBaseline: inventoryBaselines.clearInventoryBaseline,
  saveRun: runRepository.saveRun,
  saveEncounter: runRepository.saveEncounter,
  saveActiveRun: runRepository.saveActiveRun,
  getActiveRun: runRepository.getActiveRun,
  getTrackingDraft: trackingDrafts.get,
  clearActiveRun: runRepository.clearActiveRun,
  completeActiveRun: runRepository.completeActiveRun,
  saveTrackingDraft: trackingDrafts.save,
  setFitDisplayName: runRepository.setFitDisplayName,
  updateAppraisal: runRepository.updateAppraisal,
  updateRun: runRepository.updateRun,
  getRuns: runRepository.getRuns,
  getRunById: runRepository.getRunById,
  getAppraisalHistory: runRepository.getAppraisalHistory,
  deleteRun: runRepository.deleteRun,
  getSessionStats: statisticsRepository.getSessionStats,
  getStats: statisticsRepository.getStats,
  getStatisticsReport: statisticsReports.getReport,
  getStatisticsReportOptions: statisticsReports.getOptions,
  exportRunsCSV: runCsvRepository.exportRunsCSV,
  importRunsCSV: runCsvRepository.importRunsCSV,
});
