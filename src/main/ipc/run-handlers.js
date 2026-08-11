const fs = require('fs');
const fitting = require('../../shared/fitting');

const MAX_CSV_BYTES = 10 * 1024 * 1024;

function registerRunHandlers({
  secureHandle,
  database,
  security,
  validateObjectPayload,
  validateOptionalCharacterId,
  clipboard,
  dialog,
  getMainWindow,
  recordDiagnostic,
}) {
  secureHandle('runs:save', runData =>
    database.saveRun(security.validateRunData(validateObjectPayload(runData, 'Run'))));
  secureHandle('runs:complete-active', runData =>
    database.completeActiveRun(security.validateRunData(validateObjectPayload(runData, 'Run'))));
  secureHandle('runs:get-active', characterId => {
    const id = security.requireInteger(characterId, 'Character ID');
    const snapshot = database.getActiveRun(id);
    if (!snapshot) return null;
    try {
      const validated = security.validateActiveRunSnapshot(snapshot);
      if (validated.run.character_id !== id) throw new TypeError('Active run character mismatch');
      return validated;
    } catch {
      database.clearActiveRun(id);
      return null;
    }
  });
  secureHandle('runs:save-active', snapshot => {
    const validated = security.validateActiveRunSnapshot(
      validateObjectPayload(snapshot, 'Active run')
    );
    return database.saveActiveRun(validated);
  });
  secureHandle('runs:clear-active', characterId =>
    database.clearActiveRun(security.requireInteger(characterId, 'Character ID')));
  secureHandle('runs:get-all', filters =>
    database.getRuns(security.validateRunFilters(
      filters === undefined ? {} : validateObjectPayload(filters, 'Run filters', 4096)
    )));
  secureHandle('runs:get-by-id', runId =>
    database.getRunById(security.requireInteger(runId, 'Run ID')));
  secureHandle('runs:copy-fitting', runId => {
    const id = security.requireInteger(runId, 'Run ID');
    const run = database.getRunById(id);
    if (!run) throw new Error('Run not found');
    const exported = fitting.createEftExport(run);
    clipboard.writeText(exported.text);
    recordDiagnostic('run.fitting_copied', { source: 'run_detail' });
    return {
      copied: true,
      fittedItemCount: exported.fittedItemCount,
      droneCount: exported.droneCount,
      implantCount: exported.implantCount,
      omittedItemCount: exported.omittedItemCount,
    };
  });
  secureHandle('runs:delete', runId =>
    database.deleteRun(security.requireInteger(runId, 'Run ID')));
  secureHandle('runs:get-inventory-baseline', characterId =>
    database.getInventoryBaseline(security.requireInteger(characterId, 'Character ID')));
  secureHandle('runs:clear-inventory-baseline', (characterId, runId) =>
    database.clearInventoryBaseline(
      security.requireInteger(characterId, 'Character ID'),
      security.requireInteger(runId, 'Run ID')
    ));
  secureHandle('runs:get-stats', filters =>
    database.getStats(security.validateStatsFilters(
      filters === undefined ? {} : validateObjectPayload(filters, 'Statistics filters', 4096)
    )));
  secureHandle('runs:update-appraisal', (runId, data) =>
    database.updateAppraisal(
      security.requireInteger(runId, 'Run ID'),
      security.validateAppraisalUpdate(validateObjectPayload(data, 'Appraisal update'))
    ));
  secureHandle('runs:update', (runId, data) =>
    database.updateRun(
      security.requireInteger(runId, 'Run ID'),
      security.validateRunEdit(validateObjectPayload(data, 'Run edit'))
    ));
  secureHandle('runs:get-daily-stats', filters =>
    database.getDailyStats(security.validateStatsFilters(
      filters === undefined ? {} : validateObjectPayload(filters, 'Statistics filters', 4096)
    )));

  secureHandle('runs:export-csv', async characterId => {
    const csv = database.exportRunsCSV(validateOptionalCharacterId(characterId));
    const { filePath, canceled } = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Export Runs',
      defaultPath: 'abysslog-runs-' + new Date().toISOString().split('T')[0] + '.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { success: false };
    fs.writeFileSync(filePath, csv, { encoding: 'utf8', mode: 0o600 });
    return { success: true, filePath };
  });

  secureHandle('runs:import-csv', async characterId => {
    const { filePaths, canceled } = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import Runs',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false };
    const stat = fs.statSync(filePaths[0]);
    if (!stat.isFile() || stat.size > MAX_CSV_BYTES) throw new Error('CSV file is too large');
    const csv = fs.readFileSync(filePaths[0], 'utf8');
    const result = database.importRunsCSV(csv, validateOptionalCharacterId(characterId));
    return { success: true, ...result };
  });
}

module.exports = { registerRunHandlers };
