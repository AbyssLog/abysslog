'use strict';

const fs = require('node:fs');
const path = require('node:path');

function verifyReleaseTag(tag, packageVersion, manifestVersion) {
  if (typeof tag !== 'string' || !tag) {
    throw new TypeError('A release tag is required');
  }

  if (packageVersion !== manifestVersion) {
    throw new Error(
      `Version mismatch: package.json is ${packageVersion}, version.json is ${manifestVersion}`
    );
  }

  const expectedTag = `v${packageVersion}`;
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag} does not match package version ${expectedTag}`);
  }

  return expectedTag;
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const versionJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'version.json'), 'utf8')
  );
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME;

  const verifiedTag = verifyReleaseTag(tag, packageJson.version, versionJson.version);
  console.log(`Release version verified: ${verifiedTag}`);
}

if (require.main === module) {
  main();
}

module.exports = { verifyReleaseTag };
