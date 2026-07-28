const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isRendererInitialized,
  parsePort,
} = require('../scripts/verify-packaged-renderer');

function healthyRenderer(readyState) {
  return {
    readyState,
    url: 'abysslog-app://bundle/src/renderer/index.html',
    title: 'AbyssLog',
    bodyText: 'ABYSSLOG',
    activePage: 'page-tracker',
    hasApiBridge: true,
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
});

test('packaged renderer verifier accepts only a valid local debugging port', () => {
  assert.equal(parsePort('9222'), 9222);
  assert.throws(() => parsePort('0'), /valid DevTools port/);
  assert.throws(() => parsePort('not-a-port'), /valid DevTools port/);
});

test('Windows package smoke test requires local diagnostics readiness', () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'smoke-test-windows-package.ps1'),
    'utf8'
  );

  assert.match(script, /logs\\abysslog\.log/);
  assert.match(script, /\$diagnosticsReady/);
  assert.match(script, /-and \$diagnosticsReady/);
});
