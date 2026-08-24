(function exposeStatisticsReport(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssStatisticsReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const REPORT_VERSION = 1;
  const RUN_TIERS = new Set(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Unknown']);
  const RUN_WEATHERS = new Set([
    'Electrical', 'Dark', 'Exotic', 'Firestorm', 'Gamma', 'Unknown',
  ]);
  const RUN_OUTCOMES = new Set(['Survived', 'Died']);
  const MODES = Object.freeze({
    runs: Object.freeze({
      label: 'Run Performance',
      dimensions: Object.freeze(['tier', 'weather', 'hull', 'fit', 'outcome']),
      metrics: Object.freeze([
        'runs', 'survived', 'died', 'survival_pct',
        'duration_avg', 'duration_min', 'duration_max', 'net_avg', 'net_total',
      ]),
    }),
    drops: Object.freeze({
      label: 'Item Drops',
      dimensions: Object.freeze(['tier', 'weather', 'hull', 'fit']),
      metrics: Object.freeze([
        'observed_runs', 'drop_runs', 'drop_rate', 'total_qty',
        'qty_per_run', 'drop_min', 'drop_max',
      ]),
    }),
  });
  const DIMENSIONS = Object.freeze({
    item: Object.freeze({ label: 'Item' }),
    tier: Object.freeze({ label: 'Tier' }),
    weather: Object.freeze({ label: 'Weather' }),
    hull: Object.freeze({ label: 'Hull' }),
    fit: Object.freeze({ label: 'Fit' }),
    outcome: Object.freeze({ label: 'Outcome' }),
  });
  const METRICS = Object.freeze({
    runs: Object.freeze({ label: 'Runs', format: 'integer' }),
    survived: Object.freeze({ label: 'Survived', format: 'integer' }),
    died: Object.freeze({ label: 'Died', format: 'integer' }),
    survival_pct: Object.freeze({ label: 'Survival %', format: 'percent' }),
    duration_avg: Object.freeze({ label: 'Avg Duration', format: 'duration' }),
    duration_min: Object.freeze({ label: 'Min Duration', format: 'duration' }),
    duration_max: Object.freeze({ label: 'Max Duration', format: 'duration' }),
    net_avg: Object.freeze({ label: 'Avg Net', format: 'isk' }),
    net_total: Object.freeze({ label: 'Total Net', format: 'isk' }),
    observed_runs: Object.freeze({ label: 'Loot Runs', format: 'integer' }),
    drop_runs: Object.freeze({ label: 'Runs with Drop', format: 'integer' }),
    drop_rate: Object.freeze({ label: 'Drop Rate', format: 'percent' }),
    total_qty: Object.freeze({ label: 'Total Qty', format: 'decimal' }),
    qty_per_run: Object.freeze({ label: 'Avg Qty / Run', format: 'decimal' }),
    drop_min: Object.freeze({ label: 'Min Drop', format: 'decimal' }),
    drop_max: Object.freeze({ label: 'Max Drop', format: 'decimal' }),
  });
  const PRESETS = Object.freeze([
    Object.freeze({
      id: 'runs-tier', label: 'Performance by Tier', mode: 'runs',
      group_by: Object.freeze(['tier']),
      metrics: Object.freeze(['runs', 'survived', 'died', 'survival_pct', 'duration_avg', 'net_avg']),
      sort: Object.freeze({ key: 'tier', direction: 'asc' }),
    }),
    Object.freeze({
      id: 'runs-weather', label: 'Performance by Weather', mode: 'runs',
      group_by: Object.freeze(['weather']),
      metrics: Object.freeze(['runs', 'survived', 'died', 'survival_pct', 'duration_avg', 'net_avg']),
      sort: Object.freeze({ key: 'weather', direction: 'asc' }),
    }),
    Object.freeze({
      id: 'runs-hull', label: 'Performance by Hull', mode: 'runs',
      group_by: Object.freeze(['hull']),
      metrics: Object.freeze(['runs', 'survived', 'died', 'survival_pct', 'duration_avg', 'net_avg']),
      sort: Object.freeze({ key: 'runs', direction: 'desc' }),
    }),
    Object.freeze({
      id: 'runs-fit', label: 'Performance by Fit', mode: 'runs',
      group_by: Object.freeze(['fit']),
      metrics: Object.freeze(['runs', 'survived', 'died', 'survival_pct', 'duration_avg', 'net_avg']),
      sort: Object.freeze({ key: 'runs', direction: 'desc' }),
    }),
    Object.freeze({
      id: 'drop-rates', label: 'Item Drop Rates', mode: 'drops',
      group_by: Object.freeze([]),
      metrics: Object.freeze([
        'observed_runs', 'drop_runs', 'drop_rate', 'total_qty',
        'qty_per_run',
      ]),
      sort: Object.freeze({ key: 'total_qty', direction: 'desc' }),
    }),
  ]);

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertKeys(value, label, allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`${label} contains an unexpected field`);
    }
  }

  function optionalInteger(value, label, minimum = 0) {
    if (value == null || value === '') return undefined;
    const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(number) || number < minimum) {
      throw new TypeError(`${label} is invalid`);
    }
    return number;
  }

  function optionalText(value, label, maximum = 256) {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
    const text = value.trim();
    if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
      throw new TypeError(`${label} is invalid`);
    }
    return text;
  }

  function validateScope(value) {
    if (!isPlainObject(value)) throw new TypeError('Statistics report scope must be an object');
    assertKeys(value, 'Statistics report scope', new Set([
      'character_id', 'range_start', 'range_end',
    ]));
    const scope = {};
    const characterId = optionalInteger(value.character_id, 'Character ID', 1);
    const rangeStart = optionalInteger(value.range_start, 'Report range start');
    const rangeEnd = optionalInteger(value.range_end, 'Report range end', 1);
    if (characterId !== undefined) scope.character_id = characterId;
    if (rangeStart !== undefined) scope.range_start = rangeStart;
    if (rangeEnd !== undefined) scope.range_end = rangeEnd;
    if (rangeStart !== undefined && rangeEnd !== undefined && rangeEnd <= rangeStart) {
      throw new TypeError('Report range end must be after its start');
    }
    return scope;
  }

  function validateFilters(value, mode) {
    if (!isPlainObject(value)) throw new TypeError('Statistics report filters must be an object');
    const allowed = new Set(['tier', 'weather', 'hull_name', 'fit_identity_id']);
    if (mode === 'runs') allowed.add('outcome');
    else allowed.add('item_name');
    assertKeys(value, 'Statistics report filters', allowed);
    const filters = {};
    if (value.tier != null && value.tier !== '') {
      if (!RUN_TIERS.has(value.tier)) throw new TypeError('Report tier is invalid');
      filters.tier = value.tier;
    }
    if (value.weather != null && value.weather !== '') {
      if (!RUN_WEATHERS.has(value.weather)) throw new TypeError('Report weather is invalid');
      filters.weather = value.weather;
    }
    if (value.outcome != null && value.outcome !== '') {
      if (!RUN_OUTCOMES.has(value.outcome)) throw new TypeError('Report outcome is invalid');
      filters.outcome = value.outcome;
    }
    const hullName = optionalText(value.hull_name, 'Report hull type');
    const itemName = optionalText(value.item_name, 'Report item');
    const fitIdentityId = optionalInteger(value.fit_identity_id, 'Report fit identity', 1);
    if (hullName !== undefined) filters.hull_name = hullName;
    if (itemName !== undefined) filters.item_name = itemName;
    if (fitIdentityId !== undefined) filters.fit_identity_id = fitIdentityId;
    return filters;
  }

  function validateReportRequest(value) {
    if (!isPlainObject(value)) throw new TypeError('Statistics report must be an object');
    assertKeys(value, 'Statistics report', new Set([
      'version', 'mode', 'character_id', 'range_start', 'range_end',
      'filters', 'group_by', 'metrics', 'sort',
    ]));
    if (value.version !== REPORT_VERSION) throw new TypeError('Statistics report version is unsupported');
    const mode = value.mode;
    const definition = MODES[mode];
    if (!definition) throw new TypeError('Statistics report mode is invalid');
    const scope = validateScope({
      character_id: value.character_id,
      range_start: value.range_start,
      range_end: value.range_end,
    });
    const filters = validateFilters(value.filters ?? {}, mode);
    if (!Array.isArray(value.group_by) || value.group_by.length > 2) {
      throw new TypeError('Statistics report supports at most two grouping dimensions');
    }
    const groupBy = value.group_by.map((dimension, index) => {
      if (typeof dimension !== 'string' || !definition.dimensions.includes(dimension)) {
        throw new TypeError(`Statistics report grouping ${index + 1} is invalid`);
      }
      return dimension;
    });
    if (new Set(groupBy).size !== groupBy.length) {
      throw new TypeError('Statistics report groupings must be unique');
    }
    if (!Array.isArray(value.metrics) || value.metrics.length === 0
      || value.metrics.length > definition.metrics.length) {
      throw new TypeError('Statistics report metrics are invalid');
    }
    const metrics = value.metrics.map((metric, index) => {
      if (typeof metric !== 'string' || !definition.metrics.includes(metric)) {
        throw new TypeError(`Statistics report metric ${index + 1} is invalid`);
      }
      return metric;
    });
    if (new Set(metrics).size !== metrics.length) {
      throw new TypeError('Statistics report metrics must be unique');
    }
    const sortValue = value.sort ?? { key: metrics[0], direction: 'desc' };
    if (!isPlainObject(sortValue)) throw new TypeError('Statistics report sort is invalid');
    assertKeys(sortValue, 'Statistics report sort', new Set(['key', 'direction']));
    const sortableDimensions = mode === 'drops' && !filters.item_name
      ? ['item', ...groupBy]
      : groupBy;
    if (![...sortableDimensions, ...metrics].includes(sortValue.key)) {
      throw new TypeError('Statistics report sort key is invalid');
    }
    if (!['asc', 'desc'].includes(sortValue.direction)) {
      throw new TypeError('Statistics report sort direction is invalid');
    }
    return {
      version: REPORT_VERSION,
      mode,
      ...scope,
      filters,
      group_by: groupBy,
      metrics,
      sort: { key: sortValue.key, direction: sortValue.direction },
    };
  }

  return Object.freeze({
    DIMENSIONS,
    METRICS,
    MODES,
    PRESETS,
    REPORT_VERSION,
    validateReportRequest,
    validateScope,
  });
});
