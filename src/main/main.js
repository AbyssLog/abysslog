const { app, BrowserWindow, ipcMain, shell, protocol } = require('electron');
const path = require('path');
const url = require('url');

// Keep a global reference to prevent garbage collection
let mainWindow;

// Register custom protocol for EVE SSO callback
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('abysslog', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('abysslog');
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle the protocol callback on Windows/Linux (second instance)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Find the abysslog:// URL in the command line args
    const callbackUrl = commandLine.find(arg => arg.startsWith('abysslog://'));
    if (callbackUrl && mainWindow) {
      mainWindow.webContents.send('sso-callback', callbackUrl);
    }
  });

  app.whenReady().then(() => {
    db.init();
    createWindow();
  });
}

// Handle protocol callback on macOS
app.on('open-url', (event, callbackUrl) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.webContents.send('sso-callback', callbackUrl);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ── IPC: Auth ──────────────────────────────────────────────────────────────

ipcMain.handle('auth:get-characters', async () => {
  return db.getCharacters();
});

ipcMain.handle('auth:save-character', async (event, character) => {
  return db.saveCharacter(character);
});

ipcMain.handle('auth:delete-character', async (event, characterId) => {
  return db.deleteCharacter(characterId);
});

ipcMain.handle('auth:save-tokens', async (event, { characterId, tokens }) => {
  const keytar = require('keytar');
  await keytar.setPassword('abysslog', String(characterId), JSON.stringify(tokens));
  return true;
});

ipcMain.handle('auth:get-tokens', async (event, characterId) => {
  const keytar = require('keytar');
  const raw = await keytar.getPassword('abysslog', String(characterId));
  return raw ? JSON.parse(raw) : null;
});

ipcMain.handle('auth:delete-tokens', async (event, characterId) => {
  const keytar = require('keytar');
  await keytar.deletePassword('abysslog', String(characterId));
  return true;
});

// ── IPC: Settings ──────────────────────────────────────────────────────────

ipcMain.handle('settings:get', async (event, key) => {
  return db.getSetting(key);
});

ipcMain.handle('settings:set', async (event, { key, value }) => {
  return db.setSetting(key, value);
});

ipcMain.handle('settings:get-all', async () => {
  return db.getAllSettings();
});

// ── IPC: ESI ──────────────────────────────────────────────────────────────

ipcMain.handle('esi:get-location', async (event, { characterId, accessToken }) => {
  return esi.getLocation(characterId, accessToken);
});

ipcMain.handle('esi:get-ship', async (event, { characterId, accessToken }) => {
  return esi.getShip(characterId, accessToken);
});

ipcMain.handle('esi:get-fitting', async (event, { characterId, accessToken }) => {
  return esi.getFitting(characterId, accessToken);
});

ipcMain.handle('esi:get-implants', async (event, { characterId, accessToken }) => {
  return esi.getImplants(characterId, accessToken);
});

ipcMain.handle('esi:get-type-names', async (event, typeIds) => {
  return esi.getTypeNames(typeIds);
});

ipcMain.handle('esi:refresh-token', async (event, { refreshToken, clientId }) => {
  return esi.refreshToken(refreshToken, clientId);
});

ipcMain.handle('esi:verify-token', async (event, accessToken) => {
  return esi.verifyToken(accessToken);
});

ipcMain.handle('esi:get-system-name', async (event, systemId) => {
  return esi.getSystemName(systemId);
});

// ── IPC: Janice ───────────────────────────────────────────────────────────

ipcMain.handle('janice:appraise', async (event, { items, pricing, apiKey }) => {
  return janice.appraise(items, pricing, apiKey);
});

// ── IPC: Runs ─────────────────────────────────────────────────────────────

ipcMain.handle('runs:save', async (event, runData) => {
  return db.saveRun(runData);
});

ipcMain.handle('runs:get-all', async (event, filters) => {
  return db.getRuns(filters);
});

ipcMain.handle('runs:get-by-id', async (event, runId) => {
  return db.getRunById(runId);
});

ipcMain.handle('runs:delete', async (event, runId) => {
  return db.deleteRun(runId);
});

ipcMain.handle('runs:get-stats', async (event, characterId) => {
  return db.getStats(characterId);
});

// ── IPC: Shell ────────────────────────────────────────────────────────────

ipcMain.handle('shell:open-external', async (event, url) => {
  await shell.openExternal(url);
});
