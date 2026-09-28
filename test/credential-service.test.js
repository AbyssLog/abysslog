const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JANICE_CREDENTIAL_KIND,
  OAUTH_CREDENTIAL_KIND,
  createCredentialService,
} = require('../src/main/credential-service');
const security = require('../src/shared/security');

function createHarness({ available = true, backend = 'secret-service', bundledJaniceApiKey = null } = {}) {
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
    bundledJaniceApiKey,
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
  assert.deepEqual(service.getJaniceKeyStatus(), {
    available: false, source: 'none', hasCustomKey: false,
  });
});

test('credential service rejects writes when secure storage is unavailable', () => {
  const insecure = createHarness({ backend: 'basic_text' });
  assert.throws(
    () => insecure.service.saveJaniceApiKey('not-stored'),
    /unavailable/
  );
  assert.equal(insecure.service.getSecureStorageStatus().available, false);
});

test('bundled Janice key works on a fresh install, personal keys override it, and removal restores it', () => {
  const { service, credentials } = createHarness({ bundledJaniceApiKey: 'bundled-key' });
  assert.equal(service.getJaniceApiKey(), 'bundled-key');
  assert.equal(credentials.size, 0);
  assert.deepEqual(service.getJaniceKeyStatus(), {
    available: true, source: 'bundled', hasCustomKey: false,
  });

  service.saveJaniceApiKey('personal-key');
  assert.equal(service.getJaniceApiKey(), 'personal-key');
  assert.deepEqual(service.getJaniceKeyStatus(), {
    available: true, source: 'custom', hasCustomKey: true,
  });
  service.deleteJaniceApiKey();
  assert.equal(service.getJaniceApiKey(), 'bundled-key');
  assert.deepEqual(service.getJaniceKeyStatus(), {
    available: true, source: 'bundled', hasCustomKey: false,
  });
});

test('bundled Janice key is usable without OS encryption or a decryptable personal key', () => {
  for (const available of [true, false]) {
    const { service, credentials, credentialKey } = createHarness({
      available, bundledJaniceApiKey: 'bundled-key',
    });
    credentials.set(credentialKey(JANICE_CREDENTIAL_KIND, null), 'unreadable-ciphertext');
    assert.equal(service.getJaniceApiKey(), 'bundled-key');
    assert.deepEqual(service.getJaniceKeyStatus(), {
      available: true, source: 'bundled', hasCustomKey: true,
    });
  }
});

test('Janice IPC uses the effective key and returns only status to the renderer', async () => {
  const { registerAuthSettingsHandlers } = require('../src/main/ipc/auth-settings-handlers');
  const { registerExternalServiceHandlers } = require('../src/main/ipc/external-service-handlers');
  const { service } = createHarness({ bundledJaniceApiKey: 'bundled-key' });
  const handlers = new Map();
  const requests = [];
  const secureHandle = (channel, handler) => handlers.set(channel, handler);
  registerAuthSettingsHandlers({ secureHandle, ...service });
  registerExternalServiceHandlers({
    secureHandle, security, getJaniceApiKey: service.getJaniceApiKey,
    janice: { appraise: (...args) => { requests.push(args); return { totalBuyPrice: 1 }; } },
  });
  const appraise = () => handlers.get('janice:appraise')([{ name: 'Tritanium', qty: 1 }], 'buy');
  assert.equal(handlers.get('secrets:has-janice-key')(), true);
  assert.deepEqual(handlers.get('secrets:janice-key-status')(), {
    available: true, source: 'bundled', hasCustomKey: false,
  });
  await appraise();
  handlers.get('secrets:set-janice-key')('personal-key');
  await appraise();
  handlers.get('secrets:delete-janice-key')();
  await appraise();
  assert.deepEqual(requests.map(request => request[2]), ['bundled-key', 'personal-key', 'bundled-key']);
});
