'use strict';

const path = require('path');

const APP_PROTOCOL_SCHEME = 'abysslog-app';
const APP_PROTOCOL_HOST = 'bundle';
const APP_RENDERER_URL =
  `${APP_PROTOCOL_SCHEME}://${APP_PROTOCOL_HOST}/src/renderer/index.html`;

function resolveAppAssetPath(appRoot, requestUrl) {
  if (typeof appRoot !== 'string' || !path.isAbsolute(appRoot)) {
    throw new TypeError('Application root must be an absolute path');
  }

  let url;
  let decodedPath;
  try {
    url = new URL(requestUrl);
    decodedPath = decodeURIComponent(url.pathname).replace(/\\/g, '/');
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_PROTOCOL_SCHEME}:` || url.host !== APP_PROTOCOL_HOST) {
    return null;
  }
  if (decodedPath.includes('\0')) return null;

  const segments = decodedPath
    .split('/')
    .filter(segment => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return null;

  const isRendererAsset =
    segments[0] === 'src'
    && (segments[1] === 'renderer' || segments[1] === 'shared');
  const isImageAsset = segments[0] === 'assets';
  if (!isRendererAsset && !isImageAsset) return null;

  const resolvedRoot = path.resolve(appRoot);
  const resolvedPath = path.resolve(resolvedRoot, ...segments);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (
    !relativePath
    || relativePath.startsWith('..')
    || path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return resolvedPath;
}

module.exports = {
  APP_PROTOCOL_HOST,
  APP_PROTOCOL_SCHEME,
  APP_RENDERER_URL,
  resolveAppAssetPath,
};
