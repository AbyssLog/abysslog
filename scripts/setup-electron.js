const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000]);
const MAX_CAPTURE_CHARS = 128 * 1024;
const TRANSIENT_FAILURE = /(?:ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|ECONNREFUSED|socket hang up|network timeout|status(?: code)?[ :=]+(?:408|429|5\d\d)|HTTP[ /](?:408|429|5\d\d))/i;

function appendBounded(current, chunk) {
  return (current + String(chunk)).slice(-MAX_CAPTURE_CHARS);
}

function runElectronInstaller({
  executable = process.execPath,
  installScript = path.join(__dirname, '..', 'node_modules', 'electron', 'install.js'),
  spawnImpl = spawn,
} = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawnImpl(executable, [installScript], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.on('data', chunk => {
      stdout = appendBounded(stdout, chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr = appendBounded(stderr, chunk);
      process.stderr.write(chunk);
    });
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, ...result });
    };
    child.once('error', error => finish({ exitCode: null, signal: null, error }));
    child.once('close', (exitCode, signal) => finish({ exitCode, signal, error: null }));
  });
}

function isTransientInstallFailure(result) {
  return TRANSIENT_FAILURE.test([
    result?.error?.message,
    result?.stdout,
    result?.stderr,
  ].filter(Boolean).join(String.fromCharCode(10)));
}

function wait(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function failureMessage(result, attempts) {
  const status = result?.error?.message
    || (result?.signal ? 'signal ' + result.signal : 'exit code ' + (result?.exitCode ?? 'unknown'));
  return 'Electron setup failed after ' + attempts + ' attempt'
    + (attempts === 1 ? '' : 's') + ' (' + status + ').';
}

async function installElectron({
  runInstall = () => runElectronInstaller(),
  waitFor = wait,
  report = message => process.stderr.write(message + String.fromCharCode(10)),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
} = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new RangeError('Electron setup attempt limit must be between 1 and 5');
  }
  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      result = await runInstall(attempt);
    } catch (error) {
      result = { exitCode: null, signal: null, stdout: '', stderr: '', error };
    }
    if (result?.exitCode === 0 && !result.error) return result;
    if (attempt >= maxAttempts || !isTransientInstallFailure(result)) {
      throw new Error(failureMessage(result, attempt), { cause: result?.error });
    }
    const delayIndex = Math.min(attempt - 1, retryDelaysMs.length - 1);
    const delayMs = retryDelaysMs[delayIndex] ?? 0;
    report('Electron download failed with a transient network error; retrying attempt '
      + (attempt + 1) + ' of ' + maxAttempts + ' in ' + delayMs + ' ms.');
    await waitFor(delayMs);
  }
  throw new Error(failureMessage(result, maxAttempts));
}

if (require.main === module) {
  installElectron().catch(error => {
    process.stderr.write((error?.message || String(error)) + String.fromCharCode(10));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAYS_MS,
  installElectron,
  isTransientInstallFailure,
  runElectronInstaller,
};
