const SECRET_PREFIX = 'safe:v1:';
const OAUTH_CREDENTIAL_KIND = 'oauth';
const JANICE_CREDENTIAL_KIND = 'janice';

function createCredentialService({
  safeStorage,
  database,
  security,
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
    if (!stored || !stored.startsWith(SECRET_PREFIX) || !isSecureStorageAvailable()) return null;
    try {
      return safeStorage.decryptString(
        Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64')
      );
    } catch {
      return null;
    }
  }

  function normalizeTokens(tokens, { allowExpired = false } = {}) {
    if (!security.isPlainObject(tokens)) throw new TypeError('OAuth token response is invalid');
    return {
      access_token: security.requireString(tokens.access_token, 'Access token', 16 * 1024),
      refresh_token: security.requireString(tokens.refresh_token, 'Refresh token', 16 * 1024),
      expires_at: security.requireInteger(tokens.expires_at, 'Token expiry', {
        min: allowExpired ? 0 : Date.now() - 60_000,
        max: Number.MAX_SAFE_INTEGER,
      }),
      scopes: security.validateEsiScopes(tokens.scopes),
    };
  }

  function saveTokens(characterId, tokens) {
    const safeCharacterId = security.requireInteger(characterId, 'Character ID');
    const safeTokens = normalizeTokens(tokens);
    database.setCredential(
      OAUTH_CREDENTIAL_KIND,
      safeCharacterId,
      encryptSecret(JSON.stringify(safeTokens))
    );
  }

  function loadTokens(characterId) {
    const safeCharacterId = security.requireInteger(characterId, 'Character ID');
    const json = decryptSecret(database.getCredential(OAUTH_CREDENTIAL_KIND, safeCharacterId));
    if (!json) return null;
    try {
      return normalizeTokens(JSON.parse(json), { allowExpired: true });
    } catch {
      return null;
    }
  }

  function clearTokens(characterId) {
    const safeCharacterId = security.requireInteger(characterId, 'Character ID');
    return database.deleteCredential(OAUTH_CREDENTIAL_KIND, safeCharacterId);
  }

  function saveJaniceApiKey(apiKey) {
    const key = security.requireTrimmedText(apiKey, 'Janice API key', 4096);
    return database.setCredential(JANICE_CREDENTIAL_KIND, null, encryptSecret(key));
  }

  function deleteJaniceApiKey() {
    return database.deleteCredential(JANICE_CREDENTIAL_KIND, null);
  }

  function getJaniceApiKey() {
    return decryptSecret(database.getCredential(JANICE_CREDENTIAL_KIND, null));
  }

  return Object.freeze({
    clearTokens,
    deleteJaniceApiKey,
    encryptSecret,
    getJaniceApiKey,
    getSecureStorageStatus,
    isSecureStorageAvailable,
    loadTokens,
    saveJaniceApiKey,
    saveTokens,
  });
}

module.exports = {
  JANICE_CREDENTIAL_KIND,
  OAUTH_CREDENTIAL_KIND,
  SECRET_PREFIX,
  createCredentialService,
};
