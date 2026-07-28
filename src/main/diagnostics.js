'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_SUMMARY_LINES = 80;
const LOG_FILE_NAME = 'abysslog.log';
const SAFE_DETAIL_KEYS = new Set([
  'arch',
  'category',
  'code',
  'context',
  'phase',
  'platform',
  'retryable',
  'source',
  'status',
  'version',
]);
const SENSITIVE_KEY_PATTERN =
  /(authorization|character|credential|inventory|item|key|name|secret|token|url)/i;
const SENSITIVE_VALUE_PATTERN =
  /\b(access[_ -]?token|refresh[_ -]?token|api[_ -]?key|client[_ -]?secret|authorization)(\s*[:=]\s*)([^\s,;]+)/gi;
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:access_token|refresh_token|api[_-]?key|client_secret|code|state)=)[^&#\s]+/gi;
const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function sanitizeText(value, maxLength = 160) {
  const text = String(value ?? '')
    .replace(BEARER_PATTERN, '$1 [redacted]')
    .replace(SENSITIVE_VALUE_PATTERN, '$1$2[redacted]')
    .replace(SENSITIVE_QUERY_PATTERN, '$1[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

function sanitizeIdentifier(value, fallback) {
  const text = sanitizeText(value, 96);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(text) ? text : fallback;
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DETAIL_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'boolean') {
      normalized[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[key] = value;
    } else if (typeof value === 'string') {
      const safeValue = sanitizeIdentifier(value, '');
      if (safeValue) normalized[key] = safeValue;
    }
  }
  return normalized;
}

function classifyError(error) {
  const category = sanitizeIdentifier(error?.name, 'Error');
  const details = { category };
  const status = error?.statusCode ?? error?.status;
  if (safeInteger(status, 100, 599)) details.status = status;
  const code = error?.errorCode ?? error?.code;
  const safeCode = sanitizeIdentifier(code, '');
  if (safeCode) details.code = safeCode;
  if (typeof error?.retryable === 'boolean') details.retryable = error.retryable;
  return details;
}

function logFilePattern(filename) {
  return filename === LOG_FILE_NAME || /^abysslog\.log\.\d+$/.test(filename);
}

function createDiagnostics({
  directory,
  now = () => new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
  maxFiles = DEFAULT_MAX_FILES,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  summaryLines = DEFAULT_SUMMARY_LINES,
} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new TypeError('A diagnostics directory is required');
  }
  if (!safeInteger(retentionDays, 1, 30)) {
    throw new TypeError('Diagnostics retention must be between 1 and 30 days');
  }
  if (!safeInteger(maxFiles, 2, 20)) {
    throw new TypeError('Diagnostics file count must be between 2 and 20');
  }
  if (!safeInteger(maxFileBytes, 256, 10 * 1024 * 1024)) {
    throw new TypeError('Diagnostics file size must be between 256 bytes and 10 MB');
  }
  if (!safeInteger(summaryLines, 1, 500)) {
    throw new TypeError('Diagnostics summary length must be between 1 and 500 lines');
  }

  const resolvedDirectory = path.resolve(directory);
  const activePath = path.join(resolvedDirectory, LOG_FILE_NAME);
  let lastFingerprint = null;
  let lastFingerprintAt = 0;
  let activeDate = null;
  let lastPruneAt = 0;

  function ensureDirectory() {
    fs.mkdirSync(resolvedDirectory, { recursive: true, mode: 0o700 });
  }

  function pruneExpired(referenceTimeMs) {
    ensureDirectory();
    const cutoff = referenceTimeMs - retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(resolvedDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !logFilePattern(entry.name)) continue;
      const filePath = path.join(resolvedDirectory, entry.name);
      try {
        if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
      } catch {
        // Diagnostics must never prevent the app from starting.
      }
    }
  }

  function rotateFiles() {
    const oldestPath = `${activePath}.${maxFiles - 1}`;
    fs.rmSync(oldestPath, { force: true });
    for (let index = maxFiles - 2; index >= 1; index -= 1) {
      const source = `${activePath}.${index}`;
      const destination = `${activePath}.${index + 1}`;
      if (fs.existsSync(source)) fs.renameSync(source, destination);
    }
    if (fs.existsSync(activePath)) fs.renameSync(activePath, `${activePath}.1`);
    activeDate = null;
  }

  function rotateIfNeeded(incomingBytes, timestamp) {
    let currentSize = 0;
    try {
      currentSize = fs.statSync(activePath).size;
    } catch {
      return;
    }
    const currentDate = timestamp.toISOString().slice(0, 10);
    if (activeDate !== currentDate || currentSize + incomingBytes > maxFileBytes) {
      rotateFiles();
    }
  }

  function append(level, event, details = {}) {
    try {
      ensureDirectory();
      const timestamp = now();
      const entry = {
        timestamp: timestamp.toISOString(),
        level: sanitizeIdentifier(level, 'info'),
        event: sanitizeIdentifier(event, 'diagnostics.event'),
        ...normalizeDetails(details),
      };
      const line = `${JSON.stringify(entry)}\n`;
      const fingerprint = `${entry.level}:${entry.event}:${entry.context || ''}:${entry.category || ''}:${entry.status || ''}:${entry.code || ''}`;
      const timestampMs = timestamp.getTime();
      if (fingerprint === lastFingerprint && timestampMs - lastFingerprintAt < 60_000) return false;
      rotateIfNeeded(Buffer.byteLength(line, 'utf8'), timestamp);
      fs.appendFileSync(activePath, line, { encoding: 'utf8', mode: 0o600 });
      activeDate = timestamp.toISOString().slice(0, 10);
      if (timestampMs - lastPruneAt >= 24 * 60 * 60 * 1000) {
        pruneExpired(timestampMs);
        lastPruneAt = timestampMs;
      }
      lastFingerprint = fingerprint;
      lastFingerprintAt = timestampMs;
      return true;
    } catch {
      return false;
    }
  }

  function failure(event, details, error) {
    return append('error', event, {
      ...normalizeDetails(details),
      ...classifyError(error),
    });
  }

  function readRecentLines() {
    const files = [];
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      files.push(`${activePath}.${index}`);
    }
    files.push(activePath);
    const lines = [];
    for (const filePath of files) {
      try {
        lines.push(...fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean));
      } catch {
        // A missing or unreadable rotated file is harmless.
      }
    }
    return lines.slice(-summaryLines);
  }

  function createSummary({
    version,
    electronVersion,
    platform,
    release,
    arch,
  } = {}) {
    const generatedAt = now().toISOString();
    const metadata = [
      'AbyssLog privacy-filtered diagnostics',
      `Generated: ${generatedAt}`,
      `AbyssLog: ${sanitizeIdentifier(version, 'unknown')}`,
      `Electron: ${sanitizeIdentifier(electronVersion, 'unknown')}`,
      `Operating system: ${sanitizeIdentifier(platform, 'unknown')} ${sanitizeIdentifier(release, 'unknown')} (${sanitizeIdentifier(arch, 'unknown')})`,
      `Retention: ${retentionDays} days, up to ${maxFiles} files of ${maxFileBytes} bytes`,
      '',
      'Recent filtered events:',
    ];
    const events = readRecentLines();
    return [...metadata, ...(events.length ? events : ['No diagnostic events recorded.'])].join('\n');
  }

  const initializedAt = now();
  pruneExpired(initializedAt.getTime());
  lastPruneAt = initializedAt.getTime();
  try {
    const firstLine = fs.readFileSync(activePath, 'utf8').split(/\r?\n/, 1)[0];
    const firstEntry = JSON.parse(firstLine);
    const firstTimestamp = new Date(firstEntry.timestamp);
    if (Number.isFinite(firstTimestamp.getTime())) {
      activeDate = firstTimestamp.toISOString().slice(0, 10);
    }
  } catch {
    activeDate = null;
  }

  return Object.freeze({
    info: (event, details) => append('info', event, details),
    warn: (event, details) => append('warn', event, details),
    failure,
    prune: () => {
      const timestampMs = now().getTime();
      pruneExpired(timestampMs);
      lastPruneAt = timestampMs;
    },
    createSummary,
    getStatus: () => ({
      directory: resolvedDirectory,
      retentionDays,
      maxFiles,
      maxFileBytes,
    }),
  });
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_RETENTION_DAYS,
  classifyError,
  createDiagnostics,
  normalizeDetails,
  sanitizeText,
};
