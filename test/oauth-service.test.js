const assert = require('node:assert/strict');
const test = require('node:test');

const { createOAuthService } = require('../src/main/oauth-service');
const security = require('../src/shared/security');

function createHarness({ secureStorage = true, startTime = 1_800_000_000_000 } = {}) {
  let currentTime = startTime;
  let authorizationUrl = null;
  const savedCharacters = [];
  const savedTokens = [];
  const completed = [];
  const failures = [];
  const storedTokens = new Map();
  const exchanges = [];
  const service = createOAuthService({
    clientId: 'public-client-id',
    redirectUri: 'eveauth-abysslog://callback',
    security,
    esi: {
      exchangeAuthorizationCode: async (code, clientId, verifier, redirectUri) => {
        exchanges.push({ code, clientId, verifier, redirectUri });
        return { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 1200 };
      },
      verifyToken: async () => ({ CharacterID: 9001, CharacterName: 'OAuth Pilot' }),
    },
    credentials: {
      isSecureStorageAvailable: () => secureStorage,
      loadTokens: characterId => storedTokens.get(characterId) || null,
      saveTokens: (characterId, tokens) => {
        storedTokens.set(characterId, tokens);
        savedTokens.push([characterId, { ...tokens }]);
      },
    },
    database: { saveCharacter: character => savedCharacters.push({ ...character }) },
    openExternal: async url => { authorizationUrl = url; },
    onComplete: async character => completed.push(character),
    onFailure: async error => failures.push(error),
    now: () => currentTime,
  });
  return {
    advance: milliseconds => { currentTime += milliseconds; },
    completed,
    exchanges,
    failures,
    getAuthorizationUrl: () => authorizationUrl,
    savedCharacters,
    savedTokens,
    service,
    storedTokens,
  };
}

function callbackFor(authorizationUrl, parameters = {}) {
  const state = new URL(authorizationUrl).searchParams.get('state');
  const query = new URLSearchParams({ code: 'authorization-code', state, ...parameters });
  return `eveauth-abysslog://callback?${query}`;
}

test('OAuth service owns PKCE completion and current credential persistence', async () => {
  const harness = createHarness();
  await harness.service.start(['tracking', 'implants']);
  const authorizationUrl = harness.getAuthorizationUrl();
  const parsed = new URL(authorizationUrl);
  assert.equal(parsed.origin, 'https://login.eveonline.com');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(parsed.searchParams.get('code_challenge'));
  assert.match(parsed.searchParams.get('scope'), /esi-location\.read_location\.v1/);
  assert.match(parsed.searchParams.get('scope'), /esi-clones\.read_implants\.v1/);

  const result = await harness.service.handleCallback(callbackFor(authorizationUrl));
  assert.equal(result.success, true);
  assert.equal(harness.exchanges.length, 1);
  assert.equal(harness.savedCharacters[0].name, 'OAuth Pilot');
  assert.equal(harness.savedTokens[0][0], 9001);
  assert.deepEqual(harness.savedTokens[0][1].scopes.sort(), [
    'esi-clones.read_implants.v1',
    'esi-location.read_location.v1',
    'esi-location.read_ship_type.v1',
  ].sort());
  assert.equal(harness.completed.length, 1);
  assert.equal(harness.failures.length, 0);

  const duplicate = await harness.service.handleCallback(callbackFor(authorizationUrl));
  assert.equal(duplicate.success, false);
  assert.match(duplicate.error.message, /No active or valid sign-in request/);
});

test('OAuth service preserves a valid transaction after a mismatched callback', async () => {
  const harness = createHarness();
  await harness.service.start(['tracking']);
  const authorizationUrl = harness.getAuthorizationUrl();
  const mismatch = await harness.service.handleCallback(
    callbackFor(authorizationUrl, { state: 'mismatched-state' })
  );
  assert.equal(mismatch.success, false);
  assert.match(mismatch.error.message, /state validation failed/);
  assert.equal(harness.exchanges.length, 0);

  const completed = await harness.service.handleCallback(callbackFor(authorizationUrl));
  assert.equal(completed.success, true);
  assert.equal(harness.exchanges.length, 1);
});

test('OAuth service expires requests and reports denied authorization', async () => {
  const expired = createHarness();
  await expired.service.start([]);
  const expiredUrl = expired.getAuthorizationUrl();
  expired.advance(10 * 60 * 1000 + 1);
  const expiredResult = await expired.service.handleCallback(callbackFor(expiredUrl));
  assert.equal(expiredResult.success, false);
  assert.match(expiredResult.error.message, /No active or valid sign-in request/);

  const denied = createHarness();
  await denied.service.start([]);
  const deniedResult = await denied.service.handleCallback(callbackFor(
    denied.getAuthorizationUrl(),
    { code: '', error: 'access_denied', error_description: 'Authorization declined' }
  ));
  assert.equal(deniedResult.success, false);
  assert.match(deniedResult.error.message, /Authorization declined/);
});

test('OAuth service derives capabilities and requires secure storage', async () => {
  const unavailable = createHarness({ secureStorage: false });
  await assert.rejects(unavailable.service.start([]), /Secure credential storage/);

  const harness = createHarness();
  assert.deepEqual(harness.service.getCharacterCapabilities(9001), {
    tracking: false, fitting: false, implants: false, killmails: false,
  });
  harness.storedTokens.set(9001, { scopes: ['esi-clones.read_implants.v1'] });
  assert.deepEqual(harness.service.getCharacterCapabilities(9001), {
    tracking: false, fitting: false, implants: true, killmails: false,
  });
});
