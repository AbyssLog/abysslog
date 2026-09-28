const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { prepareBundledJaniceKey } = require('../scripts/prepare-bundled-janice');
const { readBundledJaniceKey } = require('../src/main/bundled-janice-key');

function createBuild(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-janice-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src', 'main'), { recursive: true });
  return { root, file: path.join(root, 'src', 'main', 'bundled-janice-key.json') };
}

test('build injects the key from the environment and source runs work without a generated file', t => {
  const { root, file } = createBuild(t);
  assert.equal(readBundledJaniceKey(file), null);
  prepareBundledJaniceKey(root, { JANICE_API_KEY: ' test-bundled-key ' }, true);
  assert.equal(readBundledJaniceKey(file), 'test-bundled-key');
});

test('optional builds clear stale keys and release builds require a key', t => {
  const { root, file } = createBuild(t);
  prepareBundledJaniceKey(root, { JANICE_API_KEY: 'previous-key' });
  prepareBundledJaniceKey(root, {});
  assert.equal(readBundledJaniceKey(file), null);
  prepareBundledJaniceKey(root, { JANICE_API_KEY: 'previous-key' });
  assert.throws(() => prepareBundledJaniceKey(root, {}, true), /JANICE_API_KEY must be set/);
  assert.equal(readBundledJaniceKey(file), null);
  assert.throws(() => prepareBundledJaniceKey(root, { JANICE_API_KEY: 'invalid\nkey' }), /control characters/);
  assert.equal(readBundledJaniceKey(file), null);
});

test('local builds use an ignored key file and an explicit environment value takes priority', t => {
  const { root, file } = createBuild(t);
  fs.writeFileSync(path.join(root, '.janice-api-key'), 'local-test-key\n');
  prepareBundledJaniceKey(root, {}, true);
  assert.equal(readBundledJaniceKey(file), 'local-test-key');
  prepareBundledJaniceKey(root, { JANICE_API_KEY: 'ci-test-key' }, true);
  assert.equal(readBundledJaniceKey(file), 'ci-test-key');
  prepareBundledJaniceKey(root, { JANICE_API_KEY: '' });
  assert.equal(readBundledJaniceKey(file), null);
});

test('malformed bundled configuration errors never contain key material', t => {
  const { file } = createBuild(t);
  for (const contents of ['{"apiKey":"private-value', '{"apiKey":42}', '{"apiKey":""}']) {
    fs.writeFileSync(file, contents);
    assert.throws(() => readBundledJaniceKey(file), { message: 'The bundled Janice configuration is invalid' });
  }
});

test('packaging runs the injection hook and release builds require the CI secret', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.beforePack, './scripts/prepare-bundled-janice.js');
  assert.ok(pkg.build.files.includes('src/**/*'));
  assert.match(pkg.scripts['build:win:release'], /prepare-bundled-janice\.js --required && electron-builder/);
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /JANICE_API_KEY: \$\{\{ secrets\.JANICE_API_KEY \}\}/);
});
