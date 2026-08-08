const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  auth: {
    getCharacters: () => ipcRenderer.invoke('auth:get-characters'),
    hasTokens: characterId => ipcRenderer.invoke('auth:has-tokens', characterId),
    getCapabilities: characterId => ipcRenderer.invoke('auth:get-capabilities', characterId),
    startSso: capabilities => ipcRenderer.invoke('auth:start-sso', capabilities),
    deleteCharacter: characterId => ipcRenderer.invoke('auth:delete-character', characterId),
    onComplete: callback => {
      const listener = (_event, character) => callback(character);
      ipcRenderer.on('auth:complete', listener);
      return () => ipcRenderer.removeListener('auth:complete', listener);
    },
    onError: callback => {
      const listener = (_event, message) => callback(message);
      ipcRenderer.on('auth:error', listener);
      return () => ipcRenderer.removeListener('auth:error', listener);
    },
  },

  settings: {
    get: key => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:get-all'),
  },

  secrets: {
    status: () => ipcRenderer.invoke('secrets:status'),
    hasJaniceKey: () => ipcRenderer.invoke('secrets:has-janice-key'),
    setJaniceKey: apiKey => ipcRenderer.invoke('secrets:set-janice-key', apiKey),
    deleteJaniceKey: () => ipcRenderer.invoke('secrets:delete-janice-key'),
  },

  esi: {
    getLocation: characterId => ipcRenderer.invoke('esi:get-location', characterId),
    getShip: characterId => ipcRenderer.invoke('esi:get-ship', characterId),
    getFitting: characterId => ipcRenderer.invoke('esi:get-fitting', characterId),
    getImplants: characterId => ipcRenderer.invoke('esi:get-implants', characterId),
    getRecentAbyssLoss: (characterId, startedAt, endedAt) =>
      ipcRenderer.invoke('esi:get-recent-abyss-loss', characterId, startedAt, endedAt),
    getTypeNames: typeIds => ipcRenderer.invoke('esi:get-type-names', typeIds),
    getSystemName: systemId => ipcRenderer.invoke('esi:get-system-name', systemId),
    getTypeInfo: typeId => ipcRenderer.invoke('esi:get-type-info', typeId),
  },

  janice: {
    appraise: (items, pricing) => ipcRenderer.invoke('janice:appraise', items, pricing),
    testKey: apiKey => ipcRenderer.invoke('janice:test-key', apiKey),
  },

  loadouts: {
    get: () => ipcRenderer.invoke('loadouts:get'),
    save: presets => ipcRenderer.invoke('loadouts:save', { presets }),
  },

  runs: {
    save: runData => ipcRenderer.invoke('runs:save', runData),
    completeActive: runData => ipcRenderer.invoke('runs:complete-active', runData),
    getActive: characterId => ipcRenderer.invoke('runs:get-active', characterId),
    saveActive: snapshot => ipcRenderer.invoke('runs:save-active', snapshot),
    clearActive: characterId => ipcRenderer.invoke('runs:clear-active', characterId),
    getAll: filters => ipcRenderer.invoke('runs:get-all', filters),
    getById: runId => ipcRenderer.invoke('runs:get-by-id', runId),
    copyFitting: runId => ipcRenderer.invoke('runs:copy-fitting', runId),
    delete: runId => ipcRenderer.invoke('runs:delete', runId),
    getInventoryBaseline: characterId =>
      ipcRenderer.invoke('runs:get-inventory-baseline', characterId),
    clearInventoryBaseline: (characterId, runId) =>
      ipcRenderer.invoke('runs:clear-inventory-baseline', characterId, runId),
    getStats: filters => ipcRenderer.invoke('runs:get-stats', filters),
    getRecentIskPerHour: characterId => ipcRenderer.invoke('runs:get-recent-isk-per-hour', characterId),
    updateAppraisal: (runId, data) => ipcRenderer.invoke('runs:update-appraisal', runId, data),
    update: (runId, data) => ipcRenderer.invoke('runs:update', runId, data),
    exportCSV: characterId => ipcRenderer.invoke('runs:export-csv', characterId),
    importCSV: characterId => ipcRenderer.invoke('runs:import-csv', characterId),
    getDailyStats: filters => ipcRenderer.invoke('runs:get-daily-stats', filters),
  },

  data: {
    getStatus: () => ipcRenderer.invoke('data:get-status'),
    createBackup: () => ipcRenderer.invoke('data:create-backup'),
    restoreBackup: () => ipcRenderer.invoke('data:restore-backup'),
    openBackupFolder: () => ipcRenderer.invoke('data:open-backup-folder'),
  },

  diagnostics: {
    getStatus: () => ipcRenderer.invoke('diagnostics:get-status'),
    openFolder: () => ipcRenderer.invoke('diagnostics:open-folder'),
    copySummary: () => ipcRenderer.invoke('diagnostics:copy-summary'),
    recordRendererError: category =>
      ipcRenderer.invoke('diagnostics:record-renderer-error', category),
  },

  shell: {
    openExternal: url => ipcRenderer.invoke('shell:open-external', url),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  },
});
