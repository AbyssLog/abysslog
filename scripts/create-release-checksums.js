'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function isReleaseAsset(filename) {
  return filename.endsWith('.exe') ||
    filename.endsWith('.exe.blockmap') ||
    filename === 'latest.yml';
}

function getUpdateManifestAssetNames(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:-\s*)?(?:url|path):\s*(\S+)\s*$/)?.[1])
    .filter(Boolean);
}

function verifyUpdateManifestAssets(distPath, assets) {
  const manifestPath = path.join(distPath, 'latest.yml');
  const references = [...new Set(
    getUpdateManifestAssetNames(fs.readFileSync(manifestPath, 'utf8'))
  )];

  if (references.length === 0) {
    throw new Error('latest.yml does not reference a release asset');
  }

  const assetSet = new Set(assets);
  for (const filename of references) {
    if (!assetSet.has(filename)) {
      throw new Error(`latest.yml references missing release asset: ${filename}`);
    }
  }
}

function createReleaseChecksums(distPath) {
  const assets = fs.readdirSync(distPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isReleaseAsset(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

  if (!assets.some((filename) => filename.endsWith('.exe'))) {
    throw new Error(`No Windows installer was found in ${distPath}`);
  }

  verifyUpdateManifestAssets(distPath, assets);

  const lines = assets.map((filename) => {
    const contents = fs.readFileSync(path.join(distPath, filename));
    const digest = crypto.createHash('sha256').update(contents).digest('hex');
    return `${digest}  ${filename}`;
  });

  const outputPath = path.join(distPath, 'SHA256SUMS.txt');
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  return { assets, outputPath };
}

function main() {
  const distPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  const result = createReleaseChecksums(distPath);
  console.log(`Wrote checksums for ${result.assets.length} release assets to ${result.outputPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  createReleaseChecksums,
  getUpdateManifestAssetNames,
  isReleaseAsset,
  verifyUpdateManifestAssets
};
