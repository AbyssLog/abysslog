'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createDiagnostics,
  normalizeDetails,
  sanitizeText,
} = require('../src/main/diagnostics');

function createTempDirectory(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'abysslog-diagnostics-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function readAllLogs(directory) {
  return fs.readdirSync(directory)
    .filter(filename => /^abysslog\.log(?:\.\d+)?$/.test(filename))
    .sort()
    .map(filename => fs.readFileSync(path.join(directory, filename), 'utf8'))
    .join('');
}

test('diagnostics retain safe categories without recording private values', context => {
  const directory = createTempDirectory(context);
  const diagnostics = createDiagnostics({ directory });
  const error = new Error(
    'Character Erinys failed with Bearer secret-token and api_key=janice-secret'
  );
  error.name = 'HttpError';
  error.statusCode = 503;
  error.errorCode = 'service_unavailable';
  error.retryable = true;

  diagnostics.failure('ipc.failure', {
    context: 'esi:get-location',
    accessToken: 'oauth-secret',
    inventory: 'Vespa II x5',
    characterName: 'Erinys',
  }, error);

  const contents = readAllLogs(directory);
  assert.match(contents, /"event":"ipc\.failure"/);
  assert.match(contents, /"context":"esi:get-location"/);
  assert.match(contents, /"category":"HttpError"/);
  assert.match(contents, /"status":503/);
  assert.match(contents, /"code":"service_unavailable"/);
  assert.match(contents, /"retryable":true/);
  assert.doesNotMatch(contents, /Erinys|Vespa|oauth-secret|janice-secret|secret-token/);
  assert.doesNotMatch(contents, /Character .* failed/);
});

test('diagnostic sanitizers redact credentials and drop private detail keys', () => {
  assert.equal(
    sanitizeText('Bearer abc.def api_key=secret https://test/?code=abc&state=def'),
    'Bearer [redacted] api_key=[redacted] https://test/?code=[redacted]&state=[redacted]'
  );
  assert.deepEqual(normalizeDetails({
    source: 'renderer',
    phase: 'startup',
    token: 'secret',
    authorizationUrl: 'https://login.example/?code=secret',
    character: 'Erinys',
    items: ['Private item'],
  }), {
    source: 'renderer',
    phase: 'startup',
  });
});

test('diagnostics rotate to a bounded number of files', context => {
  const directory = createTempDirectory(context);
  let timestamp = Date.parse('2026-07-28T12:00:00Z');
  const diagnostics = createDiagnostics({
    directory,
    maxFiles: 3,
    maxFileBytes: 300,
    now: () => new Date(timestamp += 61_000),
  });

  for (let index = 0; index < 30; index += 1) {
    diagnostics.info(`test.event.${index}`, {
      source: 'test',
      phase: `phase-${index}`,
    });
  }

  const files = fs.readdirSync(directory)
    .filter(filename => /^abysslog\.log(?:\.\d+)?$/.test(filename));
  assert.equal(files.length <= 3, true);
  assert.equal(files.includes('abysslog.log'), true);
  assert.equal(files.includes('abysslog.log.1'), true);
});

test('diagnostics start a new active file on each UTC logging day', context => {
  const directory = createTempDirectory(context);
  let timestamp = Date.parse('2026-07-27T23:59:00Z');
  const diagnostics = createDiagnostics({
    directory,
    now: () => new Date(timestamp),
  });
  diagnostics.info('day.one', { source: 'test' });
  timestamp = Date.parse('2026-07-28T00:01:00Z');
  diagnostics.info('day.two', { source: 'test' });

  const active = fs.readFileSync(path.join(directory, 'abysslog.log'), 'utf8');
  const previous = fs.readFileSync(path.join(directory, 'abysslog.log.1'), 'utf8');
  assert.match(active, /"event":"day\.two"/);
  assert.doesNotMatch(active, /"event":"day\.one"/);
  assert.match(previous, /"event":"day\.one"/);
});

test('diagnostics delete expired files and produce a bounded filtered summary', context => {
  const directory = createTempDirectory(context);
  const stalePath = path.join(directory, 'abysslog.log.4');
  fs.writeFileSync(stalePath, 'stale private data', 'utf8');
  const staleTime = new Date('2026-07-18T12:00:00Z');
  fs.utimesSync(stalePath, staleTime, staleTime);

  const diagnostics = createDiagnostics({
    directory,
    now: () => new Date('2026-07-28T12:00:00Z'),
  });
  diagnostics.info('startup.complete', { source: 'main' });

  assert.equal(fs.existsSync(stalePath), false);
  const summary = diagnostics.createSummary({
    version: '1.0.0',
    electronVersion: '43.2.0',
    platform: 'win32',
    release: '10.0.26100',
    arch: 'x64',
  });
  assert.match(summary, /AbyssLog privacy-filtered diagnostics/);
  assert.match(summary, /AbyssLog: 1\.0\.0/);
  assert.match(summary, /"event":"startup\.complete"/);
  assert.doesNotMatch(summary, /stale private data/);
});

test('diagnostics prune an inactive log after the retention window', context => {
  const directory = createTempDirectory(context);
  let timestamp = Date.parse('2026-07-01T12:00:00Z');
  const diagnostics = createDiagnostics({
    directory,
    now: () => new Date(timestamp),
  });
  diagnostics.info('idle.start', { source: 'test' });
  const activePath = path.join(directory, 'abysslog.log');
  const createdAt = new Date(timestamp);
  fs.utimesSync(activePath, createdAt, createdAt);

  timestamp = Date.parse('2026-07-09T12:00:01Z');
  diagnostics.prune();

  assert.equal(fs.existsSync(activePath), false);
});
