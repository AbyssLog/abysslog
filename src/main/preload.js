const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  auth: {
    getCharacters: () => ipcRenderer.invoke('auth:get-characters'),
    saveCharacter: (character) => ipcRenderer.invoke('auth:save-character', character),
    deleteCharacter: (characterId) => ipcRenderer.invoke('auth:delete-character', characterId),
    saveTokens: (characterId, tokens) => ipcRenderer.invoke('auth:save-tokens', { characterId, tokens }),
    getTokens: (characterId) => ipcRenderer.invoke('auth:get-tokens', characterId),
    deleteTokens: (characterId) => ipcRenderer.invoke('auth:delete-tokens', characterId),
  },

  // Settings
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
    getAll: () => ipcRenderer.invoke('settings:get-all'),
  },

  // ESI
  esi: {
    getLocation: (characterId, accessToken) => ipcRenderer.invoke('esi:get-location', { characterId, accessToken }),
    getShip: (characterId, accessToken) => ipcRenderer.invoke('esi:get-ship', { characterId, accessToken }),
    getFitting: (characterId, accessToken) => ipcRenderer.invoke('esi:get-fitting', { characterId, accessToken }),
    getImplants: (characterId, accessToken) => ipcRenderer.invoke('esi:get-implants', { characterId, accessToken }),
    getTypeNames: (typeIds) => ipcRenderer.invoke('esi:get-type-names', typeIds),
    refreshToken: (refreshToken, clientId) => ipcRenderer.invoke('esi:refresh-token', { refreshToken, clientId }),
    verifyToken: (accessToken) => ipcRenderer.invoke('esi:verify-token', accessToken),
    getSystemName: (systemId) => ipcRenderer.invoke('esi:get-system-name', systemId),
    getTypeInfo: (typeId) => ipcRenderer.invoke('esi:get-type-info', typeId),
  },

  // Janice
  janice: {
    appraise: (items, pricing, apiKey) => ipcRenderer.invoke('janice:appraise', { items, pricing, apiKey }),
  },

  // Runs
  runs: {
    save: (runData) => ipcRenderer.invoke('runs:save', runData),
    getAll: (filters) => ipcRenderer.invoke('runs:get-all', filters),
    getById: (runId) => ipcRenderer.invoke('runs:get-by-id', runId),
    delete: (runId) => ipcRenderer.invoke('runs:delete', runId),
    getStats: (characterId) => ipcRenderer.invoke('runs:get-stats', characterId),
    updateAppraisal: (runId, data) => ipcRenderer.invoke('runs:update-appraisal', { runId, data }),
    updateMeta: (runId, data) => ipcRenderer.invoke('runs:update-meta', { runId, data }),
    updateCargoOnly: (runId, data) => ipcRenderer.invoke('runs:update-cargo-only', { runId, data }),
    exportCSV: (characterId) => ipcRenderer.invoke('runs:export-csv', characterId),
    importCSV: (characterId) => ipcRenderer.invoke('runs:import-csv', characterId),
    getDailyStats: (characterId) => ipcRenderer.invoke('runs:get-daily-stats', characterId),
  },

  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },

  // SSO callback listener
  onSsoCallback: (callback) => {
    ipcRenderer.on('sso-callback', (event, callbackUrl) => callback(callbackUrl));
  },
});
