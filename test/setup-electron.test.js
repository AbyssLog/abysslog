const assert = require('node:assert/strict');
const test = require('node:test');

const {
  installElectron,
  isTransientInstallFailure,
} = require('../scripts/setup-electron');

function result(exitCode, stderr = '') {
  return { exitCode, signal: null, stdout: '', stderr, error: null };
}

test('Electron setup succeeds without retrying', async () => {
  let attempts = 0;
  const completed = await installElectron({
    runInstall: async () => {
      attempts += 1;
      return result(0);
    },
    report: () => {},
  });
  assert.equal(completed.exitCode, 0);
  assert.equal(attempts, 1);
});

test('Electron setup retries only bounded transient download failures', async () => {
  let attempts = 0;
  const delays = [];
  const messages = [];
  await installElectron({
    runInstall: async () => {
      attempts += 1;
      return attempts < 3 ? result(1, 'read ECONNRESET') : result(0);
    },
    waitFor: async delay => delays.push(delay),
    report: message => messages.push(message),
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1_000, 3_000]);
  assert.equal(messages.length, 2);
});

test('Electron setup does not retry deterministic installer failures', async () => {
  let attempts = 0;
  await assert.rejects(
    installElectron({
      runInstall: async () => {
        attempts += 1;
        return result(1, 'Cannot find module electron/install.js');
      },
      waitFor: async () => assert.fail('wait should not run'),
      report: () => {},
    }),
    /failed after 1 attempt/
  );
  assert.equal(attempts, 1);
});

test('Electron setup stops after three transient failures', async () => {
  let attempts = 0;
  await assert.rejects(
    installElectron({
      runInstall: async () => {
        attempts += 1;
        return result(1, 'HTTP 503');
      },
      waitFor: async () => {},
      report: () => {},
    }),
    /failed after 3 attempts/
  );
  assert.equal(attempts, 3);
  assert.equal(isTransientInstallFailure(result(1, 'authentication failed')), false);
  assert.equal(isTransientInstallFailure(result(1, 'socket hang up')), true);
});
