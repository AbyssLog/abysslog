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
  const migratedCredentials = new Set();
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
      migratedCredentials.delete(key);
      return true;
    },
    deleteCredential: (kind, characterId) =>
      credentials.delete(credentialKey(kind, characterId)),
    listCredentialsNeedingNormalization: () => [...migratedCredentials].map(key => {
      const [kind, character] = key.split(':');
      return {
        kind,
        character_id: character === 'global' ? null : Number(character),
        ciphertext: credentials.get(key),
      };
    }),
  };
  const service = createCredentialService({
    safeStorage,
    database,
    security,
    migratedOAuthScopes: ['esi-location.read_location.v1'],
    platform: 'linux',
  });
  function storeMigratedCredential(kind, characterId, ciphertext) {
    const key = credentialKey(kind, characterId);
    credentials.set(key, ciphertext);
    migratedCredentials.add(key);
  }
  return { credentialKey, credentials, service, storeMigratedCredential };
}

function legacyCiphertext(value) {
  return Buffer.from('encrypted:' + value).toString('base64');
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

test('credential service normalizes v4 ciphertext and missing OAuth scopes once', () => {
  const secure = createHarness();
  secure.storeMigratedCredential(
    OAUTH_CREDENTIAL_KIND,
    9001,
    legacyCiphertext(JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: 1,
    }))
  );
  secure.storeMigratedCredential(
    JANICE_CREDENTIAL_KIND,
    null,
    legacyCiphertext('legacy-key')
  );

  assert.equal(secure.service.loadTokens(9001), null);
  assert.equal(secure.service.normalizeMigratedCredentials(), true);
  assert.match(
    secure.credentials.get(secure.credentialKey(OAUTH_CREDENTIAL_KIND, 9001)),
    /^safe:v1:/
  );
  assert.deepEqual(
    secure.service.loadTokens(9001).scopes,
    ['esi-location.read_location.v1']
  );
  assert.equal(secure.service.getJaniceApiKey(), 'legacy-key');
  const normalizedTokens = secure.credentials.get(
    secure.credentialKey(OAUTH_CREDENTIAL_KIND, 9001)
  );
  assert.equal(secure.service.normalizeMigratedCredentials(), true);
  assert.equal(
    secure.credentials.get(secure.credentialKey(OAUTH_CREDENTIAL_KIND, 9001)),
    normalizedTokens
  );

  secure.service.saveJaniceApiKey('replacement-key');
  assert.equal(secure.service.getJaniceApiKey(), 'replacement-key');
  assert.equal(secure.service.deleteJaniceApiKey(), true);
  assert.equal(secure.service.getJaniceApiKey(), null);
});

test('credential normalization preserves migrated ciphertext when secure storage is unavailable', () => {
  const insecure = createHarness({ backend: 'basic_text' });
  const stored = legacyCiphertext('leave-intact');
  insecure.storeMigratedCredential(JANICE_CREDENTIAL_KIND, null, stored);

  assert.equal(insecure.service.normalizeMigratedCredentials(), false);
  assert.equal(
    insecure.credentials.get(insecure.credentialKey(JANICE_CREDENTIAL_KIND, null)),
    stored
  );
  assert.equal(insecure.service.getSecureStorageStatus().available, false);
});
