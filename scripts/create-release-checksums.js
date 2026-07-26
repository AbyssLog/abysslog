'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function isReleaseAsset(filename) {
  return filename.endsWith('.exe') ||
    filename.endsWith('.exe.blockmap') ||
    filename === 'latest.yml';
}

function createReleaseChecksums(distPath) {
  const assets = fs.readdirSync(distPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isReleaseAsset(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

  if (!assets.some((filename) => filename.endsWith('.exe'))) {
    throw new Error(`No Windows installer was found in ${distPath}`);
  }

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

module.exports = { createReleaseChecksums, isReleaseAsset };
