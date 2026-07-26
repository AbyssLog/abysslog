const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  auth: {
    getCharacters: () => ipcRenderer.invoke('auth:get-characters'),
    hasTokens: characterId => ipcRenderer.invoke('auth:has-tokens', characterId),
    startSso: () => ipcRenderer.invoke('auth:start-sso'),
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
    getTypeNames: typeIds => ipcRenderer.invoke('esi:get-type-names', typeIds),
    getSystemName: systemId => ipcRenderer.invoke('esi:get-system-name', systemId),
    getTypeInfo: typeId => ipcRenderer.invoke('esi:get-type-info', typeId),
  },

  janice: {
    appraise: (items, pricing) => ipcRenderer.invoke('janice:appraise', items, pricing),
    testKey: apiKey => ipcRenderer.invoke('janice:test-key', apiKey),
  },

  runs: {
    save: runData => ipcRenderer.invoke('runs:save', runData),
    getAll: filters => ipcRenderer.invoke('runs:get-all', filters),
    getById: runId => ipcRenderer.invoke('runs:get-by-id', runId),
    delete: runId => ipcRenderer.invoke('runs:delete', runId),
    getStats: characterId => ipcRenderer.invoke('runs:get-stats', characterId),
    updateAppraisal: (runId, data) => ipcRenderer.invoke('runs:update-appraisal', runId, data),
    updateMeta: (runId, data) => ipcRenderer.invoke('runs:update-meta', runId, data),
    updateCargoOnly: (runId, data) => ipcRenderer.invoke('runs:update-cargo-only', runId, data),
    exportCSV: characterId => ipcRenderer.invoke('runs:export-csv', characterId),
    importCSV: characterId => ipcRenderer.invoke('runs:import-csv', characterId),
    getDailyStats: characterId => ipcRenderer.invoke('runs:get-daily-stats', characterId),
  },

  data: {
    getStatus: () => ipcRenderer.invoke('data:get-status'),
    createBackup: () => ipcRenderer.invoke('data:create-backup'),
    openBackupFolder: () => ipcRenderer.invoke('data:open-backup-folder'),
  },

  shell: {
    openExternal: url => ipcRenderer.invoke('shell:open-external', url),
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  },
});
