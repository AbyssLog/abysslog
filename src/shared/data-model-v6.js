(function exposeDataModelV6(root, factory) {
  const runTracking = typeof module === 'object' && module.exports
    ? require('./run-tracking')
    : root?.AbyssRunTracking;
  const api = factory(runTracking);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssDataModelV6 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, runTracking => {
  const FIT_SNAPSHOT_FORMAT_VERSION = 1;
  const INVENTORY_SNAPSHOT_FORMAT_VERSION = 1;
  const APPRAISAL_FORMAT_VERSION = 1;
  const SNAPSHOT_PHASES = new Set(['before', 'after', 'loss']);
  const SNAPSHOT_LOCATIONS = new Set(['cargo', 'drone']);
  const APPRAISAL_SOURCES = new Set(['janice', 'killmail', 'manual', 'migrated']);
  const APPRAISAL_PROVIDERS = new Set(['janice', 'esi', 'manual', 'legacy']);
  const LINE_DISPOSITIONS = new Set(['gained', 'consumed', 'lost', 'fitted', 'implant']);

  if (typeof runTracking?.parseInventoryPaste !== 'function') {
    throw new Error('Run tracking inventory parser is required');
  }

  function requireText(value, label) {
    if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
    return value;
  }

  function optionalTypeId(value) {
    if (value == null || value === '') return null;
    const typeId = Number(value);
    if (!Number.isSafeInteger(typeId) || typeId <= 0) {
      throw new TypeError('Snapshot item type ID is invalid');
    }
    return typeId;
  }

  function positiveQuantity(value, fallback = 1) {
    const quantity = value == null ? fallback : Number(value);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
      throw new TypeError('Snapshot item quantity is invalid');
    }
    return quantity;
  }

  function normalizeFitItem(item, kind) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Fit snapshot item is invalid');
    }
    const typeName = requireText(item.type_name, 'Fit snapshot item name').trim();
    if (!typeName) throw new TypeError('Fit snapshot item name is required');
    const slot = item.slot == null ? '' : String(item.slot).trim();
    return {
      kind,
      type_id: optionalTypeId(item.type_id),
      type_name: typeName,
      qty: positiveQuantity(item.qty),
      slot,
    };
  }

  function compareFitItems(left, right) {
    return left.kind.localeCompare(right.kind)
      || left.slot.localeCompare(right.slot)
      || (left.type_id ?? Number.MAX_SAFE_INTEGER) - (right.type_id ?? Number.MAX_SAFE_INTEGER)
      || left.type_name.localeCompare(right.type_name)
      || left.qty - right.qty;
  }

  function createExactFitSnapshot(fittingItems = [], implants = [], { hullName = null } = {}) {
    if (!Array.isArray(fittingItems) || !Array.isArray(implants)) {
      throw new TypeError('Fit snapshot collections must be arrays');
    }
    const fitting = fittingItems.map(item => normalizeFitItem(item, 'fitting'))
      .sort(compareFitItems);
    const normalizedImplants = implants.map(item => normalizeFitItem(item, 'implant'))
      .sort(compareFitItems);
    const hull = fitting.find(item => item.slot === 'hull') || null;
    if (fitting.length === 0 && normalizedImplants.length === 0) return null;
    const capturedHullName = hull?.type_name
      || (typeof hullName === 'string' && hullName.trim() ? hullName.trim() : null);
    const configuration = {
      version: FIT_SNAPSHOT_FORMAT_VERSION,
      hull_name: capturedHullName,
      fitting,
      implants: normalizedImplants,
    };
    return Object.freeze({
      format_version: FIT_SNAPSHOT_FORMAT_VERSION,
      hull_name: capturedHullName,
      signature: JSON.stringify(configuration),
      fitting: Object.freeze(fitting.map(item => Object.freeze(item))),
      implants: Object.freeze(normalizedImplants.map(item => Object.freeze(item))),
    });
  }

  function inventoryParseErrorCode(error) {
    if (error instanceof RangeError) return 'quantity_out_of_range';
    if (error instanceof TypeError) return 'invalid_inventory';
    return 'parse_failure';
  }

  function createInventorySnapshot({
    rawText = '',
    phase,
    location,
    capturedAt = null,
  }) {
    if (!SNAPSHOT_PHASES.has(phase)) throw new TypeError('Inventory snapshot phase is invalid');
    if (!SNAPSHOT_LOCATIONS.has(location)) {
      throw new TypeError('Inventory snapshot location is invalid');
    }
    const raw_text = requireText(rawText, 'Inventory snapshot');
    if (capturedAt != null && (!Number.isSafeInteger(capturedAt) || capturedAt < 0)) {
      throw new TypeError('Inventory snapshot capture time is invalid');
    }
    try {
      const items = runTracking.parseInventoryPaste(raw_text)
        .map(item => Object.freeze({
          type_id: null,
          item_name: item.name,
          qty: item.qty,
        }))
        .sort((left, right) => left.item_name.localeCompare(right.item_name));
      return Object.freeze({
        format_version: INVENTORY_SNAPSHOT_FORMAT_VERSION,
        phase,
        location,
        raw_text,
        captured_at: capturedAt,
        parse_status: 'complete',
        parse_error_code: null,
        items: Object.freeze(items),
      });
    } catch (error) {
      return Object.freeze({
        format_version: INVENTORY_SNAPSHOT_FORMAT_VERSION,
        phase,
        location,
        raw_text,
        captured_at: capturedAt,
        parse_status: 'unparsed',
        parse_error_code: inventoryParseErrorCode(error),
        items: Object.freeze([]),
      });
    }
  }

  function finiteMoney(value, label) {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number)) throw new TypeError(`${label} is invalid`);
    return number;
  }

  function nonNegativeMoney(value, label) {
    const number = finiteMoney(value, label);
    if (number < 0) throw new TypeError(`${label} is invalid`);
    return number;
  }

  function createAppraisalRecord({
    run,
    items = [],
    source = 'migrated',
    provider = 'legacy',
    appraisedAt = null,
  }) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) {
      throw new TypeError('Appraisal run is invalid');
    }
    if (!Array.isArray(items)) throw new TypeError('Appraisal lines must be an array');
    if (!APPRAISAL_SOURCES.has(source)) throw new TypeError('Appraisal source is invalid');
    if (!APPRAISAL_PROVIDERS.has(provider)) throw new TypeError('Appraisal provider is invalid');
    const kind = run.outcome === 'Died' ? 'loss' : 'survived';
    const lines = items.map((item, index) => {
      if (!item || typeof item !== 'object' || !LINE_DISPOSITIONS.has(item.type)) {
        throw new TypeError(`Appraisal line ${index + 1} is invalid`);
      }
      const itemName = requireText(item.item_name, `Appraisal line ${index + 1} name`).trim();
      if (!itemName) throw new TypeError(`Appraisal line ${index + 1} name is required`);
      return Object.freeze({
        type_id: optionalTypeId(item.type_id),
        item_name: itemName,
        qty: positiveQuantity(item.qty),
        disposition: item.type,
        unit_price_buy: nonNegativeMoney(item.unit_price_buy, 'Appraisal buy price'),
        unit_price_sell: nonNegativeMoney(item.unit_price_sell, 'Appraisal sell price'),
      });
    });
    const effectiveAppraisedAt = appraisedAt ?? run.appraised_at ?? null;
    if (
      effectiveAppraisedAt != null
      && (!Number.isSafeInteger(effectiveAppraisedAt) || effectiveAppraisedAt < 0)
    ) {
      throw new TypeError('Appraisal time is invalid');
    }
    return Object.freeze({
      format_version: APPRAISAL_FORMAT_VERSION,
      kind,
      source,
      provider,
      appraised_at: effectiveAppraisedAt,
      resolution_status: lines.some(line =>
        line.unit_price_buy === 0 && line.unit_price_sell === 0
      ) ? 'partial' : 'complete',
      loot_value: nonNegativeMoney(run.loot_value, 'Appraisal loot value'),
      consumed_cost: nonNegativeMoney(run.consumed_cost, 'Appraisal consumed cost'),
      net_isk: finiteMoney(run.net_isk, 'Appraisal net ISK'),
      total_loss: nonNegativeMoney(run.total_loss, 'Appraisal total loss'),
      lines: Object.freeze(lines),
    });
  }

  return Object.freeze({
    APPRAISAL_FORMAT_VERSION,
    FIT_SNAPSHOT_FORMAT_VERSION,
    INVENTORY_SNAPSHOT_FORMAT_VERSION,
    createAppraisalRecord,
    createExactFitSnapshot,
    createInventorySnapshot,
  });
});
