(function exposeSecurity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssSecurity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const EXTERNAL_URL_RULES = [
    { host: 'login.eveonline.com', path: '/v2/oauth/authorize' },
    { host: 'discord.gg', path: '/janice' },
    { host: 'github.com', path: '/AbyssLog/abysslog/releases' },
  ];

  const PUBLIC_SETTING_KEYS = new Set([
    'active_character',
    'esi_poll_interval',
    'default_tier',
    'default_weather',
  ]);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function requireString(value, label, maxLength = 4096, allowEmpty = false) {
    if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
    if (!allowEmpty && value.length === 0) throw new TypeError(`${label} is required`);
    if (value.length > maxLength) throw new TypeError(`${label} is too long`);
    return value;
  }

  function requireInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
    }
    return number;
  }

  function isAllowedExternalUrl(value) {
    try {
      if (typeof value !== 'string' || value.length > 2048) return false;
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
      return EXTERNAL_URL_RULES.some(rule =>
        url.hostname === rule.host
        && (url.pathname === rule.path || url.pathname.startsWith(`${rule.path}/`))
      );
    } catch {
      return false;
    }
  }

  function parseOAuthCallback(value) {
    requireString(value, 'OAuth callback', 4096);
    const url = new URL(value);
    if (
      url.protocol !== 'eveauth-abysslog:'
      || url.hostname !== 'callback'
      || (url.pathname !== '' && url.pathname !== '/')
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      throw new TypeError('Invalid OAuth callback URL');
    }

    const allowedParams = new Set(['code', 'state', 'error', 'error_description']);
    const seenParams = new Set();
    for (const key of url.searchParams.keys()) {
      if (!allowedParams.has(key)) throw new TypeError('Unexpected OAuth callback parameter');
      if (seenParams.has(key)) throw new TypeError('Duplicate OAuth callback parameter');
      seenParams.add(key);
    }

    const state = requireString(url.searchParams.get('state') || '', 'OAuth state', 256);
    const error = url.searchParams.get('error');
    if (error) {
      return {
        state,
        error: requireString(error, 'OAuth error', 128),
        errorDescription: requireString(
          url.searchParams.get('error_description') || 'Authorization was declined',
          'OAuth error description',
          512
        ),
      };
    }

    return {
      state,
      code: requireString(url.searchParams.get('code') || '', 'OAuth code', 2048),
    };
  }

  function validatePublicSetting(key, value) {
    requireString(key, 'Setting key', 64);
    if (!PUBLIC_SETTING_KEYS.has(key)) throw new TypeError('Setting is not writable');

    const stringValue = requireString(String(value ?? ''), 'Setting value', 128, true);
    if (key === 'active_character' && stringValue !== '') {
      requireInteger(stringValue, 'Active character');
    }
    if (key === 'esi_poll_interval') {
      const interval = requireInteger(stringValue, 'ESI polling interval', { min: 3, max: 300 });
      return String(interval);
    }
    if (key === 'default_tier' && !/^$|^T[1-6]$/.test(stringValue)) {
      throw new TypeError('Default tier is invalid');
    }
    if (key === 'default_weather' && !/^$|^(Electrical|Dark|Exotic|Firestorm|Gamma)$/.test(stringValue)) {
      throw new TypeError('Default weather is invalid');
    }
    return stringValue;
  }

  function validateAppraisalItems(items) {
    if (!Array.isArray(items) || items.length > 500) {
      throw new TypeError('Appraisal items must be an array of at most 500 entries');
    }
    return items.map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`Item ${index + 1} is invalid`);
      const name = requireString(item.name, `Item ${index + 1} name`, 256).trim();
      const qty = requireInteger(item.qty, `Item ${index + 1} quantity`, { min: 1, max: 1_000_000_000 });
      return { name, qty };
    });
  }

  return {
    PUBLIC_SETTING_KEYS,
    escapeHtml,
    isAllowedExternalUrl,
    isPlainObject,
    parseOAuthCallback,
    requireInteger,
    requireString,
    validateAppraisalItems,
    validatePublicSetting,
  };
});
