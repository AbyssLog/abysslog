const SECRET_PREFIX = 'safe:v1:';
const JANICE_SECRET_KEY = 'secret_janice_api_key';

function createCredentialService({
  safeStorage,
  database,
  security,
  legacyOAuthScopes = [],
  platform = process.platform,
}) {
  if (!safeStorage || !database || !security) {
    throw new TypeError('Credential service requires storage, database, and validation');
  }

  function isSecureStorageAvailable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (
      platform === 'linux'
      && typeof safeStorage.getSelectedStorageBackend === 'function'
      && safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      return false;
    }
    return true;
  }

  function getSecureStorageStatus() {
    let backend = platform;
    if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      backend = safeStorage.getSelectedStorageBackend();
    }
    return { available: isSecureStorageAvailable(), backend };
  }

  function encryptSecret(value) {
    if (!isSecureStorageAvailable()) {
      throw new Error('Secure credential storage is unavailable on this system');
    }
    const encrypted = safeStorage.encryptString(
      security.requireString(value, 'Secret', 64 * 1024)
    );
    return SECRET_PREFIX + encrypted.toString('base64');
  }

  function decryptSecret(stored) {
    if (!stored || !isSecureStorageAvailable()) return null;
    try {
      const encoded = stored.startsWith(SECRET_PREFIX)
        ? stored.slice(SECRET_PREFIX.length)
        : stored;
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
    const safeTokens = {
      access_token: security.requireString(tokens.access_token, 'Access token', 16 * 1024),
      refresh_token: security.requireString(tokens.refresh_token, 'Refresh token', 16 * 1024),
      expires_at: security.requireInteger(tokens.expires_at, 'Token expiry', {
        min: Date.now() - 60_000,
        max: Number.MAX_SAFE_INTEGER,
      }),
      scopes: security.validateEsiScopes(tokens.scopes),
    };
    database.setSetting(tokenKey(characterId), encryptSecret(JSON.stringify(safeTokens)));
  }

  function loadTokens(characterId) {
    const json = decryptSecret(database.getSetting(tokenKey(characterId)));
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
        scopes: tokens.scopes == null
          ? [...legacyOAuthScopes]
          : security.validateEsiScopes(tokens.scopes),
      };
    } catch {
      return null;
    }
  }

  function clearTokens(characterId) {
    return database.deleteSetting(tokenKey(characterId));
  }

  function migrateLegacyJaniceKey() {
    const legacyKey = database.getSetting('janice_api_key');
    if (!legacyKey) return;
    if (database.getSetting(JANICE_SECRET_KEY)) {
      database.deleteSetting('janice_api_key');
      return;
    }
    if (!isSecureStorageAvailable()) return;
    database.setSetting(JANICE_SECRET_KEY, encryptSecret(legacyKey));
    database.deleteSetting('janice_api_key');
  }

  function getJaniceApiKey() {
    return decryptSecret(database.getSetting(JANICE_SECRET_KEY));
  }

  return Object.freeze({
    clearTokens,
    decryptSecret,
    encryptSecret,
    getJaniceApiKey,
    getSecureStorageStatus,
    isSecureStorageAvailable,
    loadTokens,
    migrateLegacyJaniceKey,
    saveTokens,
    tokenKey,
  });
}

module.exports = { JANICE_SECRET_KEY, SECRET_PREFIX, createCredentialService };
