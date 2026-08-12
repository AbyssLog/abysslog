function buildCharacter(overrides = {}) {
  return {
    id: 9001,
    name: 'Abyss Pilot',
    ...overrides,
  };
}

function buildInventoryItem(overrides = {}) {
  return {
    item_name: 'Triglavian Survey Database',
    qty: 1,
    type: 'gained',
    unit_price_buy: 100,
    unit_price_sell: 120,
    ...overrides,
  };
}

function buildFitItem(overrides = {}) {
  return {
    type_id: 101,
    type_name: 'Rapid Light Missile Launcher II',
    qty: 1,
    slot: 'high',
    unit_price_sell: 1000,
    ...overrides,
  };
}

function buildImplant(overrides = {}) {
  return {
    type_id: 201,
    type_name: 'High-grade Crystal Alpha',
    slot: 1,
    unit_price_sell: 2000,
    ...overrides,
  };
}

function buildRun(overrides = {}) {
  return {
    character_id: 9001,
    started_at: 1_754_000_000,
    duration: 900,
    tier: 'T5',
    weather: 'Gamma',
    outcome: 'Survived',
    hull_name: 'Gila',
    ship_class: 'Cruiser',
    system_id: 32_000_123,
    system_name: 'Abyssal #32000123',
    loot_value: 120,
    consumed_cost: 20,
    net_isk: 100,
    total_loss: 0,
    appraised_at: 1_754_000_900,
    cargo_before: '',
    cargo_after: '',
    drone_before: '',
    drone_after: '',
    notes: '',
    tags: [],
    killmail_ids: [],
    items: [],
    fitting: [],
    implants: [],
    ...overrides,
  };
}

function createDocumentHarness(initialElements = {}) {
  const entries = initialElements instanceof Map || Array.isArray(initialElements)
    ? [...initialElements]
    : Object.entries(initialElements);
  const elements = new Map(entries.map(([id, value]) => [
    id,
    { value: '', textContent: '', innerHTML: '', hidden: false, ...value },
  ]));
  return {
    elements,
    document: {
      getElementById: id => elements.get(id) || null,
    },
  };
}

module.exports = {
  buildCharacter,
  buildFitItem,
  buildImplant,
  buildInventoryItem,
  buildRun,
  createDocumentHarness,
};
