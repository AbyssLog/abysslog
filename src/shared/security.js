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
  const RUN_TIERS = new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Unknown']);
  const RUN_WEATHERS = new Set([
    'Electrical',
    'Dark',
    'Exotic',
    'Firestorm',
    'Gamma',
    'Unknown',
  ]);
  const RUN_OUTCOMES = new Set(['Survived', 'Died']);
  const SHIP_CLASSES = new Set(['Frigate', 'Destroyer', 'Cruiser', 'Unknown']);
  const RUN_ITEM_TYPES = new Set(['gained', 'consumed', 'lost']);
  const MAX_MONEY_VALUE = 1_000_000_000_000_000_000;

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

  function requireFiniteNumber(value, label, { min = -MAX_MONEY_VALUE, max = MAX_MONEY_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new TypeError(`${label} must be a finite number between ${min} and ${max}`);
    }
    return value;
  }

  function requireText(value, label, maxLength, { allowEmpty = true, multiline = true } = {}) {
    const text = requireString(value, label, maxLength, allowEmpty);
    const forbidden = multiline
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
      : /[\u0000-\u001f\u007f]/;
    if (forbidden.test(text)) throw new TypeError(`${label} contains unsupported control characters`);
    return text;
  }

  function requireTrimmedText(value, label, maxLength) {
    const text = requireText(value, label, maxLength, { multiline: false }).trim();
    if (!text) throw new TypeError(`${label} is required`);
    return text;
  }

  function requireEnum(value, label, allowed) {
    const text = requireTrimmedText(value, label, 64);
    if (!allowed.has(text)) throw new TypeError(`${label} is invalid`);
    return text;
  }

  function requireArray(value, label, maxLength) {
    if (!Array.isArray(value) || value.length > maxLength) {
      throw new TypeError(`${label} must be an array of at most ${maxLength} entries`);
    }
    return value;
  }

  function assertAllowedKeys(value, label, allowedKeys) {
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) throw new TypeError(`${label} contains an unexpected field`);
    }
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
    return requireArray(items, 'Appraisal items', 500).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`Item ${index + 1} is invalid`);
      assertAllowedKeys(item, `Item ${index + 1}`, new Set(['name', 'qty']));
      const name = requireTrimmedText(item.name, `Item ${index + 1} name`, 256);
      const qty = requireInteger(item.qty, `Item ${index + 1} quantity`, { min: 1, max: 1_000_000_000 });
      return { name, qty };
    });
  }

  function validateRunItems(items, allowedTypes = RUN_ITEM_TYPES) {
    return requireArray(items, 'Run items', 1500).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`Run item ${index + 1} is invalid`);
      assertAllowedKeys(
        item,
        `Run item ${index + 1}`,
        new Set(['item_name', 'qty', 'type', 'unit_price_buy', 'unit_price_sell'])
      );
      return {
        item_name: requireTrimmedText(item.item_name, `Run item ${index + 1} name`, 256),
        qty: requireInteger(item.qty, `Run item ${index + 1} quantity`, {
          min: 1,
          max: 1_000_000_000,
        }),
        type: requireEnum(item.type, `Run item ${index + 1} type`, allowedTypes),
        unit_price_buy: requireFiniteNumber(
          item.unit_price_buy ?? 0,
          `Run item ${index + 1} buy price`,
          { min: 0 }
        ),
        unit_price_sell: requireFiniteNumber(
          item.unit_price_sell ?? 0,
          `Run item ${index + 1} sell price`,
          { min: 0 }
        ),
      };
    });
  }

  function validateFitting(fitting) {
    return requireArray(fitting, 'Fitting', 500).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`Fitting item ${index + 1} is invalid`);
      assertAllowedKeys(
        item,
        `Fitting item ${index + 1}`,
        new Set(['type_id', 'type_name', 'qty', 'slot', 'unit_price_sell'])
      );
      return {
        type_id: requireInteger(item.type_id, `Fitting item ${index + 1} type ID`),
        type_name: requireTrimmedText(item.type_name, `Fitting item ${index + 1} name`, 256),
        qty: requireInteger(item.qty ?? 1, `Fitting item ${index + 1} quantity`, {
          min: 1,
          max: 1_000_000_000,
        }),
        slot: item.slot == null || item.slot === ''
          ? null
          : requireTrimmedText(item.slot, `Fitting item ${index + 1} slot`, 64),
        unit_price_sell: requireFiniteNumber(
          item.unit_price_sell ?? 0,
          `Fitting item ${index + 1} sell price`,
          { min: 0 }
        ),
      };
    });
  }

  function validateImplants(implants) {
    return requireArray(implants, 'Implants', 64).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`Implant ${index + 1} is invalid`);
      assertAllowedKeys(
        item,
        `Implant ${index + 1}`,
        new Set(['type_id', 'type_name', 'slot', 'unit_price_sell'])
      );
      return {
        type_id: requireInteger(item.type_id, `Implant ${index + 1} type ID`),
        type_name: requireTrimmedText(item.type_name, `Implant ${index + 1} name`, 256),
        slot: item.slot == null || item.slot === ''
          ? null
          : requireInteger(item.slot, `Implant ${index + 1} slot`, { min: 1, max: 100 }),
        unit_price_sell: requireFiniteNumber(
          item.unit_price_sell ?? 0,
          `Implant ${index + 1} sell price`,
          { min: 0 }
        ),
      };
    });
  }

  function validateRunData(value) {
    if (!isPlainObject(value)) throw new TypeError('Run must be an object');
    assertAllowedKeys(value, 'Run', new Set([
      'character_id', 'started_at', 'duration', 'tier', 'weather', 'outcome',
      'loot_value', 'consumed_cost', 'net_isk', 'total_loss', 'system_id',
      'cargo_before', 'cargo_after', 'drone_before', 'drone_after',
      'ship_name', 'ship_class', 'notes', 'items', 'fitting', 'implants',
    ]));
    return {
      character_id: requireInteger(value.character_id, 'Character ID'),
      started_at: requireInteger(value.started_at, 'Run start', { min: 0 }),
      duration: requireInteger(value.duration ?? 0, 'Run duration', { min: 0, max: 604_800 }),
      tier: requireEnum(value.tier, 'Run tier', RUN_TIERS),
      weather: requireEnum(value.weather, 'Run weather', RUN_WEATHERS),
      outcome: requireEnum(value.outcome, 'Run outcome', RUN_OUTCOMES),
      loot_value: requireFiniteNumber(value.loot_value ?? 0, 'Loot value', { min: 0 }),
      consumed_cost: requireFiniteNumber(value.consumed_cost ?? 0, 'Consumed cost', { min: 0 }),
      net_isk: requireFiniteNumber(value.net_isk ?? 0, 'Net ISK'),
      total_loss: requireFiniteNumber(value.total_loss ?? 0, 'Total loss', { min: 0 }),
      system_id: value.system_id == null
        ? null
        : requireInteger(value.system_id, 'System ID'),
      cargo_before: requireText(value.cargo_before ?? '', 'Pre-run cargo', 512 * 1024),
      cargo_after: requireText(value.cargo_after ?? '', 'Post-run cargo', 512 * 1024),
      drone_before: requireText(value.drone_before ?? '', 'Pre-run drone bay', 512 * 1024),
      drone_after: requireText(value.drone_after ?? '', 'Post-run drone bay', 512 * 1024),
      ship_name: requireText(value.ship_name ?? '', 'Ship name', 256, { multiline: false }),
      ship_class: requireEnum(value.ship_class ?? 'Unknown', 'Ship class', SHIP_CLASSES),
      notes: requireText(value.notes ?? '', 'Run notes', 16 * 1024),
      items: validateRunItems(value.items ?? []),
      fitting: validateFitting(value.fitting ?? []),
      implants: validateImplants(value.implants ?? []),
    };
  }

  function validateRunFilters(value) {
    if (!isPlainObject(value)) throw new TypeError('Run filters must be an object');
    assertAllowedKeys(value, 'Run filters', new Set([
      'character_id', 'tier', 'weather', 'outcome', 'limit',
    ]));
    const filters = {};
    if (value.character_id != null && value.character_id !== '') {
      filters.character_id = requireInteger(value.character_id, 'Character ID');
    }
    if (value.tier) filters.tier = requireEnum(value.tier, 'Run tier', RUN_TIERS);
    if (value.weather) filters.weather = requireEnum(value.weather, 'Run weather', RUN_WEATHERS);
    if (value.outcome) filters.outcome = requireEnum(value.outcome, 'Run outcome', RUN_OUTCOMES);
    if (value.limit != null) {
      filters.limit = requireInteger(value.limit, 'Run limit', { min: 1, max: 1000 });
    }
    return filters;
  }

  function validateRunMeta(value) {
    if (!isPlainObject(value)) throw new TypeError('Run update must be an object');
    assertAllowedKeys(value, 'Run update', new Set([
      'tier', 'weather', 'outcome', 'duration', 'started_at',
      'total_loss', 'ship_name', 'ship_class',
    ]));
    return {
      tier: requireEnum(value.tier, 'Run tier', RUN_TIERS),
      weather: requireEnum(value.weather, 'Run weather', RUN_WEATHERS),
      outcome: requireEnum(value.outcome, 'Run outcome', RUN_OUTCOMES),
      duration: requireInteger(value.duration, 'Run duration', { min: 0, max: 604_800 }),
      started_at: requireInteger(value.started_at, 'Run start', { min: 0 }),
      total_loss: requireFiniteNumber(value.total_loss ?? 0, 'Total loss', { min: 0 }),
      ship_name: value.ship_name === undefined
        ? null
        : requireText(value.ship_name, 'Ship name', 256, { multiline: false }),
      ship_class: value.ship_class === undefined
        ? null
        : requireEnum(value.ship_class, 'Ship class', SHIP_CLASSES),
    };
  }

  function validateCargoUpdate(value) {
    if (!isPlainObject(value)) throw new TypeError('Cargo update must be an object');
    assertAllowedKeys(value, 'Cargo update', new Set([
      'cargo_before', 'cargo_after', 'drone_before', 'drone_after',
    ]));
    return {
      cargo_before: requireText(value.cargo_before ?? '', 'Pre-run cargo', 512 * 1024),
      cargo_after: requireText(value.cargo_after ?? '', 'Post-run cargo', 512 * 1024),
      drone_before: requireText(value.drone_before ?? '', 'Pre-run drone bay', 512 * 1024),
      drone_after: requireText(value.drone_after ?? '', 'Post-run drone bay', 512 * 1024),
    };
  }

  function validateAppraisalUpdate(value) {
    if (!isPlainObject(value)) throw new TypeError('Appraisal update must be an object');
    assertAllowedKeys(value, 'Appraisal update', new Set([
      'loot_value', 'consumed_cost', 'net_isk', 'cargo_before', 'cargo_after',
      'drone_before', 'drone_after', 'items',
    ]));
    return {
      loot_value: requireFiniteNumber(value.loot_value ?? 0, 'Loot value', { min: 0 }),
      consumed_cost: requireFiniteNumber(value.consumed_cost ?? 0, 'Consumed cost', { min: 0 }),
      net_isk: requireFiniteNumber(value.net_isk ?? 0, 'Net ISK'),
      cargo_before: requireText(value.cargo_before ?? '', 'Pre-run cargo', 512 * 1024),
      cargo_after: requireText(value.cargo_after ?? '', 'Post-run cargo', 512 * 1024),
      drone_before: value.drone_before === undefined
        ? null
        : requireText(value.drone_before, 'Pre-run drone bay', 512 * 1024),
      drone_after: value.drone_after === undefined
        ? null
        : requireText(value.drone_after, 'Post-run drone bay', 512 * 1024),
      items: validateRunItems(value.items ?? []),
    };
  }

  function validateJaniceResponse(value) {
    if (!isPlainObject(value)) throw new TypeError('Janice response is invalid');
    const rawItems = requireArray(value.items, 'Janice response items', 1000);
    const items = rawItems.map((item, index) => {
      if (!isPlainObject(item) || !isPlainObject(item.itemType) || !isPlainObject(item.effectivePrices)) {
        throw new TypeError(`Janice response item ${index + 1} is invalid`);
      }
      return {
        itemType: {
          name: requireTrimmedText(item.itemType.name, `Janice response item ${index + 1} name`, 256),
        },
        amount: requireInteger(item.amount, `Janice response item ${index + 1} amount`, {
          min: 1,
          max: 1_000_000_000,
        }),
        effectivePrices: {
          buyPrice: requireFiniteNumber(
            item.effectivePrices.buyPrice,
            `Janice response item ${index + 1} buy price`,
            { min: 0 }
          ),
          sellPrice: requireFiniteNumber(
            item.effectivePrices.sellPrice,
            `Janice response item ${index + 1} sell price`,
            { min: 0 }
          ),
          buyPriceTotal: requireFiniteNumber(
            item.effectivePrices.buyPriceTotal,
            `Janice response item ${index + 1} total buy price`,
            { min: 0 }
          ),
          sellPriceTotal: requireFiniteNumber(
            item.effectivePrices.sellPriceTotal,
            `Janice response item ${index + 1} total sell price`,
            { min: 0 }
          ),
        },
        buyOrderCount: requireInteger(item.buyOrderCount ?? 0, 'Janice buy order count', {
          min: 0,
        }),
        sellOrderCount: requireInteger(item.sellOrderCount ?? 0, 'Janice sell order count', {
          min: 0,
        }),
      };
    });
    if (!isPlainObject(value.effectivePrices)) throw new TypeError('Janice response totals are invalid');
    return {
      items,
      effectivePrices: {
        totalBuyPrice: requireFiniteNumber(
          value.effectivePrices.totalBuyPrice,
          'Janice total buy price',
          { min: 0 }
        ),
        totalSellPrice: requireFiniteNumber(
          value.effectivePrices.totalSellPrice,
          'Janice total sell price',
          { min: 0 }
        ),
      },
      failures: typeof value.failures === 'string'
        ? requireText(value.failures, 'Janice failures', 4096)
        : '',
      datasetTime: typeof value.datasetTime === 'string'
        ? requireText(value.datasetTime, 'Janice dataset time', 128, { multiline: false })
        : '',
    };
  }

  function escapeCsvCell(value) {
    if (value == null) return '';
    let text = String(value);
    if (typeof value === 'string' && text.startsWith("'")) {
      text = `'${text}`;
    } else if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) {
      text = `'${text}`;
    }
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function unescapeCsvCell(value) {
    if (typeof value !== 'string') return value;
    if (value.startsWith("''")) return value.slice(1);
    if (value.startsWith("'") && /^\s*[=+\-@]/.test(value.slice(1))) return value.slice(1);
    return value;
  }

  return {
    PUBLIC_SETTING_KEYS,
    escapeCsvCell,
    escapeHtml,
    isAllowedExternalUrl,
    isPlainObject,
    parseOAuthCallback,
    requireFiniteNumber,
    requireInteger,
    requireString,
    requireText,
    requireTrimmedText,
    unescapeCsvCell,
    validateAppraisalItems,
    validateAppraisalUpdate,
    validateCargoUpdate,
    validateJaniceResponse,
    validatePublicSetting,
    validateRunData,
    validateRunFilters,
    validateRunMeta,
  };
});
