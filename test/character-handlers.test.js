const assert = require('node:assert/strict');
const test = require('node:test');

const { registerAuthSettingsHandlers } = require('../src/main/ipc/auth-settings-handlers');
const security = require('../src/shared/security');

test('character deletion IPC validates input and delegates to the atomic database operation', () => {
  const handlers = new Map();
  const deleted = [];

  registerAuthSettingsHandlers({
    secureHandle: (registeredChannel, registeredHandler) => {
      handlers.set(registeredChannel, registeredHandler);
    },
    database: {
      deleteCharacter: characterId => {
        deleted.push(characterId);
        return true;
      },
    },
    security,
    loadTokens: () => null,
    getCharacterCapabilities: () => ({}),
    startSso: () => {},
    getPublicSettings: () => ({}),
    validateObjectPayload: value => value,
    getSecureStorageStatus: () => ({}),
    getJaniceApiKey: () => null,
    saveJaniceApiKey: () => {},
    deleteJaniceApiKey: () => {},
    recordDiagnostic: () => {},
  });

  const handler = handlers.get('auth:delete-character');
  assert.equal(typeof handler, 'function');
  assert.equal(handler(1001), true);
  assert.equal(handler('1002'), true);
  assert.deepEqual(deleted, [1001, 1002]);
  assert.throws(() => handler('invalid'), /Character ID/);
  assert.deepEqual(deleted, [1001, 1002]);
});
