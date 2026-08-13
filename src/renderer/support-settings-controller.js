(function initSupportSettingsController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssSupportSettings = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function createSupportSettingsController({
    document,
    api,
    state,
    formatBytes,
    formatIsk,
    renderCharList,
    refreshSavedRunViews,
    startPolling,
    schedule = setTimeout,
    confirmAction = message => globalThis.confirm(message),
  }) {
    if (!document || !api || !state) {
      throw new Error('Support/settings controller requires document, APIs, and state');
    }
    for (const dependency of [
      formatBytes, formatIsk, renderCharList,
      refreshSavedRunViews, startPolling, schedule, confirmAction,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Support/settings controller dependencies must be functions');
      }
    }

    function loadSettingsPage() {
      const keyInput = document.getElementById('janiceKeyInput');
      keyInput.value = '';
      keyInput.disabled = !state.secureStorage.available;
      keyInput.placeholder = state.hasJaniceKey
        ? 'Saved securely - enter a replacement'
        : 'Your Janice API key...';
      document.getElementById('removeJaniceKeyBtn').style.display = state.hasJaniceKey ? 'inline-flex' : 'none';

      const storageStatus = document.getElementById('secureStorageStatus');
      storageStatus.textContent = state.secureStorage.available
        ? `Credentials are protected by the operating system (${state.secureStorage.backend}).`
        : 'Secure credential storage is unavailable. Sign-in and API-key storage are disabled.';
      storageStatus.style.color = state.secureStorage.available ? 'var(--text-dim)' : 'var(--red)';

      if (state.settings.esi_poll_interval) document.getElementById('pollIntervalInput').value = state.settings.esi_poll_interval;
      if (state.settings.default_tier) document.getElementById('defaultTierInput').value = state.settings.default_tier;
      if (state.settings.default_weather) document.getElementById('defaultWeatherInput').value = state.settings.default_weather;
      renderCharList();
      renderDataStatus();
      renderDiagnosticsStatus();
    }

    // Backup value rendering uses the shared formatBytes alias.

    function renderDataStatus() {
      if (!state.dataStatus) return;
      const summary = document.getElementById('backupSummary');
      const location = document.getElementById('backupLocation');
      const createButton = document.getElementById('createBackupBtn');

      if (!state.dataStatus.automaticBackupsEnabled) {
        summary.textContent = 'Automatic backups are paused until secure credential storage is available.';
      } else if (state.dataStatus.latestBackup) {
        const backupDate = new Date(state.dataStatus.latestBackup.createdAt);
        summary.textContent = `Latest full backup: ${backupDate.toLocaleString()} (${formatBytes(state.dataStatus.latestBackup.size)}).`;
      } else {
        summary.textContent = 'No full database backup has been created yet.';
      }
      location.textContent = `Backup folder: ${state.dataStatus.backupDirectory}`;
      createButton.disabled = !state.dataStatus.automaticBackupsEnabled;
    }

    function renderDiagnosticsStatus() {
      if (!state.diagnosticsStatus) return;
      const summary = document.getElementById('diagnosticsSummary');
      const location = document.getElementById('diagnosticsLocation');
      const openButton = document.getElementById('openDiagnosticsFolderBtn');
      const copyButton = document.getElementById('copyDiagnosticsBtn');
      if (!state.diagnosticsStatus.available) {
        summary.textContent = 'Local diagnostics are unavailable in this session.';
        summary.style.color = 'var(--red)';
        location.textContent = '';
        openButton.disabled = true;
        copyButton.disabled = true;
        return;
      }
      summary.style.color = 'var(--text-dim)';
      summary.textContent =
        `Local diagnostics are retained for ${state.diagnosticsStatus.retentionDays} days, up to ${state.diagnosticsStatus.maxFiles} files of ${formatBytes(state.diagnosticsStatus.maxFileBytes)} each.`;
      location.textContent = `Diagnostics folder: ${state.diagnosticsStatus.directory}`;
      openButton.disabled = false;
      copyButton.disabled = false;
    }

    async function createFullBackup() {
      const status = document.getElementById('backupActionStatus');
      status.textContent = 'Creating backup...';
      status.className = 'alert';
      status.style.display = 'block';
      try {
        await api.data.createBackup();
        state.dataStatus = await api.data.getStatus();
        renderDataStatus();
        status.textContent = 'Full database backup created successfully.';
        status.className = 'alert success';
      } catch (error) {
        status.textContent = `Backup failed: ${error.message}`;
        status.className = 'alert err';
      }
    }

    async function restoreFullBackup() {
      const status = document.getElementById('backupActionStatus');
      const restoreButton = document.querySelector('[data-action="restore-full-backup"]');
      restoreButton.disabled = true;
      status.textContent = 'Select a full backup to restore...';
      status.className = 'alert';
      status.style.display = 'block';

      try {
        const result = await api.data.restoreBackup();
        if (!result.success) {
          status.textContent = 'Restore cancelled. No data was changed.';
          status.className = 'alert';
          restoreButton.disabled = false;
          return;
        }

        status.textContent = 'Backup restored successfully. AbyssLog is restarting...';
        status.className = 'alert success';
      } catch (error) {
        status.textContent = `Restore failed: ${error.message}`;
        status.className = 'alert err';
        restoreButton.disabled = false;
      }
    }

    async function openBackupFolder() {
      const status = document.getElementById('backupActionStatus');
      try {
        await api.data.openBackupFolder();
      } catch (error) {
        status.textContent = `Could not open backup folder: ${error.message}`;
        status.className = 'alert err';
        status.style.display = 'block';
      }
    }

    async function openDiagnosticsFolder() {
      const status = document.getElementById('diagnosticsActionStatus');
      await api.diagnostics.openFolder();
      status.textContent = 'Diagnostics folder opened.';
      status.className = 'alert success';
      status.style.display = 'block';
    }

    async function copyDiagnostics() {
      const status = document.getElementById('diagnosticsActionStatus');
      await api.diagnostics.copySummary();
      status.textContent = 'Diagnostics copied to clipboard.';
      status.className = 'alert success';
      status.style.display = 'block';
    }

    async function testJaniceKey() {
      const apiKey = document.getElementById('janiceKeyInput').value.trim();
      const resultEl = document.getElementById('janiceTestResult');
      if (!apiKey && !state.hasJaniceKey) {
        resultEl.textContent = 'Enter an API key first.';
        resultEl.className = 'alert err';
        resultEl.style.display = 'block';
        return;
      }
      resultEl.textContent = 'Testing...';
      resultEl.className = 'alert';
      resultEl.style.display = 'block';
      try {
        const result = apiKey
          ? await api.janice.testKey(apiKey)
          : await api.janice.appraise([{ name: 'Tritanium', qty: 1 }], 'buy');
        if (result && result.items && result.items.length > 0) {
          const price = result.items[0].effectivePrices.buyPrice;
          resultEl.textContent = `API key valid - Tritanium buy price: ${formatIsk(price)} ISK`;
          resultEl.className = 'alert success';
        } else {
          resultEl.textContent = 'Key accepted but no price data returned.';
          resultEl.className = 'alert warn';
        }
      } catch(e) {
        resultEl.textContent = `Test failed: ${e.message}`;
        resultEl.className = 'alert err';
      }
    }

    function toggleJaniceKey(btn) {
      const input = document.getElementById('janiceKeyInput');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    }

    async function removeJaniceKey() {
      if (!confirmAction('Remove the saved Janice API key?')) return;
      await api.secrets.deleteJaniceKey();
      state.hasJaniceKey = false;
      loadSettingsPage();
      const resultEl = document.getElementById('janiceTestResult');
      resultEl.textContent = 'Saved API key removed.';
      resultEl.className = 'alert success';
      resultEl.style.display = 'block';
    }

    async function importCSV() {
      const result = await api.runs.importCSV(state.activeCharId || null);
      const el = document.getElementById('csvStatus');
      if (!result.success) { el.style.display = 'none'; return; }
      let msg = `<div class="alert success">Imported ${result.imported} run${result.imported !== 1 ? 's' : ''}`;
      if (result.skipped) msg += `, ${result.skipped} skipped (duplicates)`;
      msg += '.</div>';
      if (result.errors && result.errors.length) {
        msg += `<div class="alert warn" style="margin-top:6px">${result.errors.slice(0,3).map(esc).join('<br>')}</div>`;
      }
      el.innerHTML = msg;
      el.style.display = 'block';
      await refreshSavedRunViews();
    }

    async function saveSettings() {
      const previousPollInterval = state.settings.esi_poll_interval;
      const apiKey = document.getElementById('janiceKeyInput').value.trim();
      const updates = {
        esi_poll_interval: document.getElementById('pollIntervalInput').value,
        default_tier: document.getElementById('defaultTierInput').value,
        default_weather: document.getElementById('defaultWeatherInput').value,
      };
      if (apiKey) {
        await api.secrets.setJaniceKey(apiKey);
        state.hasJaniceKey = true;
      }
      for (const [key, value] of Object.entries(updates)) {
        await api.settings.set(key, value);
      }
      state.settings = { ...state.settings, ...updates };
      if (
        String(previousPollInterval || '') !== String(updates.esi_poll_interval || '')
        && state.activeCharId
        && state.capabilities.tracking
      ) {
        startPolling();
      }
      loadSettingsPage();
      const msg = document.getElementById('settingsSaved');
      msg.style.display = 'block';
      schedule(() => msg.style.display = 'none', 2500);
    }

    return Object.freeze({
      copyDiagnostics,
      createFullBackup,
      importCSV,
      load: loadSettingsPage,
      openBackupFolder,
      openDiagnosticsFolder,
      removeJaniceKey,
      restoreFullBackup,
      save: saveSettings,
      testJaniceKey,
      toggleJaniceKey,
    });
  }

  return Object.freeze({ createSupportSettingsController });
});
