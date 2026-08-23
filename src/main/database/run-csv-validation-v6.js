const security = require('../../shared/security');

function requireArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be an array of at most ${maximum} entries`);
  }
  return value;
}

function requireObject(value, label) {
  if (!security.isPlainObject(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function assertKeys(value, label, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains an unexpected field`);
  }
}

function jsonCell(value, label) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError(`${label} contains invalid JSON`);
  }
}

function validateFitSnapshot(value) {
  if (value == null) return null;
  const snapshot = requireObject(value, 'Fit snapshot');
  assertKeys(snapshot, 'Fit snapshot', new Set([
    'format_version', 'hull_name', 'algorithm_version', 'display_name',
    'fitting', 'implants',
  ]));
  if (snapshot.format_version !== 1) throw new TypeError('Fit snapshot version is unsupported');
  if (snapshot.algorithm_version != null && snapshot.algorithm_version !== 1) {
    throw new TypeError('Fit identity algorithm version is unsupported');
  }
  const fitting = requireArray(snapshot.fitting, 'Fit snapshot fitting', 500).map(item => {
    assertKeys(requireObject(item, 'Fit item'), 'Fit item', new Set([
      'type_id', 'type_name', 'qty', 'slot',
    ]));
    return {
      type_id: security.requireInteger(item.type_id, 'Fit item type ID'),
      type_name: security.requireTrimmedText(item.type_name, 'Fit item name', 256),
      qty: security.requireInteger(item.qty, 'Fit item quantity', { min: 1, max: 1_000_000_000 }),
      slot: item.slot == null || item.slot === ''
        ? null
        : security.requireTrimmedText(item.slot, 'Fit item slot', 64),
      unit_price_sell: 0,
    };
  });
  const implants = requireArray(snapshot.implants, 'Fit snapshot implants', 64).map(item => {
    assertKeys(requireObject(item, 'Implant'), 'Implant', new Set([
      'type_id', 'type_name', 'qty', 'slot',
    ]));
    if (item.qty !== 1) throw new TypeError('Implant quantity is invalid');
    return {
      type_id: security.requireInteger(item.type_id, 'Implant type ID'),
      type_name: security.requireTrimmedText(item.type_name, 'Implant name', 256),
      slot: item.slot == null || item.slot === ''
        ? null
        : security.requireInteger(item.slot, 'Implant slot', { min: 1, max: 100 }),
      unit_price_sell: 0,
    };
  });
  return {
    fitting,
    implants,
    display_name: snapshot.display_name == null
      ? null
      : security.requireTrimmedText(snapshot.display_name, 'Fit display name', 80),
  };
}

function validateInventorySnapshots(value) {
  const phases = new Set(['before', 'after', 'loss']);
  const locations = new Set(['cargo', 'drone']);
  const statuses = new Set(['complete', 'partial', 'unparsed']);
  const seen = new Set();
  return requireArray(value, 'Inventory snapshots', 6).map((raw, index) => {
    const snapshot = requireObject(raw, `Inventory snapshot ${index + 1}`);
    assertKeys(snapshot, `Inventory snapshot ${index + 1}`, new Set([
      'format_version', 'phase', 'location', 'raw_text', 'captured_at',
      'parse_status', 'parse_error_code', 'created_at', 'items',
    ]));
    if (snapshot.format_version !== 1) throw new TypeError('Inventory snapshot version is unsupported');
    if (!phases.has(snapshot.phase) || !locations.has(snapshot.location)) {
      throw new TypeError('Inventory snapshot kind is invalid');
    }
    const key = `${snapshot.phase}:${snapshot.location}`;
    if (seen.has(key)) throw new TypeError('Inventory snapshots contain a duplicate kind');
    seen.add(key);
    if (!statuses.has(snapshot.parse_status)) {
      throw new TypeError('Inventory snapshot parse status is invalid');
    }
    const rawText = snapshot.raw_text == null
      ? null
      : security.requireText(snapshot.raw_text, 'Inventory snapshot text', 512 * 1024);
    const capturedAt = snapshot.captured_at == null
      ? null
      : security.requireInteger(snapshot.captured_at, 'Inventory capture time', { min: 0 });
    const createdAt = security.requireInteger(snapshot.created_at, 'Inventory creation time', { min: 0 });
    const items = requireArray(snapshot.items, 'Inventory snapshot items', 1500).map(item => {
      assertKeys(requireObject(item, 'Inventory item'), 'Inventory item', new Set([
        'type_id', 'item_name', 'qty',
      ]));
      return {
        type_id: item.type_id == null
          ? null
          : security.requireInteger(item.type_id, 'Inventory item type ID'),
        item_name: security.requireTrimmedText(item.item_name, 'Inventory item name', 256),
        qty: security.requireInteger(item.qty, 'Inventory item quantity', { min: 1, max: 1_000_000_000 }),
      };
    });
    return {
      format_version: 1,
      phase: snapshot.phase,
      location: snapshot.location,
      raw_text: rawText,
      captured_at: capturedAt,
      parse_status: snapshot.parse_status,
      parse_error_code: snapshot.parse_error_code == null
        ? null
        : security.requireText(snapshot.parse_error_code, 'Inventory parse error', 64, { multiline: false }),
      created_at: createdAt,
      items,
    };
  });
}

function validateAppraisals(value) {
  const kinds = new Set(['survived', 'loss']);
  const sources = new Set(['janice', 'killmail', 'manual', 'migrated']);
  const providers = new Set(['janice', 'esi', 'manual', 'legacy']);
  const statuses = new Set(['complete', 'partial', 'failed']);
  const dispositions = new Set(['gained', 'consumed', 'lost', 'fitted', 'implant']);
  const appraisals = requireArray(value, 'Appraisals', 100).map((raw, index) => {
    const appraisal = requireObject(raw, `Appraisal ${index + 1}`);
    assertKeys(appraisal, `Appraisal ${index + 1}`, new Set([
      'format_version', 'kind', 'source', 'provider', 'appraised_at',
      'resolution_status', 'loot_value', 'consumed_cost', 'net_isk',
      'total_loss', 'is_current', 'created_at', 'lines',
    ]));
    if (appraisal.format_version !== 1) throw new TypeError('Appraisal version is unsupported');
    if (!kinds.has(appraisal.kind) || !sources.has(appraisal.source)
      || !providers.has(appraisal.provider) || !statuses.has(appraisal.resolution_status)) {
      throw new TypeError('Appraisal metadata is invalid');
    }
    const lines = requireArray(appraisal.lines, 'Appraisal lines', 5000).map(line => {
      assertKeys(requireObject(line, 'Appraisal line'), 'Appraisal line', new Set([
        'type_id', 'item_name', 'qty', 'disposition',
        'unit_price_buy', 'unit_price_sell',
      ]));
      if (!dispositions.has(line.disposition)) {
        throw new TypeError('Appraisal line disposition is invalid');
      }
      return {
        type_id: line.type_id == null
          ? null
          : security.requireInteger(line.type_id, 'Appraisal line type ID'),
        item_name: security.requireTrimmedText(line.item_name, 'Appraisal line name', 256),
        qty: security.requireInteger(line.qty, 'Appraisal line quantity', { min: 1, max: 1_000_000_000 }),
        disposition: line.disposition,
        unit_price_buy: security.requireFiniteNumber(line.unit_price_buy, 'Appraisal buy price', { min: 0 }),
        unit_price_sell: security.requireFiniteNumber(line.unit_price_sell, 'Appraisal sell price', { min: 0 }),
      };
    });
    return {
      format_version: 1,
      kind: appraisal.kind,
      source: appraisal.source,
      provider: appraisal.provider,
      appraised_at: appraisal.appraised_at == null
        ? null
        : security.requireInteger(appraisal.appraised_at, 'Appraisal time', { min: 0 }),
      resolution_status: appraisal.resolution_status,
      loot_value: security.requireFiniteNumber(appraisal.loot_value, 'Loot value', { min: 0 }),
      consumed_cost: security.requireFiniteNumber(appraisal.consumed_cost, 'Consumed cost', { min: 0 }),
      net_isk: security.requireFiniteNumber(appraisal.net_isk, 'Net ISK'),
      total_loss: security.requireFiniteNumber(appraisal.total_loss, 'Total loss', { min: 0 }),
      is_current: appraisal.is_current === 1 ? 1 : appraisal.is_current === 0 ? 0 : (() => {
        throw new TypeError('Appraisal current status is invalid');
      })(),
      created_at: security.requireInteger(appraisal.created_at, 'Appraisal creation time', { min: 0 }),
      lines,
    };
  });
  if (appraisals.length === 0 || appraisals.filter(item => item.is_current === 1).length !== 1) {
    throw new TypeError('Run must contain exactly one current appraisal');
  }
  return appraisals;
}

module.exports = {
  jsonCell,
  validateAppraisals,
  validateFitSnapshot,
  validateInventorySnapshots,
};
