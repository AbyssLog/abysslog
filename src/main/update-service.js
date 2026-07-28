const { createHttpClient } = require('./http-client');
const security = require('../shared/security');
const updates = require('../shared/updates');

const GITHUB_API_VERSION = '2026-03-10';
const LATEST_RELEASE_URL =
  'https://api.github.com/repos/AbyssLog/abysslog/releases/latest';
const RELEASE_PATH_PREFIX = '/AbyssLog/abysslog/releases/tag/';

function validatePublishedRelease(value) {
  if (!security.isPlainObject(value)) {
    throw new TypeError('GitHub release must be an object');
  }
  if (value.draft !== false || value.prerelease !== false) {
    throw new TypeError('GitHub release is not a published stable release');
  }

  const tagName = security.requireString(value.tag_name, 'Release tag', 64);
  const version = updates.parseSemver(tagName).version;
  const releaseUrl = security.requireString(value.html_url, 'Release URL', 2048);
  if (!security.isAllowedExternalUrl(releaseUrl)) {
    throw new TypeError('Release URL is not allowed');
  }

  const parsedUrl = new URL(releaseUrl);
  if (
    parsedUrl.origin !== 'https://github.com'
    || parsedUrl.search
    || parsedUrl.hash
    || !parsedUrl.pathname.startsWith(RELEASE_PATH_PREFIX)
  ) {
    throw new TypeError('Release URL is invalid');
  }

  let urlTag;
  try {
    urlTag = decodeURIComponent(parsedUrl.pathname.slice(RELEASE_PATH_PREFIX.length));
  } catch {
    throw new TypeError('Release URL contains invalid encoding');
  }
  if (!urlTag || urlTag.includes('/') || urlTag !== tagName) {
    throw new TypeError('Release URL does not match the release tag');
  }

  return { version, releaseUrl };
}

function createUpdateService({ httpClient = createHttpClient() } = {}) {
  async function checkForUpdate(appVersion) {
    const currentVersion = updates.parseSemver(appVersion).version;
    try {
      const release = await httpClient.requestJson(LATEST_RELEASE_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `AbyssLog/${currentVersion} (+https://github.com/AbyssLog/abysslog)`,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        label: 'GitHub releases',
        maxResponseBytes: 256 * 1024,
        timeoutMs: 8_000,
        retries: 1,
      });
      return { success: true, ...validatePublishedRelease(release) };
    } catch (error) {
      if (error?.statusCode === 404) {
        return { success: true, noRelease: true };
      }
      throw error;
    }
  }

  return { checkForUpdate };
}

module.exports = {
  GITHUB_API_VERSION,
  LATEST_RELEASE_URL,
  createUpdateService,
  validatePublishedRelease,
};
