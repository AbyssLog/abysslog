const assert = require('node:assert/strict');
const test = require('node:test');

const { createIpcGuard } = require('../src/main/ipc-guard');
const security = require('../src/shared/security');

test('IPC guard validates sender identity, payload bounds, and blocked lifecycle state', async () => {
  let registered;
  let blocked = false;
  const failures = [];
  const webContents = {
    mainFrame: { url: 'abysslog-app://bundle/index.html' },
    getURL: () => 'abysslog-app://bundle/index.html',
  };
  const guard = createIpcGuard({
    ipcMain: { handle: (channel, handler) => { registered = { channel, handler }; } },
    security,
    getMainWindow: () => ({ isDestroyed: () => false, webContents }),
    isBlocked: () => blocked,
    recordFailure: (...args) => failures.push(args),
    maxJsonBytes: 32,
  });
  guard.secureHandle('test:channel', payload => payload.value);
  const event = { sender: webContents, senderFrame: webContents.mainFrame };

  assert.equal(registered.channel, 'test:channel');
  assert.equal(await registered.handler(event, { value: 42 }), 42);
  await assert.rejects(
    registered.handler({ sender: {}, senderFrame: {} }, { value: 42 }),
    /Unauthorized/
  );
  assert.equal(failures[0][0], 'ipc.rejected');

  blocked = true;
  await assert.rejects(registered.handler(event, { value: 42 }), /restarting/);
  assert.throws(() => guard.validateObjectPayload({ value: 'x'.repeat(40) }, 'Payload'), /too large/);
  assert.equal(guard.validateOptionalCharacterId('9001'), 9001);
});
