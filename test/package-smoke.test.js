const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isRendererInitialized,
  parsePort,
  requestCleanRendererClose,
} = require('../scripts/verify-packaged-renderer');

function healthyRenderer(readyState) {
  return {
    readyState,
    url: 'abysslog-app://bundle/src/renderer/index.html',
    title: 'AbyssLog',
    bodyText: 'ABYSSLOG',
    activePage: 'page-tracker',
    hasApiBridge: true,
    hasUpdateHelpers: true,
    aboutVersion: 'Version 1.0.0',
    updateButtonText: 'Check for Updates',
    updateStatus: 'Updates are checked only when requested.',
    topbarImageReady: true,
    errorNoticeHidden: true,
  };
}

test('packaged renderer readiness accepts an initialized interactive document', () => {
  assert.equal(isRendererInitialized(healthyRenderer('interactive')), true);
  assert.equal(isRendererInitialized(healthyRenderer('complete')), true);
  assert.equal(isRendererInitialized(healthyRenderer('loading')), false);
  assert.equal(isRendererInitialized({
    ...healthyRenderer('complete'),
    url: 'chrome-error://chromewebdata/',
  }), false);
  assert.equal(isRendererInitialized({
    ...healthyRenderer('complete'),
    aboutVersion: 'Version …',
  }), false);
  assert.equal(isRendererInitialized({
    ...healthyRenderer('complete'),
    topbarImageReady: false,
  }), false);
});

test('packaged renderer verifier accepts only a valid local debugging port', () => {
  assert.equal(parsePort('9222'), 9222);
  assert.throws(() => parsePort('0'), /valid DevTools port/);
  assert.throws(() => parsePort('not-a-port'), /valid DevTools port/);
});

test('packaged renderer verifier requests a clean window close', async () => {
  const nativeWebSocket = globalThis.WebSocket;
  let request = null;

  class FakeWebSocket {
    constructor() {
      this.listeners = new Map();
      queueMicrotask(() => this.listeners.get('open')?.());
    }

    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }

    send(serialized) {
      request = JSON.parse(serialized);
      queueMicrotask(() => this.listeners.get('message')?.({
        data: JSON.stringify({
          id: request.id,
          result: { result: { value: true } },
        }),
      }));
    }

    close() {}
  }

  globalThis.WebSocket = FakeWebSocket;
  try {
    await requestCleanRendererClose({ webSocketDebuggerUrl: 'ws://renderer.test' });
  } finally {
    globalThis.WebSocket = nativeWebSocket;
  }

  assert.equal(request.method, 'Runtime.evaluate');
  assert.equal(request.params.returnByValue, true);
  assert.match(request.params.expression, /window\.close\(\)/);
});

test('Windows package smoke test verifies startup before backup-on-exit', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'smoke-test-windows-package.ps1'),
    'utf8'
  );

  assert.match(script, /logs\\abysslog\.log/);
  assert.match(script, /\$diagnosticsReady/);
  assert.match(script, /-and \$diagnosticsReady/);
  const startupCheck = script.match(
    /\$startupReady = \$databaseReady[\s\S]*?-and \$processCount -ge 2/
  );
  assert.ok(startupCheck, 'startup readiness assignment was not found');
  assert.doesNotMatch(startupCheck[0], /\$backupReady/);

  const rendererClose = script.indexOf("'--close-after-verify'");
  const backupCheck = script.indexOf('$backupReady =', rendererClose);
  assert.ok(rendererClose > 0, 'renderer close request was not found');
  assert.ok(backupCheck > rendererClose, 'backup must be checked after the renderer closes');
  assert.match(script, /did not create an automatic backup on clean exit/);
});
