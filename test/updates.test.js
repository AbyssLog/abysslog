'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const updates = require('../src/shared/updates');
const {
  GITHUB_API_VERSION,
  LATEST_RELEASE_URL,
  createUpdateService,
  validatePublishedRelease,
} = require('../src/main/update-service');

test('semantic versions compare stable and prerelease versions correctly', () => {
  assert.equal(updates.compareSemver('1.0.1', '1.0.0'), 1);
  assert.equal(updates.compareSemver('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(updates.compareSemver('1.0.0-rc.2', '1.0.0-rc.1'), 1);
  assert.equal(updates.compareSemver('1.0.0-rc.10', '1.0.0-rc.2'), 1);
  assert.equal(updates.compareSemver('1.0.0-beta', '1.0.0-rc'), -1);
  assert.equal(updates.compareSemver('v1.0.0+build.2', '1.0.0+build.1'), 0);
});

test('invalid semantic versions are rejected', () => {
  for (const value of ['1', '1.0', '1.0.0.0', '1.0.0-rc.01', '01.0.0', 'latest']) {
    assert.throws(() => updates.parseSemver(value), value);
  }
});

test('published GitHub release metadata is reduced to trusted fields', () => {
  assert.deepEqual(validatePublishedRelease({
    tag_name: 'v1.2.3',
    html_url: 'https://github.com/AbyssLog/abysslog/releases/tag/v1.2.3',
    draft: false,
    prerelease: false,
    body: '<script>not returned</script>',
  }), {
    version: '1.2.3',
    releaseUrl: 'https://github.com/AbyssLog/abysslog/releases/tag/v1.2.3',
  });
});

test('drafts, prereleases, mismatched tags, and foreign URLs are rejected', () => {
  const release = {
    tag_name: 'v1.2.3',
    html_url: 'https://github.com/AbyssLog/abysslog/releases/tag/v1.2.3',
    draft: false,
    prerelease: false,
  };

  assert.throws(() => validatePublishedRelease({ ...release, draft: true }));
  assert.throws(() => validatePublishedRelease({ ...release, prerelease: true }));
  assert.throws(() => validatePublishedRelease({
    ...release,
    html_url: 'https://github.com/AbyssLog/abysslog/releases/tag/v1.2.4',
  }));
  assert.throws(() => validatePublishedRelease({
    ...release,
    html_url: 'https://github.com/attacker/abysslog/releases/tag/v1.2.3',
  }));
});

test('update service requests the latest stable GitHub release with bounded settings', async () => {
  let request;
  const service = createUpdateService({
    httpClient: {
      async requestJson(url, options) {
        request = { url, options };
        return {
          tag_name: 'v1.2.3',
          html_url: 'https://github.com/AbyssLog/abysslog/releases/tag/v1.2.3',
          draft: false,
          prerelease: false,
        };
      },
    },
  });

  assert.deepEqual(await service.checkForUpdate('1.0.0-rc.1'), {
    success: true,
    version: '1.2.3',
    releaseUrl: 'https://github.com/AbyssLog/abysslog/releases/tag/v1.2.3',
  });
  assert.equal(request.url, LATEST_RELEASE_URL);
  assert.equal(request.options.headers['X-GitHub-Api-Version'], GITHUB_API_VERSION);
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json');
  assert.match(request.options.headers['User-Agent'], /^AbyssLog\/1\.0\.0-rc\.1 /);
  assert.equal(request.options.maxResponseBytes, 256 * 1024);
  assert.equal(request.options.timeoutMs, 8_000);
  assert.equal(request.options.retries, 1);
});

test('a missing public release is reported without exposing an HTTP error', async () => {
  const service = createUpdateService({
    httpClient: {
      async requestJson() {
        const error = new Error('not found');
        error.statusCode = 404;
        throw error;
      },
    },
  });

  assert.deepEqual(await service.checkForUpdate('1.0.0'), {
    success: true,
    noRelease: true,
  });
});
