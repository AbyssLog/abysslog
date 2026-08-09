const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function removeAddedProcessListeners(event, originalListeners) {
  for (const listener of process.listeners(event)) {
    if (!originalListeners.includes(listener)) process.removeListener(event, listener);
  }
}

test('main process registers guarded handlers and lifecycle events when another instance owns the lock', async () => {
  const mainPath = require.resolve('../src/main/main');
  const originalLoad = Module._load;
  const originalUncaughtListeners = process.listeners('uncaughtExceptionMonitor');
  const originalRejectionListeners = process.listeners('unhandledRejection');
  const handlers = new Map();
  const appEvents = new Map();
  const calls = {
    close: 0,
    protocolRegistration: null,
    protocolClient: [],
    quit: 0,
  };

  const database = new Proxy({
    close: () => { calls.close++; },
  }, {
    get: (target, property) => target[property] || (() => null),
  });
  const electron = {
    app: {
      on: (event, handler) => appEvents.set(event, handler),
      quit: () => { calls.quit++; },
      requestSingleInstanceLock: () => false,
      setAsDefaultProtocolClient: (...args) => {
        calls.protocolClient.push(args);
        return true;
      },
    },
    BrowserWindow: class {},
    clipboard: {},
    dialog: {},
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    Menu: {},
    net: { fetch: async () => { throw new Error('Unexpected network request'); } },
    protocol: {
      registerSchemesAsPrivileged: schemes => { calls.protocolRegistration = schemes; },
    },
    safeStorage: {},
    shell: {},
  };

  delete require.cache[mainPath];
  try {
    Module._load = function loadWithMainMocks(request, parent, isMain) {
      if (request === 'electron') return electron;
      if (request === './database' && parent?.filename === mainPath) return database;
      return originalLoad.call(this, request, parent, isMain);
    };
    require(mainPath);

    assert.equal(calls.quit, 1);
    assert.equal(calls.protocolClient.length, 1);
    assert.equal(calls.protocolRegistration[0].scheme, 'abysslog-app');
    assert.ok(handlers.has('auth:delete-character'));
    assert.ok(appEvents.has('before-quit'));

    await assert.rejects(
      handlers.get('auth:delete-character')({ sender: null, senderFrame: null }, 1001),
      /Unauthorized IPC sender/
    );

    appEvents.get('before-quit')();
    assert.equal(calls.close, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[mainPath];
    removeAddedProcessListeners('uncaughtExceptionMonitor', originalUncaughtListeners);
    removeAddedProcessListeners('unhandledRejection', originalRejectionListeners);
  }
});

test('preload bridge invokes character deletion and cleans up auth listeners', async () => {
  const preloadPath = require.resolve('../src/main/preload');
  const originalLoad = Module._load;
  const invokes = [];
  const listeners = [];
  const removedListeners = [];
  let exposedApi;

  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        assert.equal(name, 'api');
        exposedApi = api;
      },
    },
    ipcRenderer: {
      invoke: async (...args) => {
        invokes.push(args);
        return true;
      },
      on: (...args) => listeners.push(args),
      removeListener: (...args) => removedListeners.push(args),
    },
  };

  delete require.cache[preloadPath];
  try {
    Module._load = function loadWithPreloadMock(request, parent, isMain) {
      if (request === 'electron') return electron;
      return originalLoad.call(this, request, parent, isMain);
    };
    require(preloadPath);

    assert.equal(await exposedApi.auth.deleteCharacter(1001), true);
    assert.deepEqual(invokes, [['auth:delete-character', 1001]]);

    const callback = () => {};
    const unsubscribe = exposedApi.auth.onComplete(callback);
    assert.equal(listeners[0][0], 'auth:complete');
    listeners[0][1]({}, { id: 1001 });
    unsubscribe();
    assert.deepEqual(removedListeners[0], ['auth:complete', listeners[0][1]]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[preloadPath];
  }
});
