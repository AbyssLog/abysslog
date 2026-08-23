const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JANICE_CREDENTIAL_KIND,
  OAUTH_CREDENTIAL_KIND,
  createCredentialService,
} = require('../src/main/credential-service');
const security = require('../src/shared/security');

function createHarness({ available = true, backend = 'secret-service' } = {}) {
  const credentials = new Map();
  const credentialKey = (kind, characterId) => kind + ':' + (characterId ?? 'global');
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: value => Buffer.from('encrypted:' + value),
    decryptString: value => value.toString().replace(/^encrypted:/, ''),
  };
  const database = {
    getCredential: (kind, characterId) =>
      credentials.get(credentialKey(kind, characterId)) ?? null,
    setCredential: (kind, characterId, value) => {
      const key = credentialKey(kind, characterId);
      credentials.set(key, value);
      return true;
    },
    deleteCredential: (kind, characterId) =>
      credentials.delete(credentialKey(kind, characterId)),
  };
  const service = createCredentialService({
    safeStorage,
    database,
    security,
    platform: 'linux',
  });
  return { credentialKey, credentials, service };
}

test('credential service encrypts and validates dedicated token persistence', () => {
  const { credentialKey, credentials, service } = createHarness();
  service.saveTokens(9001, {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: Date.now() + 60_000,
    scopes: ['esi-location.read_location.v1'],
  });

  assert.match(credentials.get(credentialKey(OAUTH_CREDENTIAL_KIND, 9001)), /^safe:v1:/);
  assert.deepEqual(service.loadTokens(9001).scopes, ['esi-location.read_location.v1']);
  assert.equal('ignored' in service.loadTokens(9001), false);
  assert.throws(() => service.saveTokens(9002, {
    access_token: 'expired-access',
    refresh_token: 'expired-refresh',
    expires_at: Date.now() - 120_000,
    scopes: [],
  }), /Token expiry/);
  assert.equal(service.clearTokens(9001), true);
  assert.equal(service.loadTokens(9001), null);
});

test('credential service requires the current token contract and handles Janice keys', () => {
  const { service } = createHarness();
  assert.throws(
    () => service.saveTokens(9001, {
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: Date.now() + 60_000,
    }),
    /ESI scopes/
  );

  service.saveJaniceApiKey('current-key');
  assert.equal(service.getJaniceApiKey(), 'current-key');
  assert.equal(service.deleteJaniceApiKey(), true);
  assert.equal(service.getJaniceApiKey(), null);
});

test('credential service rejects writes when secure storage is unavailable', () => {
  const insecure = createHarness({ backend: 'basic_text' });
  assert.throws(
    () => insecure.service.saveJaniceApiKey('not-stored'),
    /unavailable/
  );
  assert.equal(insecure.service.getSecureStorageStatus().available, false);
});
