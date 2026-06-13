const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('eveauth-abysslog', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('eveauth-abysslog');
}

const db = require('./database');
const esi = require('./esi');
const janice = require('./janice');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0c10',
    title: '',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    // Use transparent PNG to suppress the icon in the Windows title bar
    icon: process.platform === 'win32'
      ? path.join(__dirname, '../../assets/transparent.png')
      : path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const callbackUrl = commandLine.find(arg => arg.startsWith('eveauth-abysslog://'));
    if (callbackUrl && mainWindow) {
      mainWindow.webContents.send('sso-callback', callbackUrl);
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    db.init();
    createWindow();
  });
}

app.on('open-url', (event, callbackUrl) => {
  event.preventDefault();
  if (mainWindow) mainWindow.webContents.send('sso-callback', callbackUrl);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ── IPC: Auth ──────────────────────────────────────────────────────────────

ipcMain.handle('auth:get-characters', async () => db.getCharacters());
ipcMain.handle('auth:save-character', async (e, character) => db.saveCharacter(character));
ipcMain.handle('auth:delete-character', async (e, characterId) => db.deleteCharacter(characterId));

ipcMain.handle('auth:save-tokens', async (e, { characterId, tokens }) => {
  const json = JSON.stringify(tokens);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    db.setSetting(`tokens_${characterId}`, encrypted.toString('base64'));
  } else {
    db.setSetting(`tokens_${characterId}`, Buffer.from(json).toString('base64'));
  }
  return true;
});

ipcMain.handle('auth:get-tokens', async (e, characterId) => {
  const stored = db.getSetting(`tokens_${characterId}`);
  if (!stored) return null;
  try {
    const buf = Buffer.from(stored, 'base64');
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(buf);
      return JSON.parse(json);
    } else {
      return JSON.parse(buf.toString('utf8'));
    }
  } catch { return null; }
});

ipcMain.handle('auth:delete-tokens', async (e, characterId) => {
  db.deleteSetting(`tokens_${characterId}`);
  return true;
});

// ── IPC: Settings ──────────────────────────────────────────────────────────

ipcMain.handle('settings:get', async (e, key) => db.getSetting(key));
ipcMain.handle('settings:set', async (e, { key, value }) => db.setSetting(key, value));
ipcMain.handle('settings:get-all', async () => db.getAllSettings());

// ── IPC: ESI ──────────────────────────────────────────────────────────────

ipcMain.handle('esi:get-location', async (e, { characterId, accessToken }) => esi.getLocation(characterId, accessToken));
ipcMain.handle('esi:get-ship', async (e, { characterId, accessToken }) => esi.getShip(characterId, accessToken));
ipcMain.handle('esi:get-fitting', async (e, { characterId, accessToken }) => esi.getFitting(characterId, accessToken));
ipcMain.handle('esi:get-implants', async (e, { characterId, accessToken }) => esi.getImplants(characterId, accessToken));
ipcMain.handle('esi:get-type-names', async (e, typeIds) => esi.getTypeNames(typeIds));
ipcMain.handle('esi:refresh-token', async (e, { refreshToken, clientId }) => esi.refreshToken(refreshToken, clientId));
ipcMain.handle('esi:verify-token', async (e, accessToken) => esi.verifyToken(accessToken));
ipcMain.handle('esi:get-system-name', async (e, systemId) => esi.getSystemName(systemId));
ipcMain.handle('esi:get-type-info', async (e, typeId) => esi.getTypeInfo(typeId));

// ── IPC: Janice ───────────────────────────────────────────────────────────

ipcMain.handle('janice:appraise', async (e, { items, pricing, apiKey }) => janice.appraise(items, pricing, apiKey));

// ── IPC: Runs ─────────────────────────────────────────────────────────────

ipcMain.handle('runs:save', async (e, runData) => db.saveRun(runData));
ipcMain.handle('runs:get-all', async (e, filters) => db.getRuns(filters));
ipcMain.handle('runs:get-by-id', async (e, runId) => db.getRunById(runId));
ipcMain.handle('runs:delete', async (e, runId) => db.deleteRun(runId));
ipcMain.handle('runs:get-stats', async (e, characterId) => db.getStats(characterId));
ipcMain.handle('runs:update-appraisal', async (e, { runId, data }) => db.updateAppraisal(runId, data));
ipcMain.handle('runs:update-meta', async (e, { runId, data }) => db.updateMeta(runId, data));
ipcMain.handle('runs:update-cargo-only', async (e, { runId, data }) => db.updateCargoOnly(runId, data));
ipcMain.handle('runs:get-daily-stats', async (e, characterId) => db.getDailyStats(characterId));

// ── IPC: Shell ────────────────────────────────────────────────────────────

ipcMain.handle('shell:open-external', async (e, url) => shell.openExternal(url));

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:check-update', async () => {
  return new Promise((resolve) => {
    const https = require('https');
    const url = 'https://raw.githubusercontent.com/YOUR_USERNAME/abysslog/main/version.json';
    const req = https.get(url, { headers: { 'User-Agent': 'AbyssLog' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ success: true, ...JSON.parse(data) });
        } catch(e) {
          resolve({ success: false, error: 'Invalid response' });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
  });
});

ipcMain.handle('runs:export-csv', async (e, characterId) => {
  const csv = db.exportRunsCSV(characterId);
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Runs',
    defaultPath: `abysslog-runs-${new Date().toISOString().split('T')[0]}.csv`,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });
  if (canceled || !filePath) return { success: false };
  fs.writeFileSync(filePath, csv, 'utf8');
  return { success: true, filePath };
});

ipcMain.handle('runs:import-csv', async (e, characterId) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Runs',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return { success: false };
  const csv = fs.readFileSync(filePaths[0], 'utf8');
  const result = db.importRunsCSV(csv, characterId);
  return { success: true, ...result };
});
