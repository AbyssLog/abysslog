(function exposeLoadouts(root, factory) {
  const runTracking = typeof module === 'object' && module.exports
    ? require('./run-tracking')
    : root?.AbyssRunTracking;
  const api = factory(runTracking);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssLoadouts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, runTracking => {
  const MAX_PRESETS = 50;
  const MAX_ITEMS_PER_BAY = 250;
  const MAX_ITEM_QUANTITY = 1_000_000_000;
  const MAX_STORED_BYTES = 256 * 1024;

  if (!runTracking?.parseInventoryPaste) {
    throw new Error('Inventory parsing is unavailable');
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertAllowedKeys(value, label, allowed) {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) throw new TypeError(`${label} contains an unsupported field`);
    }
  }

  function normalizeId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new TypeError('Loadout preset ID is invalid');
    }
    return value;
  }

  function normalizeName(value) {
    if (typeof value !== 'string') throw new TypeError('Loadout preset name is required');
    const name = value.trim();
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new TypeError('Loadout preset name must be between 1 and 80 characters');
    }
    return name;
  }

  function normalizeItems(value, label) {
    if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_BAY) {
      throw new TypeError(`${label} must contain no more than ${MAX_ITEMS_PER_BAY} items`);
    }

    const merged = new Map();
    for (const [index, item] of value.entries()) {
      if (!isPlainObject(item)) throw new TypeError(`${label} item ${index + 1} is invalid`);
      assertAllowedKeys(item, `${label} item ${index + 1}`, new Set(['name', 'qty']));
      if (typeof item.name !== 'string') {
        throw new TypeError(`${label} item ${index + 1} name is invalid`);
      }
      const name = item.name.trim();
      if (!name || name.length > 256 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new TypeError(`${label} item ${index + 1} name is invalid`);
      }
      if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > MAX_ITEM_QUANTITY) {
        throw new TypeError(`${label} item ${index + 1} quantity is invalid`);
      }
      const quantity = (merged.get(name) || 0) + item.qty;
      if (!Number.isSafeInteger(quantity) || quantity > MAX_ITEM_QUANTITY) {
        throw new RangeError(`${label} quantity for ${name} is too large`);
      }
      merged.set(name, quantity);
    }

    return [...merged.entries()].map(([name, qty]) => ({ name, qty }));
  }

  function normalizePreset(value) {
    if (!isPlainObject(value)) throw new TypeError('Loadout preset is invalid');
    assertAllowedKeys(value, 'Loadout preset', new Set(['id', 'name', 'cargo', 'drone']));
    const preset = {
      id: normalizeId(value.id),
      name: normalizeName(value.name),
      cargo: normalizeItems(value.cargo, 'Cargo hold'),
      drone: normalizeItems(value.drone, 'Drone bay'),
    };
    if (preset.cargo.length === 0 && preset.drone.length === 0) {
      throw new TypeError('A loadout preset must contain at least one cargo or drone item');
    }
    return preset;
  }

  function normalizePresets(value) {
    if (!Array.isArray(value) || value.length > MAX_PRESETS) {
      throw new TypeError(`Loadout presets must contain no more than ${MAX_PRESETS} presets`);
    }
    const presets = value.map(normalizePreset);
    const ids = new Set();
    const names = new Set();
    for (const preset of presets) {
      const normalizedName = preset.name.toLowerCase();
      if (ids.has(preset.id)) throw new TypeError('Loadout preset IDs must be unique');
      if (names.has(normalizedName)) throw new TypeError('Loadout preset names must be unique');
      ids.add(preset.id);
      names.add(normalizedName);
    }
    return presets;
  }

  function createPresetFromInventoryText({ id, name, cargoText = '', droneText = '' } = {}) {
    if (typeof cargoText !== 'string' || typeof droneText !== 'string') {
      throw new TypeError('Loadout inventory must be text');
    }
    return normalizePreset({
      id,
      name,
      cargo: runTracking.parseInventoryPaste(cargoText),
      drone: runTracking.parseInventoryPaste(droneText),
    });
  }

  function formatInventoryItems(value) {
    return normalizeItems(value, 'Inventory')
      .map(item => `${item.name}\t${item.qty}`)
      .join('\n');
  }

  function serializePresets(value) {
    const serialized = JSON.stringify(normalizePresets(value));
    if (new TextEncoder().encode(serialized).byteLength > MAX_STORED_BYTES) {
      throw new TypeError('Loadout presets are too large');
    }
    return serialized;
  }

  function parseStoredPresets(value) {
    if (value == null || value === '') return [];
    if (typeof value !== 'string') throw new TypeError('Saved loadout presets are invalid');
    if (new TextEncoder().encode(value).byteLength > MAX_STORED_BYTES) {
      throw new TypeError('Saved loadout presets are too large');
    }
    try {
      return normalizePresets(JSON.parse(value));
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) throw error;
      throw new TypeError('Saved loadout presets are invalid');
    }
  }

  return {
    MAX_PRESETS,
    MAX_STORED_BYTES,
    createPresetFromInventoryText,
    formatInventoryItems,
    normalizePreset,
    normalizePresets,
    parseStoredPresets,
    serializePresets,
  };
});
