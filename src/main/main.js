const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
} = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  APP_PROTOCOL_SCHEME,
  APP_RENDERER_URL,
  resolveAppAssetPath,
} = require('./app-protocol');
const { registerCharacterDeletionHandler } = require('./character-handlers');
const db = require('./database');
const { createDiagnostics } = require('./diagnostics');
const esi = require('./esi');
const janice = require('./janice');
const { createUpdateService } = require('./update-service');
const fitting = require('../shared/fitting');
const loadouts = require('../shared/loadouts');
const runTracking = require('../shared/run-tracking');
const security = require('../shared/security');

const CLIENT_ID = 'c74d7418579645ebbad0665c93e47900';
const OAUTH_REDIRECT_URI = 'eveauth-abysslog://callback';
const LEGACY_OAUTH_SCOPES = [
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-fittings.read_fittings.v1',
  'esi-clones.read_implants.v1',
];
const SECRET_PREFIX = 'safe:v1:';
const JANICE_SECRET_KEY = 'secret_janice_api_key';
const LOADOUT_PRESETS_KEY = 'loadout_presets_v1';
const MAX_IPC_JSON_BYTES = 2 * 1024 * 1024;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const RENDERER_DIAGNOSTIC_CATEGORIES = new Set([
  'capture-error',
  'checkpoint-error',
  'recovery-error',
  'ui-error',
  'unhandled-rejection',
  'window-error',
]);

let mainWindow;
let pendingAuth = null;
let diagnostics = null;
let rendererRecoveryOpen = false;
let appIsQuitting = false;
let startupComplete = false;
let exitBackupAttempted = false;
let restoreRestartScheduled = false;
const updateService = createUpdateService();

function recordDiagnostic(event, details) {
  diagnostics?.info(event, details);
}

function recordDiagnosticWarning(event, details) {
  diagnostics?.warn(event, details);
}

function recordDiagnosticFailure(event, details, error) {
  diagnostics?.failure(event, details, error);
}

function initializeDiagnostics() {
  diagnostics = createDiagnostics({
    directory: app.getPath('logs'),
  });
  const pruneTimer = setInterval(
    () => diagnostics?.prune(),
    6 * 60 * 60 * 1000
  );
  pruneTimer.unref();
  recordDiagnostic('app.start', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });
}

function createDiagnosticsSummary() {
  if (!diagnostics) throw new Error('Diagnostics are not available yet');
  return diagnostics.createSummary({
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
  });
}

process.on('uncaughtExceptionMonitor', error => {
  recordDiagnosticFailure('process.uncaught_exception', { source: 'main' }, error);
});

process.on('unhandledRejection', reason => {
  recordDiagnosticFailure('process.unhandled_rejection', { source: 'main' }, reason);
});

protocol.registerSchemesAsPrivileged([{
  scheme: APP_PROTOCOL_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    codeCache: true,
  },
}]);

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
  const scopes = security.validateEsiScopes(tokens.scopes);
  const safeTokens = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scopes,
  };
  db.setSetting(tokenKey(characterId), encryptSecret(JSON.stringify(safeTokens)));
}

function loadTokens(characterId) {
  const json = decryptSecret(db.getSetting(tokenKey(characterId)));
  if (!json) return null;
  try {
    const tokens = JSON.parse(json);
    if (!security.isPlainObject(tokens)) return null;
    const scopes = tokens.scopes == null
      ? [...LEGACY_OAUTH_SCOPES]
      : security.validateEsiScopes(tokens.scopes);
    return {
      access_token: security.requireString(tokens.access_token, 'Access token', 16 * 1024),
      refresh_token: security.requireString(tokens.refresh_token, 'Refresh token', 16 * 1024),
      expires_at: security.requireInteger(tokens.expires_at, 'Token expiry', {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
      }),
      scopes,
    };
  } catch {
    return null;
  }
}

const tokenCoordinator = runTracking.createTokenCoordinator({
  loadTokens,
  saveTokens,
  clearTokens: characterId => db.deleteSetting(tokenKey(characterId)),
  refreshTokens: refreshToken => esi.refreshToken(refreshToken, CLIENT_ID),
  validateAccessToken: token =>
    security.requireString(token, 'Access token', 16 * 1024),
  validateLifetime: lifetime =>
    security.requireInteger(lifetime, 'Token lifetime', { min: 1, max: 86_400 }),
});

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
    if (!validateIpcSender(event)) {
      const error = new Error('Unauthorized IPC sender');
      recordDiagnosticFailure('ipc.rejected', { context: channel }, error);
      throw error;
    }
    if (restoreRestartScheduled) {
      throw new Error('AbyssLog is restarting after restoring a backup');
    }
    try {
      return await handler(...args);
    } catch (error) {
      recordDiagnosticFailure('ipc.failure', { context: channel }, error);
      throw error;
    }
  });
}

function isTrustedClipboardPermission(window, webContents, permission, requestingUrl, isMainFrame) {
  return (
    permission === 'clipboard-read'
    && webContents === window.webContents
    && window.webContents.getURL() === APP_RENDERER_URL
    && requestingUrl === APP_RENDERER_URL
    && isMainFrame === true
  );
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

function getCharacterCapabilities(characterId) {
  const tokens = loadTokens(characterId);
  return tokens
    ? security.getEsiCapabilitiesForScopes(tokens.scopes)
    : { tracking: false, fitting: false, implants: false, killmails: false };
}

async function startSso(selectedCapabilities) {
  if (!isSecureStorageAvailable()) {
    throw new Error('Secure credential storage is required before adding a character');
  }

  const capabilities = security.validateEsiCapabilitySelection(selectedCapabilities);
  const scopes = security.getEsiScopesForCapabilities(capabilities);
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(32));
  pendingAuth = { verifier, state, scopes, createdAt: Date.now() };

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  if (scopes.length > 0) params.set('scope', scopes.join(' '));
  const authorizationUrl = `https://login.eveonline.com/v2/oauth/authorize?${params}`;
  if (!security.isAllowedExternalUrl(authorizationUrl)) throw new Error('OAuth destination is not allowed');
  await shell.openExternal(authorizationUrl);
  return true;
}

function sendAuthEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
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
    tokens.scopes = transaction.scopes;

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
    recordDiagnostic('oauth.complete', { source: 'eve-sso' });
    sendAuthEvent('auth:complete', character);
    focusMainWindow();
  } catch (error) {
    recordDiagnosticFailure('oauth.failure', { source: 'eve-sso' }, error);
    sendAuthEvent('auth:error', error instanceof Error ? error.message : 'Sign-in failed');
    focusMainWindow();
  }
}

async function withCharacterCapability(characterId, capability, operation) {
  const id = security.requireInteger(characterId, 'Character ID');
  const capabilities = getCharacterCapabilities(id);
  if (!capabilities[capability]) {
    throw new Error(`Character authorization does not include the ${capability} capability`);
  }
  return tokenCoordinator.runWithToken(id, operation);
}

function registerAppProtocol() {
  const appRoot = app.getAppPath();
  protocol.handle(APP_PROTOCOL_SCHEME, request => {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    const assetPath = resolveAppAssetPath(appRoot, request.url);
    if (!assetPath) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

async function offerRendererRecovery(window, cause) {
  if (rendererRecoveryOpen || appIsQuitting) return;
  rendererRecoveryOpen = true;
  recordDiagnosticWarning('renderer.recovery_offered', { code: cause });
  const options = {
    type: 'error',
    title: 'AbyssLog needs to reload',
    message: 'The application interface stopped unexpectedly.',
    detail: 'Your completed runs are still stored locally. Reload AbyssLog to recover any unfinished run checkpoint.',
    buttons: ['Reload AbyssLog', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };

  try {
    const result = window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 0) {
      app.quit();
      return;
    }
    recordDiagnostic('renderer.recovery_requested', { code: cause });
    if (window && !window.isDestroyed()) {
      await window.loadURL(APP_RENDERER_URL);
    } else {
      await createWindow();
    }
  } catch (error) {
    recordDiagnosticFailure('renderer.recovery_failure', { code: cause }, error);
    dialog.showErrorBox(
      'AbyssLog could not recover',
      'Restart AbyssLog. Your completed runs remain stored locally.'
    );
    app.quit();
  } finally {
    rendererRecoveryOpen = false;
  }
}

async function createWindow() {
  const window = new BrowserWindow({
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
  mainWindow = window;
  let rendererHasLoaded = false;
  recordDiagnostic('window.created', { source: 'main' });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionCheckHandler((webContents, permission, _origin, details) => (
    isTrustedClipboardPermission(
      window,
      webContents,
      permission,
      details.requestingUrl,
      details.isMainFrame
    )
  ));
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedClipboardPermission(
      window,
      webContents,
      permission,
      details.requestingUrl,
      details.isMainFrame
    ));
  });
  window.webContents.on('did-finish-load', () => {
    rendererHasLoaded = true;
    recordDiagnostic('renderer.loaded', { source: 'renderer' });
  });
  window.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || appIsQuitting) return;
    const error = new Error('Renderer load failed');
    error.code = `LOAD_${Math.abs(errorCode)}`;
    recordDiagnosticFailure('renderer.load_failure', { source: 'renderer' }, error);
    if (rendererHasLoaded) void offerRendererRecovery(window, 'load-failed');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (appIsQuitting || details.reason === 'clean-exit') return;
    const error = new Error('Renderer process exited');
    error.code = details.reason;
    recordDiagnosticFailure('renderer.process_gone', { source: 'renderer' }, error);
    void offerRendererRecovery(window, 'process-gone');
  });
  window.on('unresponsive', () => {
    recordDiagnosticWarning('renderer.unresponsive', { source: 'renderer' });
    void offerRendererRecovery(window, 'unresponsive');
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    pendingAuth = null;
  });
  await window.loadURL(APP_RENDERER_URL);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    focusMainWindow();
    const callbackUrl = commandLine.find(arg => arg.startsWith('eveauth-abysslog://'));
    if (callbackUrl) void handleOAuthCallback(callbackUrl);
  });

  app.whenReady().then(async () => {
    try {
      initializeDiagnostics();
    } catch {
      diagnostics = null;
    }
    Menu.setApplicationMenu(null);
    recordDiagnostic('startup.phase', { phase: 'protocol' });
    registerAppProtocol();
    recordDiagnostic('startup.phase', { phase: 'database' });
    db.init();
    migrateLegacyJaniceKey();
    if (!db.getSetting('janice_api_key')) {
      db.hardenSensitiveStorage();
    }
    recordDiagnostic('startup.phase', { phase: 'window' });
    await createWindow();
    recordDiagnostic('startup.complete', { source: 'main' });
    startupComplete = true;
  }).catch(error => {
    recordDiagnosticFailure('startup.failure', { source: 'main' }, error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox('AbyssLog could not start safely', message);
    app.quit();
  });
}

app.on('open-url', (event, callbackUrl) => {
  event.preventDefault();
  void handleOAuthCallback(callbackUrl);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  appIsQuitting = true;
  recordDiagnostic('app.quit', { source: 'main' });
  if (startupComplete && !exitBackupAttempted) {
    exitBackupAttempted = true;
    try {
      if (!db.getSetting('janice_api_key')) {
        db.createExitBackup();
        recordDiagnostic('backup.verified', { source: 'clean-exit' });
      }
    } catch (error) {
      recordDiagnosticFailure('backup.failure', { source: 'clean-exit' }, error);
    }
  }
  db.close();
});

app.on('activate', () => {
  if (mainWindow === null) {
    void createWindow().catch(error => {
      recordDiagnosticFailure('window.reopen_failure', { source: 'main' }, error);
      const message = error instanceof Error ? error.message : 'Unknown startup error';
      dialog.showErrorBox('AbyssLog could not open its window', message);
      app.quit();
    });
  }
});

secureHandle('auth:get-characters', () => db.getCharacters());
secureHandle('auth:has-tokens', characterId => Boolean(loadTokens(characterId)));
secureHandle('auth:get-capabilities', characterId =>
  getCharacterCapabilities(security.requireInteger(characterId, 'Character ID')));
secureHandle('auth:start-sso', selectedCapabilities => startSso(selectedCapabilities));
registerCharacterDeletionHandler({
  secureHandle,
  database: db,
  requireInteger: security.requireInteger,
});

secureHandle('settings:get', key => {
  security.requireString(key, 'Setting key', 64);
  if (!security.PUBLIC_SETTING_KEYS.has(key)) throw new TypeError('Setting is not readable');
  return db.getSetting(key);
});
secureHandle('settings:set', (key, value) => db.setSetting(key, security.validatePublicSetting(key, value)));
secureHandle('settings:get-all', () => getPublicSettings());

secureHandle('loadouts:get', () =>
  loadouts.parseStoredPresets(db.getSetting(LOADOUT_PRESETS_KEY)));
secureHandle('loadouts:save', payload => {
  const data = validateObjectPayload(
    payload,
    'Loadout presets',
    loadouts.MAX_STORED_BYTES + 1024
  );
  if (Object.keys(data).length !== 1 || !Object.hasOwn(data, 'presets')) {
    throw new TypeError('Loadout presets payload is invalid');
  }
  const serialized = loadouts.serializePresets(data.presets);
  db.setSetting(LOADOUT_PRESETS_KEY, serialized);
  recordDiagnostic('loadouts.saved', { presetCount: data.presets.length });
  return loadouts.parseStoredPresets(serialized);
});

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
  withCharacterCapability(characterId, 'tracking', (id, token) => esi.getLocation(id, token)));
secureHandle('esi:get-ship', characterId =>
  withCharacterCapability(characterId, 'tracking', (id, token) => esi.getShip(id, token)));
secureHandle('esi:get-fitting', characterId =>
  withCharacterCapability(characterId, 'fitting', (id, token) => esi.getFitting(id, token)));
secureHandle('esi:get-implants', characterId =>
  withCharacterCapability(characterId, 'implants', (id, token) => esi.getImplants(id, token)));
secureHandle('esi:get-recent-abyss-loss', (characterId, startedAt, endedAt) =>
  withCharacterCapability(characterId, 'killmails', (id, token) =>
    esi.getRecentAbyssLoss(
      id,
      token,
      security.requireInteger(startedAt, 'Run start time'),
      security.requireInteger(endedAt, 'Run end time')
    )));
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
secureHandle('runs:complete-active', runData =>
  db.completeActiveRun(security.validateRunData(validateObjectPayload(runData, 'Run'))));
secureHandle('runs:get-active', characterId => {
  const id = security.requireInteger(characterId, 'Character ID');
  const snapshot = db.getActiveRun(id);
  if (!snapshot) return null;
  try {
    const validated = security.validateActiveRunSnapshot(snapshot);
    if (validated.run.character_id !== id) throw new TypeError('Active run character mismatch');
    return validated;
  } catch {
    db.clearActiveRun(id);
    return null;
  }
});
secureHandle('runs:save-active', snapshot => {
  const validated = security.validateActiveRunSnapshot(
    validateObjectPayload(snapshot, 'Active run')
  );
  return db.saveActiveRun(validated);
});
secureHandle('runs:clear-active', characterId =>
  db.clearActiveRun(security.requireInteger(characterId, 'Character ID')));
secureHandle('runs:get-all', filters =>
  db.getRuns(security.validateRunFilters(
    filters === undefined ? {} : validateObjectPayload(filters, 'Run filters', 4096)
  )));
secureHandle('runs:get-by-id', runId => db.getRunById(security.requireInteger(runId, 'Run ID')));
secureHandle('runs:copy-fitting', runId => {
  const id = security.requireInteger(runId, 'Run ID');
  const run = db.getRunById(id);
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
secureHandle('runs:delete', runId => db.deleteRun(security.requireInteger(runId, 'Run ID')));
secureHandle('runs:get-inventory-baseline', characterId =>
  db.getInventoryBaseline(security.requireInteger(characterId, 'Character ID')));
secureHandle('runs:clear-inventory-baseline', (characterId, runId) =>
  db.clearInventoryBaseline(
    security.requireInteger(characterId, 'Character ID'),
    security.requireInteger(runId, 'Run ID')
  ));
secureHandle('runs:get-stats', filters =>
  db.getStats(security.validateStatsFilters(
    filters === undefined ? {} : validateObjectPayload(filters, 'Statistics filters', 4096)
  )));
secureHandle('runs:update-appraisal', (runId, data) =>
  db.updateAppraisal(
    security.requireInteger(runId, 'Run ID'),
    security.validateAppraisalUpdate(validateObjectPayload(data, 'Appraisal update'))
  ));
secureHandle('runs:update', (runId, data) =>
  db.updateRun(
    security.requireInteger(runId, 'Run ID'),
    security.validateRunEdit(validateObjectPayload(data, 'Run edit'))
  ));
secureHandle('runs:get-daily-stats', filters =>
  db.getDailyStats(security.validateStatsFilters(
    filters === undefined ? {} : validateObjectPayload(filters, 'Statistics filters', 4096)
  )));

secureHandle('data:get-status', () => ({
  ...db.getDataStatus(),
  automaticBackupsEnabled: !db.getSetting('janice_api_key'),
}));
secureHandle('data:create-backup', () => {
  if (db.getSetting('janice_api_key')) {
    throw new Error('Backup is unavailable until the legacy API key can be migrated securely');
  }
  const result = db.createManualBackup();
  recordDiagnostic('backup.created', { source: 'manual' });
  return result;
});
secureHandle('data:restore-backup', async () => {
  const { backupDirectory } = db.getDataStatus();
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Full Backup',
    defaultPath: backupDirectory,
    buttonLabel: 'Select Backup',
    filters: [{ name: 'AbyssLog Database Backups', extensions: ['db'] }],
    properties: ['openFile', 'dontAddToRecent'],
  });
  if (canceled || !filePaths.length) return { success: false, canceled: true };

  const inspection = db.inspectBackup(filePaths[0]);
  const characterLabel = inspection.characterCount === 1 ? 'character' : 'characters';
  const runLabel = inspection.runCount === 1 ? 'run' : 'runs';
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Restore Full Backup',
    message: 'Replace the current AbyssLog data with this backup?',
    detail:
      `The backup contains ${inspection.characterCount} ${characterLabel} and `
      + `${inspection.runCount} ${runLabel}. AbyssLog will first preserve the current `
      + 'database as a before-restore backup, then restart.\n\n'
      + 'Credentials encrypted on another operating-system installation may not be '
      + 'recoverable; affected characters and the Janice API key will need to be reconnected.',
    buttons: ['Cancel', 'Restore and Restart'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirmation.response !== 1) return { success: false, canceled: true };

  const result = db.restoreBackup(filePaths[0]);
  recordDiagnostic('backup.restored', {
    source: 'manual',
    schemaVersion: result.schemaVersion,
    characterCount: result.characterCount,
    runCount: result.runCount,
  });
  restoreRestartScheduled = true;
  setTimeout(() => {
    app.relaunch();
    app.quit();
  }, 500);
  return { success: true, restarting: true };
});
secureHandle('data:open-backup-folder', async () => {
  const { backupDirectory } = db.getDataStatus();
  const error = await shell.openPath(backupDirectory);
  if (error) throw new Error(`Could not open backup folder: ${error}`);
  return true;
});

secureHandle('diagnostics:get-status', () => {
  if (!diagnostics) return { available: false };
  return { available: true, ...diagnostics.getStatus() };
});
secureHandle('diagnostics:open-folder', async () => {
  if (!diagnostics) throw new Error('Diagnostics are unavailable');
  const error = await shell.openPath(diagnostics.getStatus().directory);
  if (error) throw new Error(`Could not open diagnostics folder: ${error}`);
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
