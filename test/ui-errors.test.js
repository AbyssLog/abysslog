const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatUiError,
  sanitizeUiErrorDetail,
} = require('../src/shared/ui-errors');

test('UI errors remove Electron IPC noise and retain useful context', () => {
  const message = formatUiError(
    'Could not save settings',
    new Error("Error invoking remote method 'settings:set': Error: Database is locked")
  );

  assert.equal(message, 'Could not save settings: Database is locked');
});

test('UI errors redact credentials and OAuth callback parameters', () => {
  const sanitized = sanitizeUiErrorDetail(
    'Bearer abc.def api_key=top-secret https://example.test/?code=oauth-code&state=oauth-state'
  );

  assert.equal(
    sanitized,
    'Bearer [redacted] api_key=[redacted] https://example.test/?code=[redacted]&state=[redacted]'
  );
});

test('UI errors collapse control characters and bound displayed details', () => {
  const message = formatUiError('Import failed', `first line\n${'x'.repeat(400)}`);

  assert.equal(message.includes('\n'), false);
  assert.equal(message.startsWith('Import failed: first line '), true);
  assert.equal(message.endsWith('…'), true);
  assert.equal(message.length <= 255, true);
});

test('UI errors provide a complete fallback when no detail is available', () => {
  assert.equal(formatUiError('Could not create a backup', null), 'Could not create a backup.');
});
