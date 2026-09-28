const fs = require('node:fs');
const path = require('node:path');
const security = require('../src/shared/security');

function prepareBundledJaniceKey(projectDir, env = process.env, required = false) {
  const filePath = path.join(projectDir, 'src', 'main', 'bundled-janice-key.json');
  // Always clear the previous build's value, even when validation fails.
  fs.writeFileSync(filePath, JSON.stringify({ apiKey: null }) + '\n', { mode: 0o600 });
  let rawKey = env.JANICE_API_KEY;
  if (rawKey === undefined) {
    try {
      rawKey = fs.readFileSync(path.join(projectDir, '.janice-api-key'), 'utf8').trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Could not read the local Janice build key');
    }
  }
  const apiKey = rawKey?.trim()
    ? security.requireTrimmedText(rawKey, 'Bundled Janice key', 4096)
    : null;
  if (!apiKey && required) {
    throw new Error('JANICE_API_KEY must be set to build a release with bundled appraisals');
  }
  fs.writeFileSync(filePath, JSON.stringify({ apiKey }) + '\n', { mode: 0o600 });
}

// electron-builder calls this before collecting application files on every platform.
module.exports = context => prepareBundledJaniceKey(context.packager.projectDir);
module.exports.prepareBundledJaniceKey = prepareBundledJaniceKey;

if (require.main === module) {
  try {
    prepareBundledJaniceKey(path.join(__dirname, '..'), process.env, process.argv.includes('--required'));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
