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
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  APP_PROTOCOL_SCHEME,
  APP_RENDERER_URL,
  resolveAppAssetPath,
} = require('./app-protocol');
const { registerAuthSettingsHandlers } = require('./ipc/auth-settings-handlers');
const { registerExternalServiceHandlers } = require('./ipc/external-service-handlers');
const { registerRunHandlers } = require('./ipc/run-handlers');
const { registerSupportHandlers } = require('./ipc/support-handlers');
const db = require('./database');
const { createDiagnostics } = require('./diagnostics');
const esi = require('./esi');
const { JANICE_SECRET_KEY, createCredentialService } = require('./credential-service');
const { createIpcGuard } = require('./ipc-guard');
const janice = require('./janice');
const { createUpdateService } = require('./update-service');
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
// Secret formats and keys are owned by credential-service.js.
const MAX_IPC_JSON_BYTES = 2 * 1024 * 1024;

const credentialService = createCredentialService({
  safeStorage,
  database: db,
  security,
  legacyOAuthScopes: LEGACY_OAUTH_SCOPES,
});

let mainWindow;
let pendingAuth = null;
let diagnostics = null;
let rendererRecoveryOpen = false;
let appIsQuitting = false;
let startupComplete = false;
let exitBackupAttempted = false;
let restoreRestartScheduled = false;
const updateService = createUpdateService();
const ipcGuard = createIpcGuard({
  ipcMain,
  security,
  getMainWindow: () => mainWindow,
  isBlocked: () => restoreRestartScheduled,
  recordFailure: (...args) => recordDiagnosticFailure(...args),
  maxJsonBytes: MAX_IPC_JSON_BYTES,
});

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

// Credential encryption and token persistence are owned by credentialService.

const tokenCoordinator = runTracking.createTokenCoordinator({
  loadTokens: credentialService.loadTokens,
  saveTokens: credentialService.saveTokens,
  clearTokens: credentialService.clearTokens,
  refreshTokens: refreshToken => esi.refreshToken(refreshToken, CLIENT_ID),
  validateAccessToken: token =>
    security.requireString(token, 'Access token', 16 * 1024),
  validateLifetime: lifetime =>
    security.requireInteger(lifetime, 'Token lifetime', { min: 1, max: 86_400 }),
});

// Janice credential migration and access are owned by credentialService.
function getPublicSettings() {
  const settings = {};
  for (const key of security.PUBLIC_SETTING_KEYS) {
    const value = db.getSetting(key);
    if (value !== null) settings[key] = value;
  }
  return settings;
}

// Sender validation and guarded handler registration are owned by ipcGuard.
function isTrustedClipboardPermission(window, webContents, permission, requestingUrl, isMainFrame) {
  return (
    permission === 'clipboard-read'
    && webContents === window.webContents
    && window.webContents.getURL() === APP_RENDERER_URL
    && requestingUrl === APP_RENDERER_URL
    && isMainFrame === true
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getCharacterCapabilities(characterId) {
  const tokens = credentialService.loadTokens(characterId);
  return tokens
    ? security.getEsiCapabilitiesForScopes(tokens.scopes)
    : { tracking: false, fitting: false, implants: false, killmails: false };
}

async function startSso(selectedCapabilities) {
  if (!credentialService.isSecureStorageAvailable()) {
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
    credentialService.saveTokens(characterId, tokens);
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
    credentialService.migrateLegacyJaniceKey();
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

function scheduleRestoreRestart() {
  restoreRestartScheduled = true;
  setTimeout(() => {
    app.relaunch();
    app.quit();
  }, 500);
}

registerAuthSettingsHandlers({
  secureHandle: ipcGuard.secureHandle,
  database: db,
  security,
  loadTokens: credentialService.loadTokens,
  getCharacterCapabilities,
  startSso,
  getPublicSettings,
  validateObjectPayload: ipcGuard.validateObjectPayload,
  getSecureStorageStatus: credentialService.getSecureStorageStatus,
  getJaniceApiKey: credentialService.getJaniceApiKey,
  janiceSecretKey: JANICE_SECRET_KEY,
  encryptSecret: credentialService.encryptSecret,
  recordDiagnostic,
});

registerExternalServiceHandlers({
  secureHandle: ipcGuard.secureHandle,
  security,
  withCharacterCapability,
  esi,
  janice,
  getJaniceApiKey: credentialService.getJaniceApiKey,
});

registerRunHandlers({
  secureHandle: ipcGuard.secureHandle,
  database: db,
  security,
  validateObjectPayload: ipcGuard.validateObjectPayload,
  validateOptionalCharacterId: ipcGuard.validateOptionalCharacterId,
  clipboard,
  dialog,
  getMainWindow: () => mainWindow,
  recordDiagnostic,
});

registerSupportHandlers({
  secureHandle: ipcGuard.secureHandle,
  database: db,
  security,
  dialog,
  shell,
  clipboard,
  app,
  updateService,
  getMainWindow: () => mainWindow,
  getDiagnostics: () => diagnostics,
  createDiagnosticsSummary,
  recordDiagnostic,
  recordDiagnosticWarning,
  recordDiagnosticFailure,
  scheduleRestoreRestart,
});