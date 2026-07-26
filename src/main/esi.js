const https = require('https');

const ESI_BASE = 'https://esi.evetech.net/latest';
const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function readJsonResponse(res, resolve, reject, label) {
  let data = '';
  res.setEncoding('utf8');
  res.on('data', chunk => {
    data += chunk;
    if (data.length > MAX_RESPONSE_BYTES) res.destroy(new Error(`${label} response is too large`));
  });
  res.on('end', () => {
    if (res.statusCode >= 400) {
      reject(new Error(`${label} request failed with HTTP ${res.statusCode}`));
      return;
    }
    try {
      resolve(JSON.parse(data));
    } catch {
      reject(new Error(`${label} returned invalid JSON`));
    }
  });
  res.on('error', reject);
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'AbyssLog/1.0', ...headers } };
    const req = https.get(url, options, res => readJsonResponse(res, resolve, reject, 'ESI'));
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('ESI request timed out')));
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'AbyssLog/1.0',
        ...headers
      }
    };
    const req = https.request(options, res => readJsonResponse(res, resolve, reject, 'EVE SSO'));
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('EVE SSO request timed out')));
    req.write(postData);
    req.end();
  });
}

async function getLocation(characterId, accessToken) {
  return httpGet(`${ESI_BASE}/characters/${characterId}/location/`, {
    Authorization: `Bearer ${accessToken}`
  });
}

async function getShip(characterId, accessToken) {
  return httpGet(`${ESI_BASE}/characters/${characterId}/ship/`, {
    Authorization: `Bearer ${accessToken}`
  });
}

async function getFitting(characterId, accessToken) {
  // Returns current ship fitting with modules, charges, drones
  return httpGet(`${ESI_BASE}/characters/${characterId}/fit/`, {
    Authorization: `Bearer ${accessToken}`
  });
}

async function getImplants(characterId, accessToken) {
  // Returns array of type IDs for currently active implants
  return httpGet(`${ESI_BASE}/characters/${characterId}/implants/`, {
    Authorization: `Bearer ${accessToken}`
  });
}

async function getTypeInfo(typeId) {
  // Returns type info including group_id for ship class detection
  return httpGet(`${ESI_BASE}/universe/types/${typeId}/`);
}

async function getSystemName(systemId) {
  try {
    const data = await httpGet(`${ESI_BASE}/universe/systems/${systemId}/`);
    return data.name || String(systemId);
  } catch (e) {
    return String(systemId);
  }
}

async function getTypeNames(typeIds) {
  // Batch resolve type IDs to names via universe/names
  if (!typeIds || typeIds.length === 0) return {};
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(typeIds);
    const urlObj = new URL(`${ESI_BASE}/universe/names/`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'AbyssLog/1.0'
      }
    };
    const req = https.request(options, res => {
      readJsonResponse(res, items => {
        const map = {};
        for (const item of items) map[item.id] = item.name;
        resolve(map);
      }, reject, 'ESI');
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('ESI request timed out')));
    req.write(body);
    req.end();
  });
}

async function exchangeAuthorizationCode(code, clientId, codeVerifier, redirectUri) {
  return httpPost(SSO_TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
}

async function refreshToken(refreshToken, clientId) {
  return httpPost(SSO_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId
  }, {
    'Content-Type': 'application/x-www-form-urlencoded'
  });
}

async function verifyToken(accessToken) {
  return httpGet(SSO_VERIFY_URL, {
    Authorization: `Bearer ${accessToken}`
  });
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
  verifyToken
};
