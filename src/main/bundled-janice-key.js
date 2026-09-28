const fs = require('node:fs');
const path = require('node:path');
const security = require('../shared/security');

const BUNDLED_KEY_PATH = path.join(__dirname, 'bundled-janice-key.json');

function readBundledJaniceKey(filePath = BUNDLED_KEY_PATH) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Could not read the bundled Janice configuration');
  }
  try {
    const { apiKey } = JSON.parse(contents);
    return apiKey === null ? null : security.requireTrimmedText(apiKey, 'Bundled Janice key', 4096);
  } catch {
    // JSON parser errors can include the input, so never forward them.
    throw new Error('The bundled Janice configuration is invalid');
  }
}

module.exports = { readBundledJaniceKey };
