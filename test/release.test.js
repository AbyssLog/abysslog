'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createReleaseChecksums,
  isReleaseAsset
} = require('../scripts/create-release-checksums');
const { verifyReleaseTag } = require('../scripts/verify-release-tag');

test('release tag must match both version manifests', () => {
  assert.equal(verifyReleaseTag('v1.2.3', '1.2.3', '1.2.3'), 'v1.2.3');
  assert.throws(
    () => verifyReleaseTag('v1.2.4', '1.2.3', '1.2.3'),
    /does not match package version/
  );
  assert.throws(
    () => verifyReleaseTag('v1.2.3', '1.2.3', '1.2.4'),
    /Version mismatch/
  );
});

test('release assets are selected narrowly', () => {
  assert.equal(isReleaseAsset('AbyssLog-Setup.exe'), true);
  assert.equal(isReleaseAsset('AbyssLog-Setup.exe.blockmap'), true);
  assert.equal(isReleaseAsset('latest.yml'), true);
  assert.equal(isReleaseAsset('builder-debug.yml'), false);
  assert.equal(isReleaseAsset('unrelated.exe.txt'), false);
});

test('release checksums are deterministic and exclude unrelated files', (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-release-'));
  context.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tempDir, 'AbyssLog.exe'), 'installer', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'latest.yml'), 'version: 1.0.0', 'utf8');
  fs.writeFileSync(path.join(tempDir, 'builder-debug.yml'), 'private build details', 'utf8');

  const result = createReleaseChecksums(tempDir);
  const installerHash = crypto.createHash('sha256').update('installer').digest('hex');
  const manifestHash = crypto.createHash('sha256').update('version: 1.0.0').digest('hex');
  const checksumFile = fs.readFileSync(result.outputPath, 'utf8');

  assert.deepEqual(result.assets, ['AbyssLog.exe', 'latest.yml']);
  assert.equal(
    checksumFile,
    `${installerHash}  AbyssLog.exe\n${manifestHash}  latest.yml\n`
  );
  assert.doesNotMatch(checksumFile, /builder-debug/);
});

test('release checksums require a Windows installer', (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-release-'));
  context.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tempDir, 'latest.yml'), 'version: 1.0.0', 'utf8');
  assert.throws(() => createReleaseChecksums(tempDir), /No Windows installer/);
});
