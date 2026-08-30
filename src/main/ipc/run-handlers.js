const fs = require('fs');
const fitting = require('../../shared/fitting');
const runPayloads = require('./run-payloads');
const statisticsReport = require('../../shared/statistics-report');

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
  secureHandle('runs:save-encounter', encounter =>
    database.saveEncounter(security.validateEncounterData(
      validateObjectPayload(encounter, 'Manual encounter', 8 * 1024 * 1024)
    ).participants));
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
  secureHandle('runs:get-tracking-draft', characterId => {
    const id = security.requireInteger(characterId, 'Character ID');
    const draft = database.getTrackingDraft(id);
    if (!draft) return null;
    try {
      const validated = security.validateTrackingDraft(draft);
      if (validated.character_id !== id) throw new TypeError('Tracking draft character mismatch');
      return validated;
    } catch {
      return null;
    }
  });
  secureHandle('runs:save-tracking-draft', draft =>
    database.saveTrackingDraft(security.validateTrackingDraft(
      validateObjectPayload(draft, 'Tracking draft', 1024 * 1024)
    )));
  secureHandle('runs:clear-active', characterId =>
    database.clearActiveRun(security.requireInteger(characterId, 'Character ID')));
  secureHandle('runs:get-all', filters => {
    const validated = security.validateRunFilters(
      filters === undefined ? {} : validateObjectPayload(filters, 'Run filters', 4096)
    );
    return database.getRuns(validated).map(runPayloads.mapRunSummary);
  });
  secureHandle('runs:get-by-id', runId => {
    const id = security.requireInteger(runId, 'Run ID');
    return runPayloads.mapRunDetail(database.getRunById(id));
  });
  secureHandle('runs:get-appraisal-history', runId => {
    const id = security.requireInteger(runId, 'Run ID');
    return database.getAppraisalHistory(id).map(runPayloads.mapAppraisalHistoryItem);
  });
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
  secureHandle('fits:set-display-name', (fitIdentityId, displayName) => {
    const id = security.requireInteger(fitIdentityId, 'Fit identity ID');
    const name = displayName == null
      ? null
      : security.requireTrimmedText(displayName, 'Fit display name', 80);
    return database.setFitDisplayName(id, name);
  });

  secureHandle('runs:delete', runId =>
    database.deleteRun(security.requireInteger(runId, 'Run ID')));
  secureHandle('runs:get-inventory-baseline', characterId => {
    const id = security.requireInteger(characterId, 'Character ID');
    return runPayloads.mapInventoryBaseline(database.getInventoryBaseline(id));
  });
  secureHandle('runs:clear-inventory-baseline', (characterId, runId) =>
    database.clearInventoryBaseline(
      security.requireInteger(characterId, 'Character ID'),
      security.requireInteger(runId, 'Run ID')
    ));
  secureHandle('runs:get-stats', filters =>
    database.getStats(statisticsReport.validateScope(
      filters === undefined ? {} : validateObjectPayload(filters, 'Statistics scope', 4096)
    )));
  secureHandle('runs:get-session-stats', scope =>
    database.getSessionStats(statisticsReport.validateScope(
      scope === undefined ? {} : validateObjectPayload(scope, 'Session scope', 4096)
    )));
  secureHandle('runs:get-statistics-report-options', scope =>
    database.getStatisticsReportOptions(statisticsReport.validateScope(
      scope === undefined ? {} : validateObjectPayload(scope, 'Statistics report scope', 4096)
    )));
  secureHandle('runs:get-statistics-report', report =>
    database.getStatisticsReport(statisticsReport.validateReportRequest(
      validateObjectPayload(report, 'Statistics report', 16 * 1024)
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
  secureHandle('runs:export-csv', async filters => {
    const validatedFilters = security.validateRunFilters(
      filters === undefined ? {} : validateObjectPayload(filters, 'Run filters', 4096)
    );
    const { csv, count } = database.exportRunsCSV(validatedFilters);
    const isFiltered = Object.keys(validatedFilters).some(key => key !== 'character_id');
    const { filePath, canceled } = await dialog.showSaveDialog(getMainWindow(), {
      title: isFiltered ? 'Export Filtered History' : 'Export All History',
      defaultPath: 'abysslog-' + (isFiltered ? 'filtered-' : '') + 'runs-'
        + new Date().toISOString().split('T')[0] + '.csv',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { success: false };
    fs.writeFileSync(filePath, csv, { encoding: 'utf8', mode: 0o600 });
    return { success: true, filePath, scope: isFiltered ? 'filtered' : 'all', runCount: count };
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
