const { createHttpClient } = require('./http-client');
const security = require('../shared/security');
const { version: APP_VERSION } = require('../../package.json');

const ESI_BASE = 'https://esi.evetech.net';
const ESI_COMPATIBILITY_DATE = '2026-07-25';
const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const SSO_VERIFY_URL = 'https://login.eveonline.com/v2/oauth/verify';
const USER_AGENT = `AbyssLog/${APP_VERSION} (+https://github.com/AbyssLog/abysslog)`;
const CACHE_LIMIT = 5000;
const ABYSSAL_SYSTEM_MIN = 32_000_000;
const CAPSULE_TYPE_IDS = new Set([670, 33_328]);

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

function isEsiUrl(value) {
  try {
    return new URL(value).origin === ESI_BASE;
  } catch {
    return false;
  }
}

function getJson(url, headers = {}, options = {}) {
  const compatibilityHeaders = isEsiUrl(url)
    ? { 'X-Compatibility-Date': ESI_COMPATIBILITY_DATE }
    : {};
  return http.requestJson(url, {
    ...options,
    headers: { 'User-Agent': USER_AGENT, ...compatibilityHeaders, ...headers },
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
      'X-Compatibility-Date': ESI_COMPATIBILITY_DATE,
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
  const headers = authenticatedHeaders(accessToken);
  const ship = await getShip(characterId, accessToken);
  const fittedItems = [];
  let assetLastModified = null;

  for (let page = 1, pageCount = 1; page <= pageCount; page++) {
    const response = await getJson(
      `${ESI_BASE}/characters/${characterId}/assets/?page=${page}`,
      headers,
      { includeResponseMetadata: true }
    );
    const assets = security.validateEsiAssets(response.data);
    const responseLastModified = response.headers?.['last-modified'] ?? null;
    if (page === 1) {
      assetLastModified = responseLastModified;
      const rawPageCount = Number(response.headers?.['x-pages'] ?? 1);
      pageCount = security.requireInteger(rawPageCount, 'ESI asset page count', {
        min: 1,
        max: 1000,
      });
    } else if (
      assetLastModified !== null
      && responseLastModified !== null
      && responseLastModified !== assetLastModified
    ) {
      throw new Error('ESI assets changed during fitting capture; please retry');
    }
    for (const asset of assets) {
      if (
        asset.location_id === ship.ship_item_id
        && asset.location_type === 'item'
        && (
          /^(HiSlot|MedSlot|LoSlot|RigSlot|SubSystemSlot)\d$/.test(asset.location_flag)
          || asset.location_flag === 'DroneBay'
        )
      ) {
        fittedItems.push({
          type_id: asset.type_id,
          quantity: Math.max(1, asset.quantity),
          flag: asset.location_flag,
        });
      }
    }
  }

  return security.validateEsiFitting({
    ship_type_id: ship.ship_type_id,
    items: fittedItems,
  });
}

async function getImplants(characterId, accessToken) {
  const response = await getJson(
    `${ESI_BASE}/characters/${characterId}/implants/`,
    authenticatedHeaders(accessToken)
  );
  return security.validateEsiImplants(response);
}

async function getRecentAbyssLoss(characterId, accessToken, startedAt, endedAt) {
  const runStartedAt = security.requireInteger(startedAt, 'Run start time');
  const runEndedAt = security.requireInteger(endedAt, 'Run end time', {
    min: runStartedAt,
    max: Number.MAX_SAFE_INTEGER,
  });
  const references = security.validateEsiKillmailRefs(await getJson(
    `${ESI_BASE}/characters/${characterId}/killmails/recent/?page=1`,
    authenticatedHeaders(accessToken)
  ));
  const detailResults = await Promise.allSettled(references.slice(0, 20).map(reference =>
    getJson(
      `${ESI_BASE}/killmails/${reference.killmail_id}/${reference.killmail_hash}/`
    ).then(security.validateEsiKillmail)
  ));
  const matching = detailResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .filter(killmail => {
      const killedAt = Math.floor(Date.parse(killmail.killmail_time) / 1000);
      return killmail.victim.character_id === characterId
        && killmail.solar_system_id >= ABYSSAL_SYSTEM_MIN
        && killedAt >= runStartedAt - 60
        && killedAt <= runEndedAt + 10 * 60;
    });
  if (matching.length === 0) return null;

  const quantities = new Map();
  const addItem = (typeId, quantity) => {
    quantities.set(typeId, (quantities.get(typeId) || 0) + quantity);
  };
  for (const killmail of matching) {
    if (!CAPSULE_TYPE_IDS.has(killmail.victim.ship_type_id)) {
      addItem(killmail.victim.ship_type_id, 1);
    }
    for (const item of killmail.victim.items) {
      addItem(item.type_id, item.quantity);
    }
  }
  return {
    killmail_ids: matching.map(killmail => killmail.killmail_id),
    items: [...quantities.entries()].map(([type_id, quantity]) => ({ type_id, quantity })),
  };
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
  getRecentAbyssLoss,
  getTypeInfo,
  getSystemName,
  getTypeNames,
  exchangeAuthorizationCode,
  refreshToken,
  verifyToken,
  isEsiUrl,
  clearMetadataCaches,
};
