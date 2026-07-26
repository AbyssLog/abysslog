'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  APP_RENDERER_URL,
  resolveAppAssetPath,
} = require('../src/main/app-protocol');

const appRoot = path.resolve('virtual', 'app.asar');

test('application protocol resolves only packaged renderer and image assets', () => {
  assert.equal(
    resolveAppAssetPath(appRoot, APP_RENDERER_URL),
    path.join(appRoot, 'src', 'renderer', 'index.html')
  );
  assert.equal(
    resolveAppAssetPath(appRoot, 'abysslog-app://bundle/src/shared/security.js'),
    path.join(appRoot, 'src', 'shared', 'security.js')
  );
  assert.equal(
    resolveAppAssetPath(appRoot, 'abysslog-app://bundle/assets/logo.png'),
    path.join(appRoot, 'assets', 'logo.png')
  );
});

test('application protocol rejects other origins and traversal attempts', () => {
  for (const url of [
    'https://bundle/src/renderer/index.html',
    'abysslog-app://other/src/renderer/index.html',
    'abysslog-app://bundle/src/main/main.js',
    'abysslog-app://bundle/node_modules/better-sqlite3/index.js',
    'abysslog-app://bundle/src/renderer/%2e%2e%5cmain%5cmain.js',
    'abysslog-app://bundle/assets/%00logo.png',
    'not a url',
  ]) {
    assert.equal(resolveAppAssetPath(appRoot, url), null, url);
  }
});
