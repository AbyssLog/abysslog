(function exposeSecurity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssSecurity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const EXTERNAL_URL_RULES = [
    { host: 'login.eveonline.com', path: '/v2/oauth/authorize' },
    { host: 'discord.gg', path: '/janice' },
    { host: 'github.com', path: '/AbyssLog/abysslog' },
  ];

  const PUBLIC_SETTING_KEYS = new Set([
    'active_character',
    'esi_poll_interval',
    'default_tier',
    'default_weather',
  ]);
  const ESI_CAPABILITY_DEFINITIONS = Object.freeze({
    tracking: Object.freeze({
      scopes: Object.freeze([
        'esi-location.read_location.v1',
        'esi-location.read_ship_type.v1',
      ]),
    }),
    fitting: Object.freeze({
      scopes: Object.freeze([
        'esi-location.read_ship_type.v1',
        'esi-assets.read_assets.v1',
      ]),
    }),
    implants: Object.freeze({
      scopes: Object.freeze([
        'esi-clones.read_implants.v1',
      ]),
    }),
    killmails: Object.freeze({
      scopes: Object.freeze([
        'esi-killmails.read_killmails.v1',
      ]),
    }),
  });
  const ESI_CAPABILITY_IDS = new Set(Object.keys(ESI_CAPABILITY_DEFINITIONS));
  const KNOWN_ESI_SCOPES = new Set([
    ...Object.values(ESI_CAPABILITY_DEFINITIONS).flatMap(definition => definition.scopes),
    // Accepted only for tokens issued by older AbyssLog releases.
    'esi-location.read_online.v1',
    'esi-fittings.read_fittings.v1',
  ]);
  const RUN_TIERS = new Set(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Unknown']);
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
  const ACTIVE_RUN_STATES = new Set(['in-abyss', 'awaiting-cargo', 'died']);
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
    if (key === 'default_tier' && !/^$|^T[0-6]$/.test(stringValue)) {
      throw new TypeError('Default tier is invalid');
    }
    if (key === 'default_weather' && !/^$|^(Electrical|Dark|Exotic|Firestorm|Gamma)$/.test(stringValue)) {
      throw new TypeError('Default weather is invalid');
    }
    return stringValue;
  }

  function validateEsiCapabilitySelection(value) {
    const capabilities = requireArray(value, 'ESI capabilities', ESI_CAPABILITY_IDS.size)
      .map((capability, index) =>
        requireEnum(capability, `ESI capability ${index + 1}`, ESI_CAPABILITY_IDS));
    if (new Set(capabilities).size !== capabilities.length) {
      throw new TypeError('ESI capabilities must not contain duplicates');
    }
    return Object.keys(ESI_CAPABILITY_DEFINITIONS)
      .filter(capability => capabilities.includes(capability));
  }

  function getEsiScopesForCapabilities(value) {
    const capabilities = validateEsiCapabilitySelection(value);
    return [...new Set(capabilities.flatMap(
      capability => ESI_CAPABILITY_DEFINITIONS[capability].scopes
    ))];
  }

  function validateEsiScopes(value) {
    const scopes = requireArray(value, 'ESI scopes', KNOWN_ESI_SCOPES.size)
      .map((scope, index) => requireEnum(scope, `ESI scope ${index + 1}`, KNOWN_ESI_SCOPES));
    if (new Set(scopes).size !== scopes.length) {
      throw new TypeError('ESI scopes must not contain duplicates');
    }
    return [...scopes];
  }

  function getEsiCapabilitiesForScopes(value) {
    const grantedScopes = new Set(validateEsiScopes(value));
    return Object.fromEntries(Object.entries(ESI_CAPABILITY_DEFINITIONS).map(
      ([capability, definition]) => [
        capability,
        definition.scopes.every(scope => grantedScopes.has(scope)),
      ]
    ));
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

  function validateKillmailLossItems(items) {
    return requireArray(items, 'Killmail loss items', 1000).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`Killmail loss item ${index + 1} is invalid`);
      assertAllowedKeys(
        item,
        `Killmail loss item ${index + 1}`,
        new Set(['type_id', 'type_name', 'qty'])
      );
      return {
        type_id: requireInteger(item.type_id, `Killmail loss item ${index + 1} type ID`),
        type_name: requireTrimmedText(
          item.type_name,
          `Killmail loss item ${index + 1} name`,
          256
        ),
        qty: requireInteger(item.qty, `Killmail loss item ${index + 1} quantity`, {
          min: 1,
          max: 1_000_000_000,
        }),
      };
    });
  }

  function validateTags(value) {
    const seen = new Set();
    const tags = [];
    for (const [index, tag] of requireArray(value, 'Run tags', 20).entries()) {
      const normalized = requireTrimmedText(tag, 'Run tag ' + (index + 1), 48);
      const key = normalized.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(normalized);
      }
    }
    return tags;
  }

  function validateKillmailIds(value) {
    const ids = requireArray(value, 'Killmail IDs', 20).map(
      (killmailId, index) => requireInteger(killmailId, 'Killmail ID ' + (index + 1))
    );
    return [...new Set(ids)];
  }
  function validateRunData(value) {
    if (!isPlainObject(value)) throw new TypeError('Run must be an object');
    assertAllowedKeys(value, 'Run', new Set([
      'character_id', 'started_at', 'duration', 'tier', 'weather', 'outcome',
      'loot_value', 'consumed_cost', 'net_isk', 'total_loss', 'system_id', 'system_name',
      'cargo_before', 'cargo_after', 'drone_before', 'drone_after',
      'hull_name', 'ship_class', 'notes', 'tags', 'killmail_ids', 'appraised_at',
      'items', 'fitting', 'implants',
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
      system_name: value.system_name == null
        ? null
        : requireText(value.system_name, 'System name', 128, { multiline: false }),
      cargo_before: requireText(value.cargo_before ?? '', 'Pre-run cargo', 512 * 1024),
      cargo_after: requireText(value.cargo_after ?? '', 'Post-run cargo', 512 * 1024),
      drone_before: requireText(value.drone_before ?? '', 'Pre-run drone bay', 512 * 1024),
      drone_after: requireText(value.drone_after ?? '', 'Post-run drone bay', 512 * 1024),
      hull_name: requireText(value.hull_name ?? '', 'Hull type', 256, { multiline: false }),
      ship_class: requireEnum(value.ship_class ?? 'Unknown', 'Ship class', SHIP_CLASSES),
      notes: requireText(value.notes ?? '', 'Run notes', 16 * 1024),
      tags: validateTags(value.tags ?? []),
      killmail_ids: validateKillmailIds(value.killmail_ids ?? []),
      appraised_at: value.appraised_at == null
        ? null
        : requireInteger(value.appraised_at, 'Appraisal time', { min: 0 }),
      items: validateRunItems(value.items ?? []),
      fitting: validateFitting(value.fitting ?? []),
      implants: validateImplants(value.implants ?? []),
    };
  }

  function validateActiveRunSnapshot(value) {
    if (!isPlainObject(value)) throw new TypeError('Active run snapshot must be an object');
    assertAllowedKeys(value, 'Active run snapshot', new Set(['version', 'state', 'run']));
    if (value.version !== 2) throw new TypeError('Active run snapshot version is unsupported');

    const state = requireEnum(value.state, 'Active run state', ACTIVE_RUN_STATES);
    const run = value.run;
    if (!isPlainObject(run)) throw new TypeError('Active run must be an object');
    assertAllowedKeys(run, 'Active run', new Set([
      'character_id', 'started_at', 'duration', 'tier', 'weather', 'outcome',
      'system_id', 'system_name', 'cargoBefore', 'cargoAfter', 'droneBefore', 'droneAfter',
      'hull_name', 'ship_class', 'notes', 'tags', 'fitting', 'implants', 'fitCaptured',
      'killmailItems', 'killmailIds',
    ]));

    const expectedOutcome = state === 'in-abyss'
      ? null
      : state === 'died' ? 'Died' : 'Survived';
    if (run.outcome !== expectedOutcome) {
      throw new TypeError('Active run outcome does not match its state');
    }
    if (typeof run.fitCaptured !== 'boolean') {
      throw new TypeError('Active run fitting status must be a boolean');
    }

    return {
      version: 2,
      state,
      run: {
        character_id: requireInteger(run.character_id, 'Character ID'),
        started_at: requireInteger(run.started_at, 'Run start', { min: 0 }),
        duration: requireInteger(run.duration ?? 0, 'Run duration', {
          min: 0,
          max: 604_800,
        }),
        tier: requireEnum(run.tier, 'Run tier', RUN_TIERS),
        weather: requireEnum(run.weather, 'Run weather', RUN_WEATHERS),
        outcome: expectedOutcome,
        system_id: run.system_id == null
          ? null
          : requireInteger(run.system_id, 'System ID'),
        system_name: run.system_name == null
          ? null
          : requireText(run.system_name, 'System name', 128, { multiline: false }),
        cargoBefore: requireText(run.cargoBefore ?? '', 'Pre-run cargo', 512 * 1024),
        cargoAfter: requireText(run.cargoAfter ?? '', 'Post-run cargo', 512 * 1024),
        droneBefore: requireText(run.droneBefore ?? '', 'Pre-run drone bay', 512 * 1024),
        droneAfter: requireText(run.droneAfter ?? '', 'Post-run drone bay', 512 * 1024),
        hull_name: requireText(run.hull_name ?? '', 'Hull type', 256, {
          multiline: false,
        }),
        ship_class: requireEnum(run.ship_class ?? 'Unknown', 'Ship class', SHIP_CLASSES),
        notes: requireText(run.notes ?? '', 'Run notes', 16 * 1024),
        tags: validateTags(run.tags ?? []),
        fitting: validateFitting(run.fitting ?? []),
        implants: validateImplants(run.implants ?? []),
        fitCaptured: run.fitCaptured,
        killmailItems: validateKillmailLossItems(run.killmailItems ?? []),
        killmailIds: validateKillmailIds(run.killmailIds ?? []),
      },
    };
  }

  function validateEsiLocation(value) {
    if (!isPlainObject(value)) throw new TypeError('ESI location response is invalid');
    return {
      solar_system_id: requireInteger(value.solar_system_id, 'Solar system ID'),
    };
  }

  function validateEsiShip(value) {
    if (!isPlainObject(value)) throw new TypeError('ESI ship response is invalid');
    return {
      ship_item_id: requireInteger(value.ship_item_id, 'Ship item ID'),
      ship_type_id: requireInteger(value.ship_type_id, 'Ship type ID'),
    };
  }

  function validateEsiAssets(value) {
    return requireArray(value, 'ESI assets', 1000).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`ESI asset ${index + 1} is invalid`);
      if (typeof item.is_singleton !== 'boolean') {
        throw new TypeError(`ESI asset ${index + 1} singleton status must be a boolean`);
      }
      return {
        item_id: requireInteger(item.item_id, `ESI asset ${index + 1} item ID`),
        location_id: requireInteger(item.location_id, `ESI asset ${index + 1} location ID`),
        location_type: requireText(
          item.location_type,
          `ESI asset ${index + 1} location type`,
          32,
          { multiline: false }
        ),
        location_flag: requireText(
          item.location_flag,
          `ESI asset ${index + 1} location flag`,
          64,
          { multiline: false }
        ),
        type_id: requireInteger(item.type_id, `ESI asset ${index + 1} type ID`),
        quantity: requireInteger(item.quantity, `ESI asset ${index + 1} quantity`, {
          min: -2,
          max: 1_000_000_000,
        }),
        is_singleton: item.is_singleton,
      };
    });
  }

  function validateEsiKillmailRefs(value) {
    return requireArray(value, 'ESI killmail references', 50).map((item, index) => {
      if (!isPlainObject(item)) {
        throw new TypeError(`ESI killmail reference ${index + 1} is invalid`);
      }
      const hash = requireTrimmedText(
        item.killmail_hash,
        `ESI killmail reference ${index + 1} hash`,
        128
      );
      if (!/^[A-Za-z0-9_-]+$/.test(hash)) {
        throw new TypeError(`ESI killmail reference ${index + 1} hash is invalid`);
      }
      return {
        killmail_id: requireInteger(
          item.killmail_id,
          `ESI killmail reference ${index + 1} ID`
        ),
        killmail_hash: hash,
      };
    });
  }

  function validateEsiKillmail(value) {
    if (!isPlainObject(value) || !isPlainObject(value.victim)) {
      throw new TypeError('ESI killmail response is invalid');
    }
    const killmailTime = requireString(value.killmail_time, 'Killmail time', 64);
    if (!Number.isFinite(Date.parse(killmailTime))) {
      throw new TypeError('Killmail time is invalid');
    }

    let itemCount = 0;
    const flattenItems = (items, depth = 0) => {
      if (depth > 4) throw new TypeError('ESI killmail item nesting is too deep');
      const flattened = [];
      for (const [index, item] of requireArray(items ?? [], 'ESI killmail items', 10_000).entries()) {
        if (!isPlainObject(item)) throw new TypeError(`ESI killmail item ${index + 1} is invalid`);
        itemCount++;
        if (itemCount > 10_000) throw new TypeError('ESI killmail contains too many items');
        const destroyed = item.quantity_destroyed == null
          ? 0
          : requireInteger(item.quantity_destroyed, 'Destroyed item quantity', {
            min: 0,
            max: 1_000_000_000,
          });
        const dropped = item.quantity_dropped == null
          ? 0
          : requireInteger(item.quantity_dropped, 'Dropped item quantity', {
            min: 0,
            max: 1_000_000_000,
          });
        flattened.push({
          type_id: requireInteger(item.item_type_id, 'Killmail item type ID'),
          quantity: Math.max(1, destroyed + dropped),
        });
        flattened.push(...flattenItems(item.items, depth + 1));
      }
      return flattened;
    };

    return {
      killmail_id: requireInteger(value.killmail_id, 'Killmail ID'),
      killmail_time: killmailTime,
      solar_system_id: requireInteger(value.solar_system_id, 'Killmail solar system ID'),
      victim: {
        character_id: requireInteger(value.victim.character_id, 'Killmail victim character ID'),
        ship_type_id: requireInteger(value.victim.ship_type_id, 'Killmail victim ship type ID'),
        items: flattenItems(value.victim.items),
      },
    };
  }

  function validateEsiFitting(value) {
    if (!isPlainObject(value)) throw new TypeError('ESI fitting response is invalid');
    const items = requireArray(value.items, 'ESI fitting items', 1000).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`ESI fitting item ${index + 1} is invalid`);
      return {
        type_id: requireInteger(item.type_id, `ESI fitting item ${index + 1} type ID`),
        quantity: requireInteger(item.quantity, `ESI fitting item ${index + 1} quantity`, {
          min: 1,
          max: 1_000_000_000,
        }),
        flag: requireText(item.flag ?? '', `ESI fitting item ${index + 1} flag`, 64, {
          multiline: false,
        }),
      };
    });
    return {
      ship_type_id: requireInteger(value.ship_type_id, 'Fitted ship type ID'),
      items,
    };
  }

  function validateEsiImplants(value) {
    return requireArray(value, 'ESI implants', 64).map((typeId, index) =>
      requireInteger(typeId, `ESI implant ${index + 1} type ID`));
  }

  function validateEsiSystem(value) {
    if (!isPlainObject(value)) throw new TypeError('ESI system response is invalid');
    return {
      name: requireTrimmedText(value.name, 'Solar system name', 128),
    };
  }

  function validateEsiType(value) {
    if (!isPlainObject(value)) throw new TypeError('ESI type response is invalid');
    return {
      group_id: requireInteger(value.group_id, 'Type group ID'),
      name: requireTrimmedText(value.name, 'Type name', 256),
    };
  }

  function validateEsiNames(value) {
    return requireArray(value, 'ESI names', 1000).map((item, index) => {
      if (!isPlainObject(item)) throw new TypeError(`ESI name ${index + 1} is invalid`);
      return {
        id: requireInteger(item.id, `ESI name ${index + 1} ID`),
        name: requireTrimmedText(item.name, `ESI name ${index + 1}`, 256),
      };
    });
  }

  function validateEsiTokenIdentity(value) {
    if (!isPlainObject(value)) throw new TypeError('EVE token identity is invalid');
    return {
      CharacterID: requireInteger(value.CharacterID, 'Character ID'),
      CharacterName: requireTrimmedText(value.CharacterName, 'Character name', 128),
    };
  }

  function validateOAuthTokenResponse(value, { requireRefreshToken = false } = {}) {
    if (!isPlainObject(value)) throw new TypeError('OAuth token response is invalid');
    const refreshToken = value.refresh_token == null
      ? null
      : requireString(value.refresh_token, 'Refresh token', 16 * 1024);
    if (requireRefreshToken && !refreshToken) {
      throw new TypeError('OAuth refresh token is required');
    }
    return {
      access_token: requireString(value.access_token, 'Access token', 16 * 1024),
      refresh_token: refreshToken,
      expires_in: requireInteger(value.expires_in, 'Token lifetime', {
        min: 1,
        max: 86_400,
      }),
    };
  }

  function validateRunFilters(value) {
    if (!isPlainObject(value)) throw new TypeError('Run filters must be an object');
    assertAllowedKeys(value, 'Run filters', new Set([
      'character_id', 'tier', 'weather', 'outcome', 'limit',
      'search', 'date_from', 'date_to', 'hull', 'hull_name', 'ship_class',
      'fit_identity_id', 'tag',
    ]));
    const filters = {};
    if (value.character_id != null && value.character_id !== '') {
      filters.character_id = requireInteger(value.character_id, 'Character ID');
    }
    if (value.tier) filters.tier = requireEnum(value.tier, 'Run tier', RUN_TIERS);
    if (value.weather) filters.weather = requireEnum(value.weather, 'Run weather', RUN_WEATHERS);
    if (value.outcome) filters.outcome = requireEnum(value.outcome, 'Run outcome', RUN_OUTCOMES);
    if (value.search != null && String(value.search).trim()) {
      filters.search = requireText(value.search, 'Run search', 256, { multiline: false }).trim();
    }
    if (value.date_from != null && value.date_from !== '') {
      filters.date_from = requireInteger(value.date_from, 'Run date start', { min: 0 });
    }
    if (value.date_to != null && value.date_to !== '') {
      filters.date_to = requireInteger(value.date_to, 'Run date end', { min: 1 });
    }
    if (
      filters.date_from != null
      && filters.date_to != null
      && filters.date_to <= filters.date_from
    ) {
      throw new TypeError('Run date end must be after its start');
    }
    if (value.hull != null && String(value.hull).trim()) {
      filters.hull = requireText(value.hull, 'Hull filter', 256, { multiline: false }).trim();
    }
    if (value.hull_name != null && String(value.hull_name).trim()) {
      filters.hull_name = requireText(
        value.hull_name, 'Hull type filter', 256, { multiline: false }
      ).trim();
    }
    if (value.ship_class) {
      filters.ship_class = requireEnum(value.ship_class, 'Hull class filter', SHIP_CLASSES);
    }
    if (value.fit_identity_id != null) {
      filters.fit_identity_id = requireInteger(value.fit_identity_id, 'Fit identity ID');
    }
    if (value.tag != null && String(value.tag).trim()) {
      filters.tag = requireTrimmedText(value.tag, 'Tag filter', 48);
    }
    if (value.limit != null) {
      filters.limit = requireInteger(value.limit, 'Run limit', { min: 1, max: 1000 });
    }
    return filters;
  }
  function validateStatsFilters(value) {
    if (!isPlainObject(value)) throw new TypeError('Statistics filters must be an object');
    assertAllowedKeys(value, 'Statistics filters', new Set([
      'character_id', 'range_start', 'range_end',
    ]));
    const filters = {};
    if (value.character_id != null && value.character_id !== '') {
      filters.character_id = requireInteger(value.character_id, 'Character ID');
    }
    if (value.range_start != null) {
      filters.range_start = requireInteger(value.range_start, 'Statistics range start', { min: 0 });
    }
    if (value.range_end != null) {
      filters.range_end = requireInteger(value.range_end, 'Statistics range end', { min: 1 });
    }
    if (
      filters.range_start != null
      && filters.range_end != null
      && filters.range_end <= filters.range_start
    ) {
      throw new TypeError('Statistics range end must be after its start');
    }
    return filters;
  }

  function validateRunMeta(value) {
    if (!isPlainObject(value)) throw new TypeError('Run update must be an object');
    assertAllowedKeys(value, 'Run update', new Set([
      'tier', 'weather', 'outcome', 'duration', 'started_at',
      'total_loss', 'hull_name', 'ship_class', 'system_id', 'system_name',
      'notes', 'tags',
    ]));
    return {
      tier: requireEnum(value.tier, 'Run tier', RUN_TIERS),
      weather: requireEnum(value.weather, 'Run weather', RUN_WEATHERS),
      outcome: requireEnum(value.outcome, 'Run outcome', RUN_OUTCOMES),
      duration: requireInteger(value.duration, 'Run duration', { min: 0, max: 604_800 }),
      started_at: requireInteger(value.started_at, 'Run start', { min: 0 }),
      total_loss: requireFiniteNumber(value.total_loss ?? 0, 'Total loss', { min: 0 }),
      hull_name: value.hull_name === undefined
        ? null
        : requireText(value.hull_name, 'Hull type', 256, { multiline: false }),
      ship_class: value.ship_class === undefined
        ? null
        : requireEnum(value.ship_class, 'Ship class', SHIP_CLASSES),
      system_id: value.system_id == null
        ? null
        : requireInteger(value.system_id, 'System ID'),
      system_name: value.system_name === undefined
        ? null
        : requireText(value.system_name, 'System name', 128, { multiline: false }),
      notes: value.notes === undefined
        ? null
        : requireText(value.notes, 'Run notes', 16 * 1024),
      tags: value.tags === undefined ? null : validateTags(value.tags),
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
      'drone_before', 'drone_after', 'items', 'appraised_at',
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
      appraised_at: value.appraised_at == null
        ? null
        : requireInteger(value.appraised_at, 'Appraisal time', { min: 0 }),
    };
  }

  function validateRunEdit(value) {
    if (!isPlainObject(value)) throw new TypeError('Run edit must be an object');
    assertAllowedKeys(value, 'Run edit', new Set(['meta', 'cargo', 'appraisal']));
    const hasCargo = value.cargo !== undefined;
    const hasAppraisal = value.appraisal !== undefined;
    if (hasCargo === hasAppraisal) {
      throw new TypeError('Run edit must contain exactly one cargo or appraisal update');
    }
    return {
      meta: validateRunMeta(value.meta),
      cargo: hasCargo ? validateCargoUpdate(value.cargo) : null,
      appraisal: hasAppraisal ? validateAppraisalUpdate(value.appraisal) : null,
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
    ESI_CAPABILITY_DEFINITIONS,
    PUBLIC_SETTING_KEYS,
    escapeCsvCell,
    escapeHtml,
    getEsiCapabilitiesForScopes,
    getEsiScopesForCapabilities,
    isAllowedExternalUrl,
    isPlainObject,
    parseOAuthCallback,
    requireFiniteNumber,
    requireInteger,
    requireString,
    requireText,
    requireTrimmedText,
    unescapeCsvCell,
    validateActiveRunSnapshot,
    validateAppraisalItems,
    validateAppraisalUpdate,
    validateCargoUpdate,
    validateEsiAssets,
    validateEsiCapabilitySelection,
    validateEsiFitting,
    validateEsiImplants,
    validateEsiKillmail,
    validateEsiKillmailRefs,
    validateEsiLocation,
    validateEsiNames,
    validateEsiShip,
    validateEsiScopes,
    validateEsiSystem,
    validateEsiTokenIdentity,
    validateEsiType,
    validateJaniceResponse,
    validateOAuthTokenResponse,
    validatePublicSetting,
    validateRunData,
    validateRunEdit,
    validateRunFilters,
    validateStatsFilters,
    validateRunMeta,
  };
});
