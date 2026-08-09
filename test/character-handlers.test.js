const assert = require('node:assert/strict');
const test = require('node:test');

const { registerCharacterDeletionHandler } = require('../src/main/character-handlers');
const security = require('../src/shared/security');

test('character deletion IPC validates input and delegates to the atomic database operation', () => {
  let channel;
  let handler;
  const deleted = [];

  registerCharacterDeletionHandler({
    secureHandle: (registeredChannel, registeredHandler) => {
      channel = registeredChannel;
      handler = registeredHandler;
    },
    database: {
      deleteCharacter: characterId => {
        deleted.push(characterId);
        return true;
      },
    },
    requireInteger: security.requireInteger,
  });

  assert.equal(channel, 'auth:delete-character');
  assert.equal(handler(1001), true);
  assert.equal(handler('1002'), true);
  assert.deepEqual(deleted, [1001, 1002]);
  assert.throws(() => handler('invalid'), /Character ID/);
  assert.deepEqual(deleted, [1001, 1002]);
});
