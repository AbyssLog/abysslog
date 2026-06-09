const https = require('https');

const ESI_BASE = 'https://esi.evetech.net/latest';
const SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify';

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'AbyssLog/1.0', ...headers } };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON: ' + data)); }
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'AbyssLog/1.0',
        ...headers
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON: ' + data)); }
        }
      });
    });
    req.on('error', reject);
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
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const items = JSON.parse(data);
          const map = {};
          for (const item of items) map[item.id] = item.name;
          resolve(map);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
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
  refreshToken,
  verifyToken
};
