const crypto = require('node:crypto');

const DEFAULT_AUTHORIZATION_LIFETIME_MS = 10 * 60 * 1000;

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createOAuthService({
  clientId,
  redirectUri,
  security,
  esi,
  credentials,
  database,
  openExternal,
  onComplete,
  onFailure,
  now = Date.now,
  authorizationLifetimeMs = DEFAULT_AUTHORIZATION_LIFETIME_MS,
  cryptoProvider = crypto,
}) {
  if (!clientId || !redirectUri || !security || !esi || !credentials || !database) {
    throw new TypeError('OAuth service requires identity, security, ESI, credentials, and database');
  }
  for (const dependency of [openExternal, onComplete, onFailure, now]) {
    if (typeof dependency !== 'function') {
      throw new TypeError('OAuth service callbacks must be functions');
    }
  }
  if (!Number.isSafeInteger(authorizationLifetimeMs) || authorizationLifetimeMs <= 0) {
    throw new TypeError('OAuth authorization lifetime is invalid');
  }

  let pendingAuthorization = null;

  function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    return leftBuffer.length === rightBuffer.length
      && cryptoProvider.timingSafeEqual(leftBuffer, rightBuffer);
  }

  function clearPending() {
    pendingAuthorization = null;
  }

  function getCharacterCapabilities(characterId) {
    const tokens = credentials.loadTokens(characterId);
    return tokens
      ? security.getEsiCapabilitiesForScopes(tokens.scopes)
      : { tracking: false, fitting: false, implants: false, killmails: false };
  }

  async function start(selectedCapabilities) {
    if (!credentials.isSecureStorageAvailable()) {
      throw new Error('Secure credential storage is required before adding a character');
    }
    const capabilities = security.validateEsiCapabilitySelection(selectedCapabilities);
    const scopes = security.getEsiScopesForCapabilities(capabilities);
    const verifier = base64Url(cryptoProvider.randomBytes(32));
    const challenge = base64Url(
      cryptoProvider.createHash('sha256').update(verifier).digest()
    );
    const state = base64Url(cryptoProvider.randomBytes(32));
    pendingAuthorization = { verifier, state, scopes, createdAt: now() };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    if (scopes.length) params.set('scope', scopes.join(' '));
    const authorizationUrl = `https://login.eveonline.com/v2/oauth/authorize?${params}`;
    if (!security.isAllowedExternalUrl(authorizationUrl)) {
      clearPending();
      throw new Error('OAuth destination is not allowed');
    }
    try {
      await openExternal(authorizationUrl);
    } catch (error) {
      clearPending();
      throw error;
    }
    return true;
  }

  async function handleCallback(callbackUrl) {
    try {
      const callback = security.parseOAuthCallback(callbackUrl);
      const transaction = pendingAuthorization;
      if (!transaction || now() - transaction.createdAt > authorizationLifetimeMs) {
        clearPending();
        throw new Error('No active or valid sign-in request');
      }
      if (!safeEqual(callback.state, transaction.state)) {
        throw new Error('OAuth state validation failed');
      }
      clearPending();
      if (callback.error) throw new Error(callback.errorDescription);

      const tokens = await esi.exchangeAuthorizationCode(
        callback.code,
        clientId,
        transaction.verifier,
        redirectUri
      );
      tokens.expires_at = now() + security.requireInteger(
        tokens.expires_in,
        'Token lifetime',
        { min: 1, max: 86_400 }
      ) * 1000;
      tokens.scopes = transaction.scopes;

      const accessToken = security.requireString(tokens.access_token, 'Access token', 16 * 1024);
      const characterInfo = await esi.verifyToken(accessToken);
      const characterId = security.requireInteger(characterInfo.CharacterID, 'Character ID');
      const characterName = security.requireString(
        characterInfo.CharacterName,
        'Character name',
        128
      );
      const character = {
        id: characterId,
        name: characterName,
        portrait_url: `https://images.evetech.net/characters/${characterId}/portrait?size=64`,
        client_id: clientId,
      };
      database.saveCharacter(character);
      credentials.saveTokens(characterId, tokens);
      await onComplete(character);
      return { success: true, character };
    } catch (error) {
      await onFailure(error);
      return { success: false, error };
    }
  }

  return Object.freeze({
    clearPending,
    getCharacterCapabilities,
    handleCallback,
    start,
  });
}

module.exports = {
  DEFAULT_AUTHORIZATION_LIFETIME_MS,
  base64Url,
  createOAuthService,
};
