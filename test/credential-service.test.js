const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JANICE_SECRET_KEY,
  createCredentialService,
} = require('../src/main/credential-service');
const security = require('../src/shared/security');

function createHarness({ available = true, backend = 'secret-service' } = {}) {
  const settings = new Map();
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: value => Buffer.from('encrypted:' + value),
    decryptString: value => value.toString().replace(/^encrypted:/, ''),
  };
  const database = {
    getSetting: key => settings.get(key) ?? null,
    setSetting: (key, value) => {
      settings.set(key, value);
      return true;
    },
    deleteSetting: key => settings.delete(key),
  };
  const service = createCredentialService({
    safeStorage,
    database,
    security,
    legacyOAuthScopes: ['esi-location.read_location.v1'],
    platform: 'linux',
  });
  return { service, settings };
}

test('credential service encrypts and validates token persistence', () => {
  const { service, settings } = createHarness();
  service.saveTokens(9001, {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: Date.now() + 60_000,
    scopes: ['esi-location.read_location.v1'],
  });

  assert.match(settings.get('tokens_9001'), /^safe:v1:/);
  assert.deepEqual(service.loadTokens(9001).scopes, ['esi-location.read_location.v1']);
  assert.equal('ignored' in service.loadTokens(9001), false);
});

test('credential service migrates Janice keys only into secure storage', () => {
  const secure = createHarness();
  secure.settings.set('janice_api_key', 'legacy-key');
  secure.service.migrateLegacyJaniceKey();
  assert.equal(secure.settings.has('janice_api_key'), false);
  assert.match(secure.settings.get(JANICE_SECRET_KEY), /^safe:v1:/);
  assert.equal(secure.service.getJaniceApiKey(), 'legacy-key');

  const insecure = createHarness({ backend: 'basic_text' });
  insecure.settings.set('janice_api_key', 'leave-in-place');
  insecure.service.migrateLegacyJaniceKey();
  assert.equal(insecure.settings.get('janice_api_key'), 'leave-in-place');
  assert.equal(insecure.service.getSecureStorageStatus().available, false);
});
