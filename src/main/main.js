const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./database');
const esi = require('./esi');
const janice = require('./janice');
const security = require('../shared/security');

const CLIENT_ID = 'c74d7418579645ebbad0665c93e47900';
const OAUTH_REDIRECT_URI = 'eveauth-abysslog://callback';
const OAUTH_SCOPES = [
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-fittings.read_fittings.v1',
  'esi-clones.read_implants.v1',
].join(' ');
const SECRET_PREFIX = 'safe:v1:';
const JANICE_SECRET_KEY = 'secret_janice_api_key';
const MAX_IPC_JSON_BYTES = 2 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;

let mainWindow;
let pendingAuth = null;

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('eveauth-abysslog', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('eveauth-abysslog');
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function isSecureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (
    process.platform === 'linux'
    && typeof safeStorage.getSelectedStorageBackend === 'function'
    && safeStorage.getSelectedStorageBackend() === 'basic_text'
  ) {
    return false;
  }
  return true;
}

function getSecureStorageStatus() {
  let backend = process.platform;
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    backend = safeStorage.getSelectedStorageBackend();
  }
  return { available: isSecureStorageAvailable(), backend };
}

function encryptSecret(value) {
  if (!isSecureStorageAvailable()) {
    throw new Error('Secure credential storage is unavailable on this system');
  }
  const encrypted = safeStorage.encryptString(security.requireString(value, 'Secret', 64 * 1024));
  return SECRET_PREFIX + encrypted.toString('base64');
}

function decryptSecret(stored) {
  if (!stored || !isSecureStorageAvailable()) return null;
  try {
    const encoded = stored.startsWith(SECRET_PREFIX) ? stored.slice(SECRET_PREFIX.length) : stored;
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return null;
  }
}

function tokenKey(characterId) {
  return `tokens_${security.requireInteger(characterId, 'Character ID')}`;
}

function saveTokens(characterId, tokens) {
  if (!security.isPlainObject(tokens)) throw new TypeError('OAuth token response is invalid');
  const accessToken = security.requireString(tokens.access_token, 'Access token', 16 * 1024);
  const refreshToken = security.requireString(tokens.refresh_token, 'Refresh token', 16 * 1024);
  const expiresAt = security.requireInteger(tokens.expires_at, 'Token expiry', {
    min: Date.now() - 60_000,
    max: Number.MAX_SAFE_INTEGER,
  });
  const safeTokens = { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt };
  db.setSetting(tokenKey(characterId), encryptSecret(JSON.stringify(safeTokens)));
}

function loadTokens(characterId) {
  const json = decryptSecret(db.getSetting(tokenKey(characterId)));
  if (!json) return null;
  try {
    const tokens = JSON.parse(json);
    if (!security.isPlainObject(tokens)) return null;
    return {
      access_token: security.requireString(tokens.access_token, 'Access token', 16 * 1024),
      refresh_token: security.requireString(tokens.refresh_token, 'Refresh token', 16 * 1024),
      expires_at: security.requireInteger(tokens.expires_at, 'Token expiry', {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      }),
    };
  } catch {
    return null;
  }
}

function migrateLegacyJaniceKey() {
  const legacyKey = db.getSetting('janice_api_key');
  if (!legacyKey) return;
  if (db.getSetting(JANICE_SECRET_KEY)) {
    db.deleteSetting('janice_api_key');
    return;
  }
  if (!isSecureStorageAvailable()) return;
  db.setSetting(JANICE_SECRET_KEY, encryptSecret(legacyKey));
  db.deleteSetting('janice_api_key');
}

function getJaniceApiKey() {
  return decryptSecret(db.getSetting(JANICE_SECRET_KEY));
}

function getPublicSettings() {
  const settings = {};
  for (const key of security.PUBLIC_SETTING_KEYS) {
    const value = db.getSetting(key);
    if (value !== null) settings[key] = value;
  }
  return settings;
}

function validateIpcSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return (
    event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && event.senderFrame.url === mainWindow.webContents.getURL()
  );
}

function secureHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!validateIpcSender(event)) throw new Error('Unauthorized IPC sender');
    return handler(...args);
  });
}

function validateObjectPayload(value, label, maxBytes = MAX_IPC_JSON_BYTES) {
  if (!security.isPlainObject(value)) throw new TypeError(`${label} must be an object`);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
    throw new TypeError(`${label} is too large`);
  }
  return value;
}

function validateOptionalCharacterId(value) {
  return value === null || value === undefined || value === ''
    ? null
    : security.requireInteger(value, 'Character ID');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function startSso() {
  if (!isSecureStorageAvailable()) {
    throw new Error('Secure credential storage is required before adding a character');
  }

  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(32));
  pendingAuth = { verifier, state, createdAt: Date.now() };

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  const authorizationUrl = `https://login.eveonline.com/v2/oauth/authorize?${params}`;
  if (!security.isAllowedExternalUrl(authorizationUrl)) throw new Error('OAuth destination is not allowed');
  await shell.openExternal(authorizationUrl);
  return true;
}

function sendAuthEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function handleOAuthCallback(callbackUrl) {
  try {
    const callback = security.parseOAuthCallback(callbackUrl);
    const transaction = pendingAuth;

    if (!transaction || Date.now() - transaction.createdAt > 10 * 60 * 1000) {
      throw new Error('No active or valid sign-in request');
    }
    if (!safeEqual(callback.state, transaction.state)) throw new Error('OAuth state validation failed');
    pendingAuth = null;
    if (callback.error) throw new Error(callback.errorDescription);

    const tokens = await esi.exchangeAuthorizationCode(
      callback.code,
      CLIENT_ID,
      transaction.verifier,
      OAUTH_REDIRECT_URI
    );
    tokens.expires_at = Date.now() + security.requireInteger(tokens.expires_in, 'Token lifetime', {
      min: 1,
      max: 86_400,
    }) * 1000;

    const accessToken = security.requireString(tokens.access_token, 'Access token', 16 * 1024);
    const characterInfo = await esi.verifyToken(accessToken);
    const characterId = security.requireInteger(characterInfo.CharacterID, 'Character ID');
    const characterName = security.requireString(characterInfo.CharacterName, 'Character name', 128);
    const character = {
      id: characterId,
      name: characterName,
      portrait_url: `https://images.evetech.net/characters/${characterId}/portrait?size=64`,
      client_id: CLIENT_ID,
    };

    db.saveCharacter(character);
    saveTokens(characterId, tokens);
    sendAuthEvent('auth:complete', character);
  } catch (error) {
    sendAuthEvent('auth:error', error instanceof Error ? error.message : 'Sign-in failed');
  }
}

async function getValidAccessToken(characterId) {
  const id = security.requireInteger(characterId, 'Character ID');
  const tokens = loadTokens(id);
  if (!tokens) throw new Error('Character authorization is unavailable');

  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60_000) {
    const refreshed = await esi.refreshToken(tokens.refresh_token, CLIENT_ID);
    const merged = {
      ...tokens,
      ...refreshed,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + security.requireInteger(refreshed.expires_in, 'Token lifetime', {
        min: 1,
        max: 86_400,
      }) * 1000,
    };
    saveTokens(id, merged);
    return merged.access_token;
  }

  return security.requireString(tokens.access_token, 'Access token', 16 * 1024);
}

async function withCharacterToken(characterId, operation) {
  const id = security.requireInteger(characterId, 'Character ID');
  return operation(id, await getValidAccessToken(id));
}

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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    icon: process.platform === 'win32'
      ? path.join(__dirname, '../../assets/transparent.png')
      : path.join(__dirname, '../../assets/icon.png'),
  });

  const rendererFile = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(rendererFile);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    pendingAuth = null;
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const callbackUrl = commandLine.find(arg => arg.startsWith('eveauth-abysslog://'));
    if (callbackUrl) void handleOAuthCallback(callbackUrl);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    db.init();
    migrateLegacyJaniceKey();
    if (!db.getSetting('janice_api_key')) db.hardenSensitiveStorage();
    createWindow();
  });
}

app.on('open-url', (event, callbackUrl) => {
  event.preventDefault();
  void handleOAuthCallback(callbackUrl);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

secureHandle('auth:get-characters', () => db.getCharacters());
secureHandle('auth:has-tokens', characterId => Boolean(loadTokens(characterId)));
secureHandle('auth:start-sso', () => startSso());
secureHandle('auth:delete-character', characterId => {
  const id = security.requireInteger(characterId, 'Character ID');
  db.deleteSetting(tokenKey(id));
  return db.deleteCharacter(id);
});

secureHandle('settings:get', key => {
  security.requireString(key, 'Setting key', 64);
  if (!security.PUBLIC_SETTING_KEYS.has(key)) throw new TypeError('Setting is not readable');
  return db.getSetting(key);
});
secureHandle('settings:set', (key, value) => db.setSetting(key, security.validatePublicSetting(key, value)));
secureHandle('settings:get-all', () => getPublicSettings());

secureHandle('secrets:status', () => getSecureStorageStatus());
secureHandle('secrets:has-janice-key', () => Boolean(getJaniceApiKey()));
secureHandle('secrets:set-janice-key', apiKey => {
  const key = security.requireTrimmedText(apiKey, 'Janice API key', 4096);
  db.setSetting(JANICE_SECRET_KEY, encryptSecret(key));
  db.deleteSetting('janice_api_key');
  return true;
});
secureHandle('secrets:delete-janice-key', () => {
  db.deleteSetting(JANICE_SECRET_KEY);
  db.deleteSetting('janice_api_key');
  return true;
});

secureHandle('esi:get-location', characterId =>
  withCharacterToken(characterId, (id, token) => esi.getLocation(id, token)));
secureHandle('esi:get-ship', characterId =>
  withCharacterToken(characterId, (id, token) => esi.getShip(id, token)));
secureHandle('esi:get-fitting', characterId =>
  withCharacterToken(characterId, (id, token) => esi.getFitting(id, token)));
secureHandle('esi:get-implants', characterId =>
  withCharacterToken(characterId, (id, token) => esi.getImplants(id, token)));
secureHandle('esi:get-type-names', typeIds => {
  if (!Array.isArray(typeIds) || typeIds.length > 1000) throw new TypeError('Type ID list is invalid');
  return esi.getTypeNames(typeIds.map(id => security.requireInteger(id, 'Type ID')));
});
secureHandle('esi:get-system-name', systemId =>
  esi.getSystemName(security.requireInteger(systemId, 'System ID')));
secureHandle('esi:get-type-info', typeId =>
  esi.getTypeInfo(security.requireInteger(typeId, 'Type ID')));

secureHandle('janice:appraise', (items, pricing) => {
  if (pricing !== 'buy' && pricing !== 'sell') throw new TypeError('Pricing mode is invalid');
  const apiKey = getJaniceApiKey();
  if (!apiKey) throw new Error('Janice API key is unavailable');
  return janice.appraise(security.validateAppraisalItems(items), pricing, apiKey);
});
secureHandle('janice:test-key', apiKey =>
  janice.appraise(
    [{ name: 'Tritanium', qty: 1 }],
    'buy',
    security.requireTrimmedText(apiKey, 'Janice API key', 4096)
  ));

secureHandle('runs:save', runData =>
  db.saveRun(security.validateRunData(validateObjectPayload(runData, 'Run'))));
secureHandle('runs:get-all', filters =>
  db.getRuns(security.validateRunFilters(
    filters === undefined ? {} : validateObjectPayload(filters, 'Run filters', 4096)
  )));
secureHandle('runs:get-by-id', runId => db.getRunById(security.requireInteger(runId, 'Run ID')));
secureHandle('runs:delete', runId => db.deleteRun(security.requireInteger(runId, 'Run ID')));
secureHandle('runs:get-stats', characterId => db.getStats(validateOptionalCharacterId(characterId)));
secureHandle('runs:update-appraisal', (runId, data) =>
  db.updateAppraisal(
    security.requireInteger(runId, 'Run ID'),
    security.validateAppraisalUpdate(validateObjectPayload(data, 'Appraisal update'))
  ));
secureHandle('runs:update-meta', (runId, data) =>
  db.updateMeta(
    security.requireInteger(runId, 'Run ID'),
    security.validateRunMeta(validateObjectPayload(data, 'Run update'))
  ));
secureHandle('runs:update-cargo-only', (runId, data) =>
  db.updateCargoOnly(
    security.requireInteger(runId, 'Run ID'),
    security.validateCargoUpdate(validateObjectPayload(data, 'Cargo update'))
  ));
secureHandle('runs:get-daily-stats', characterId =>
  db.getDailyStats(validateOptionalCharacterId(characterId)));

secureHandle('shell:open-external', async url => {
  if (!security.isAllowedExternalUrl(url)) throw new Error('External URL is not allowed');
  await shell.openExternal(url);
  return true;
});

secureHandle('app:get-version', () => app.getVersion());
secureHandle('app:check-update', async () => new Promise(resolve => {
  const https = require('https');
  const request = https.get(
    'https://raw.githubusercontent.com/AbyssLog/abysslog/main/version.json',
    { headers: { 'User-Agent': 'AbyssLog' } },
    response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        data += chunk;
        if (data.length > 64 * 1024) request.destroy(new Error('Update response is too large'));
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${response.statusCode}` });
          return;
        }
        try {
          const result = JSON.parse(data);
          const version = security.requireString(result.version, 'Release version', 32);
          if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
            throw new TypeError('Release version is invalid');
          }
          const releaseUrl = security.requireString(result.releaseUrl, 'Release URL', 2048);
          if (!security.isAllowedExternalUrl(releaseUrl)) throw new TypeError('Release URL is not allowed');
          const releaseNotes = security.requireString(
            result.releaseNotes || '',
            'Release notes',
            2000,
            true
          );
          resolve({ success: true, version, releaseUrl, releaseNotes });
        } catch {
          resolve({ success: false, error: 'Invalid response' });
        }
      });
    }
  );
  request.on('error', error => resolve({ success: false, error: error.message }));
  request.setTimeout(8000, () => request.destroy(new Error('Timeout')));
}));

secureHandle('runs:export-csv', async characterId => {
  const csv = db.exportRunsCSV(validateOptionalCharacterId(characterId));
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Runs',
    defaultPath: `abysslog-runs-${new Date().toISOString().split('T')[0]}.csv`,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { success: false };
  fs.writeFileSync(filePath, csv, { encoding: 'utf8', mode: 0o600 });
  return { success: true, filePath };
});

secureHandle('runs:import-csv', async characterId => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Runs',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { success: false };
  const stat = fs.statSync(filePaths[0]);
  if (!stat.isFile() || stat.size > MAX_CSV_BYTES) throw new Error('CSV file is too large');
  const csv = fs.readFileSync(filePaths[0], 'utf8');
  const result = db.importRunsCSV(csv, validateOptionalCharacterId(characterId));
  return { success: true, ...result };
});
