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

const projectRoot = path.resolve(__dirname, '..');

test('release workflow builds an unsigned draft with checksums', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'),
    'utf8'
  );

  assert.doesNotMatch(packageJson.scripts['build:win:release'], /forceCodeSigning/);
  assert.equal(
    packageJson.build.nsis.artifactName,
    '${productName}-Setup-${version}.${ext}'
  );
  assert.match(workflow, /build-unsigned-windows:/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);
  assert.match(workflow, /npm run release:checksums/);
  assert.match(workflow, /gh release create[\s\S]*--draft/);
  assert.doesNotMatch(workflow, /WIN_CSC|Authenticode|--draft=false/);
});

test('public release documentation covers privacy, security, support, and CCP attribution', () => {
  const read = filename => fs.readFileSync(path.join(projectRoot, filename), 'utf8');
  const readme = read('README.md');
  const privacy = read('PRIVACY.md');
  const security = read('SECURITY.md');
  const support = read('SUPPORT.md');
  const license = read('LICENSE');
  const notice = read('NOTICE.md');
  const checklist = read('RELEASE_CHECKLIST.md');
  const about = read(path.join('src', 'renderer', 'index.html'));
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  assert.match(readme, /\[Privacy\]\(PRIVACY\.md\)/);
  assert.match(readme, /\[License\]\(LICENSE\)/);
  assert.match(readme, /\[release checklist\]\(RELEASE_CHECKLIST\.md\)/);
  assert.match(readme, /not code signed/);
  assert.match(privacy, /does\s+not include telemetry, advertising, or crash reporting/);
  assert.match(privacy, /asset list to locate the active ship/);
  assert.match(privacy, /privacy-filtered diagnostic event log/);
  assert.match(privacy, /five files of 1 MB each/);
  assert.match(privacy, /never sent automatically/);
  assert.match(security, /Private Vulnerability Reporting/);
  assert.match(security, /contains only a\s+request to establish private contact/);
  assert.match(support, /best effort/);
  assert.match(support, /Copy Diagnostics/);
  assert.match(support, /does not include\s+error messages, credentials/);
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Erinys/);
  assert.match(notice, /not affiliated with\s+or endorsed by Fenris Creations/);
  assert.match(checklist, /Enable immutable releases/);
  assert.match(checklist, /Enable secret scanning and push protection/);
  assert.match(checklist, /Enable CodeQL default setup and Private Vulnerability Reporting/);
  assert.match(checklist, /Install the release candidate over the previous public version/);
  assert.match(checklist, /npm audit --omit=dev --audit-level=high/);
  assert.match(checklist, /An immutable tag name must not be reused/);
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageLock.packages[''].license, 'MIT');
  assert.equal(packageJson.build.files.includes('LICENSE'), true);
  assert.equal(packageJson.build.files.includes('NOTICE.md'), true);
  assert.match(about, /blob\/main\/PRIVACY\.md/);
  assert.match(about, /Open Logs Folder/);
  assert.match(about, /Copy Diagnostics/);
  assert.match(about, /blob\/main\/LICENSE/);
  assert.match(about, /id="aboutVersion"/);
  assert.match(about, /data-action="check-for-updates"/);
  assert.match(about, /Updates are checked only when requested/);
  assert.match(about, /src="\.\.\/\.\.\/assets\/logo\.png"/);
  assert.match(about, /src="\.\.\/\.\.\/assets\/icon\.png"/);
  assert.doesNotMatch(about, /data:image\/png;base64/);
  assert.match(about, /Local data · No telemetry · Open source/);
  assert.doesNotMatch(about, /Support the Project|ISK donations|Creator/);
  assert.match(about, /endorsed by Fenris Creations/);
  assert.match(about, /© 2014 CCP hf\. All rights reserved/);
  assert.doesNotMatch(about, /trademarks of Fenris Creations/);
  assert.match(privacy, /api\.github\.com/);
  assert.match(privacy, /only when you select \*\*Check for Updates\*\*/);
  assert.doesNotMatch(privacy, /raw\.githubusercontent\.com/);
});

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

  const manifest = 'version: 1.0.0\nfiles:\n  - url: AbyssLog.exe\npath: AbyssLog.exe\n';
  fs.writeFileSync(path.join(tempDir, 'AbyssLog.exe'), 'installer', 'utf8');
  fs.writeFileSync(
    path.join(tempDir, 'latest.yml'),
    manifest,
    'utf8'
  );
  fs.writeFileSync(path.join(tempDir, 'builder-debug.yml'), 'private build details', 'utf8');

  const result = createReleaseChecksums(tempDir);
  const installerHash = crypto.createHash('sha256').update('installer').digest('hex');
  const manifestHash = crypto.createHash('sha256').update(manifest).digest('hex');
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

test('release checksums reject update metadata that names a missing asset', (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-release-'));
  context.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(tempDir, 'AbyssLog Setup 1.0.0.exe'), 'installer', 'utf8');
  fs.writeFileSync(
    path.join(tempDir, 'latest.yml'),
    [
      'version: 1.0.0',
      'files:',
      '  - url: AbyssLog-Setup-1.0.0.exe',
      'path: AbyssLog-Setup-1.0.0.exe',
      ''
    ].join('\n'),
    'utf8'
  );

  assert.throws(
    () => createReleaseChecksums(tempDir),
    /latest\.yml references missing release asset: AbyssLog-Setup-1\.0\.0\.exe/
  );
});
