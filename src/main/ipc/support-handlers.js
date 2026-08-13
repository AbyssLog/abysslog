const RENDERER_DIAGNOSTIC_CATEGORIES = new Set([
  'capture-error',
  'checkpoint-error',
  'recovery-error',
  'ui-error',
  'unhandled-rejection',
  'window-error',
]);

function registerSupportHandlers({
  secureHandle,
  database,
  security,
  dialog,
  shell,
  clipboard,
  app,
  updateService,
  getMainWindow,
  getDiagnostics,
  createDiagnosticsSummary,
  recordDiagnostic,
  recordDiagnosticWarning,
  recordDiagnosticFailure,
  scheduleRestoreRestart,
}) {
  secureHandle('data:get-status', () => ({
    ...database.getDataStatus(),
    automaticBackupsEnabled: true,
  }));
  secureHandle('data:create-backup', () => {
    const result = database.createManualBackup();
    recordDiagnostic('backup.created', { source: 'manual' });
    return result;
  });
  secureHandle('data:restore-backup', async () => {
    const { backupDirectory } = database.getDataStatus();
    const { filePaths, canceled } = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Restore Full Backup',
      defaultPath: backupDirectory,
      buttonLabel: 'Select Backup',
      filters: [{ name: 'AbyssLog Database Backups', extensions: ['db'] }],
      properties: ['openFile', 'dontAddToRecent'],
    });
    if (canceled || !filePaths.length) return { success: false, canceled: true };

    const inspection = database.inspectBackup(filePaths[0]);
    const characterLabel = inspection.characterCount === 1 ? 'character' : 'characters';
    const runLabel = inspection.runCount === 1 ? 'run' : 'runs';
    const confirmation = await dialog.showMessageBox(getMainWindow(), {
      type: 'warning',
      title: 'Restore Full Backup',
      message: 'Replace the current AbyssLog data with this backup?',
      detail:
        'The backup contains ' + inspection.characterCount + ' ' + characterLabel + ' and '
        + inspection.runCount + ' ' + runLabel + '. AbyssLog will first preserve the current '
        + 'database as a before-restore backup, then restart.\n\n'
        + 'Credentials encrypted on another operating-system installation may not be '
        + 'recoverable; affected characters and the Janice API key will need to be reconnected.',
      buttons: ['Cancel', 'Restore and Restart'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { success: false, canceled: true };

    const result = database.restoreBackup(filePaths[0]);
    recordDiagnostic('backup.restored', {
      source: 'manual',
      schemaVersion: result.schemaVersion,
      characterCount: result.characterCount,
      runCount: result.runCount,
    });
    scheduleRestoreRestart();
    return { success: true, restarting: true };
  });
  secureHandle('data:open-backup-folder', async () => {
    const { backupDirectory } = database.getDataStatus();
    const error = await shell.openPath(backupDirectory);
    if (error) throw new Error('Could not open backup folder: ' + error);
    return true;
  });

  secureHandle('diagnostics:get-status', () => {
    const diagnostics = getDiagnostics();
    if (!diagnostics) return { available: false };
    return { available: true, ...diagnostics.getStatus() };
  });
  secureHandle('diagnostics:open-folder', async () => {
    const diagnostics = getDiagnostics();
    if (!diagnostics) throw new Error('Diagnostics are unavailable');
    const error = await shell.openPath(diagnostics.getStatus().directory);
    if (error) throw new Error('Could not open diagnostics folder: ' + error);
    recordDiagnostic('diagnostics.folder_opened', { source: 'settings' });
    return true;
  });
  secureHandle('diagnostics:copy-summary', () => {
    clipboard.writeText(createDiagnosticsSummary());
    recordDiagnostic('diagnostics.summary_copied', { source: 'settings' });
    return true;
  });
  secureHandle('diagnostics:record-renderer-error', category => {
    const safeCategory = security.requireString(category, 'Diagnostic category', 64);
    if (!RENDERER_DIAGNOSTIC_CATEGORIES.has(safeCategory)) {
      throw new TypeError('Diagnostic category is invalid');
    }
    recordDiagnosticWarning('renderer.reported_error', {
      category: safeCategory,
      source: 'renderer',
    });
    return true;
  });

  secureHandle('shell:open-external', async url => {
    if (!security.isAllowedExternalUrl(url)) throw new Error('External URL is not allowed');
    await shell.openExternal(url);
    return true;
  });

  secureHandle('app:get-version', () => app.getVersion());
  secureHandle('app:check-update', async () => {
    try {
      const result = await updateService.checkForUpdate(app.getVersion());
      recordDiagnostic('update.check_complete', {
        source: 'github',
        releaseAvailable: !result.noRelease,
      });
      return result;
    } catch (error) {
      recordDiagnosticFailure('update.check_failure', { source: 'github' }, error);
      return { success: false };
    }
  });
}

module.exports = { registerSupportHandlers };
