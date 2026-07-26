const { createHttpClient } = require('./http-client');
const security = require('../shared/security');

const ESI_BASE = 'https://esi.evetech.net/latest';
const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify';
const USER_AGENT = 'AbyssLog/1.0';
const CACHE_LIMIT = 5000;

const http = createHttpClient();
const systemNameCache = new Map();
const typeInfoCache = new Map();
const typeNameCache = new Map();

function cacheSet(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function authenticatedHeaders(accessToken) {
  return {
    Authorization: `Bearer ${security.requireString(
      accessToken,
      'Access token',
      16 * 1024
    )}`,
    'User-Agent': USER_AGENT,
  };
}

function getJson(url, headers = {}) {
  return http.requestJson(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    label: 'ESI',
  });
}

function postJson(url, body, headers = {}) {
  const serialized = JSON.stringify(body);
  return http.requestJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      ...headers,
    },
    body: serialized,
    label: 'ESI',
  });
}

async function postForm(url, body) {
  const serialized = new URLSearchParams(body).toString();
  return http.requestJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: serialized,
    label: 'EVE SSO',
    // Authorization codes and rotating refresh tokens must not be replayed
    // automatically when the response may have been lost.
    retries: 0,
  });
}

async function getLocation(characterId, accessToken) {
  const response = await getJson(
    `${ESI_BASE}/characters/${characterId}/location/`,
    authenticatedHeaders(accessToken)
  );
  return security.validateEsiLocation(response);
}

async function getShip(characterId, accessToken) {
  const response = await getJson(
    `${ESI_BASE}/characters/${characterId}/ship/`,
    authenticatedHeaders(accessToken)
  );
  return security.validateEsiShip(response);
}

async function getFitting(characterId, accessToken) {
  const response = await getJson(
    `${ESI_BASE}/characters/${characterId}/fit/`,
    authenticatedHeaders(accessToken)
  );
  return security.validateEsiFitting(response);
}

async function getImplants(characterId, accessToken) {
  const response = await getJson(
    `${ESI_BASE}/characters/${characterId}/implants/`,
    authenticatedHeaders(accessToken)
  );
  return security.validateEsiImplants(response);
}

async function getTypeInfo(typeId) {
  if (typeInfoCache.has(typeId)) return typeInfoCache.get(typeId);
  const response = await getJson(`${ESI_BASE}/universe/types/${typeId}/`);
  const typeInfo = security.validateEsiType(response);
  cacheSet(typeInfoCache, typeId, typeInfo);
  cacheSet(typeNameCache, typeId, typeInfo.name);
  return typeInfo;
}

async function getSystemName(systemId) {
  if (systemNameCache.has(systemId)) return systemNameCache.get(systemId);
  try {
    const response = await getJson(`${ESI_BASE}/universe/systems/${systemId}/`);
    const name = security.validateEsiSystem(response).name;
    cacheSet(systemNameCache, systemId, name);
    return name;
  } catch {
    return String(systemId);
  }
}

async function getTypeNames(typeIds) {
  if (!Array.isArray(typeIds) || typeIds.length === 0) return {};
  const uniqueIds = [...new Set(typeIds)];
  const names = {};
  const missing = [];

  for (const typeId of uniqueIds) {
    if (typeNameCache.has(typeId)) {
      names[typeId] = typeNameCache.get(typeId);
    } else {
      missing.push(typeId);
    }
  }

  if (missing.length > 0) {
    const response = await postJson(`${ESI_BASE}/universe/names/`, missing);
    for (const item of security.validateEsiNames(response)) {
      cacheSet(typeNameCache, item.id, item.name);
      names[item.id] = item.name;
    }
  }
  return names;
}

async function exchangeAuthorizationCode(code, clientId, codeVerifier, redirectUri) {
  const response = await postForm(SSO_TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  return security.validateOAuthTokenResponse(response, { requireRefreshToken: true });
}

async function refreshToken(refreshTokenValue, clientId) {
  const response = await postForm(SSO_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
    client_id: clientId,
  });
  return security.validateOAuthTokenResponse(response);
}

async function verifyToken(accessToken) {
  const response = await getJson(
    SSO_VERIFY_URL,
    authenticatedHeaders(accessToken)
  );
  return security.validateEsiTokenIdentity(response);
}

function clearMetadataCaches() {
  systemNameCache.clear();
  typeInfoCache.clear();
  typeNameCache.clear();
}

module.exports = {
  getLocation,
  getShip,
  getFitting,
  getImplants,
  getTypeInfo,
  getSystemName,
  getTypeNames,
  exchangeAuthorizationCode,
  refreshToken,
  verifyToken,
  clearMetadataCaches,
};
