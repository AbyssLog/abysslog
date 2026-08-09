(function exposeAppraisal(root, factory) {
  const runTracking = typeof module === 'object' && module.exports
    ? require('./run-tracking')
    : root?.AbyssRunTracking;
  const api = factory(runTracking);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssAppraisal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, runTracking => {
  if (
    !runTracking?.diffInventoryPastes
    || !runTracking?.diffOptionalInventoryPastes
    || !runTracking?.mergeInventoryItems
  ) {
    throw new Error('Run tracking helpers are required');
  }

  const ITEM_TYPES = new Set(['gained', 'consumed', 'lost']);

  function requireAppraise(appraise) {
    if (typeof appraise !== 'function') {
      throw new TypeError('An appraisal function is required');
    }
    return appraise;
  }

  function createInventoryDiff({
    cargoBefore = '',
    cargoAfter = '',
    droneBefore = '',
    droneAfter = '',
  } = {}) {
    const cargo = runTracking.diffInventoryPastes(cargoBefore, cargoAfter);
    const drones = runTracking.diffOptionalInventoryPastes(droneBefore, droneAfter);
    return {
      gained: runTracking.mergeInventoryItems(cargo.gained, drones.gained),
      consumed: runTracking.mergeInventoryItems(cargo.consumed, drones.consumed),
    };
  }

  function toRunItems(result, type) {
    if (!ITEM_TYPES.has(type)) throw new TypeError('Run item type is invalid');
    if (!result) return [];
    if (!Array.isArray(result.items)) throw new TypeError('Appraisal result is invalid');
    return result.items.map(item => {
      const prices = item?.effectivePrices;
      if (
        typeof item?.itemType?.name !== 'string'
        || !Number.isSafeInteger(item.amount)
        || item.amount <= 0
        || !prices
      ) {
        throw new TypeError('Appraisal item is invalid');
      }
      return {
        item_name: item.itemType.name,
        qty: item.amount,
        type,
        unit_price_buy: Number(prices.buyPrice) || 0,
        unit_price_sell: Number(prices.sellPrice) || 0,
      };
    });
  }

  async function appraiseSurvivedInventory({
    cargoBefore = '',
    cargoAfter = '',
    droneBefore = '',
    droneAfter = '',
    appraise,
  } = {}) {
    const requestAppraisal = requireAppraise(appraise);
    const diff = createInventoryDiff({
      cargoBefore,
      cargoAfter,
      droneBefore,
      droneAfter,
    });
    const lootResult = diff.gained.length > 0
      ? await requestAppraisal(diff.gained, 'buy')
      : null;
    const consumedResult = diff.consumed.length > 0
      ? await requestAppraisal(diff.consumed, 'sell')
      : null;
    const lootValue = lootResult ? Number(lootResult.totalBuyPrice) || 0 : 0;
    const consumedCost = consumedResult ? Number(consumedResult.totalSellPrice) || 0 : 0;
    return {
      diff,
      lootResult,
      consumedResult,
      loot_value: lootValue,
      consumed_cost: consumedCost,
      net_isk: lootValue - consumedCost,
      items: [
        ...toRunItems(lootResult, 'gained'),
        ...toRunItems(consumedResult, 'consumed'),
      ],
    };
  }

  async function appraiseLostInventory(items, appraise) {
    if (!Array.isArray(items)) throw new TypeError('Loss inventory must be an array');
    if (items.length === 0) {
      return { result: null, total_loss: 0, items: [] };
    }
    const result = await requireAppraise(appraise)(items, 'sell');
    return {
      result,
      total_loss: Number(result?.totalSellPrice) || 0,
      items: toRunItems(result, 'lost'),
    };
  }

  return {
    appraiseLostInventory,
    appraiseSurvivedInventory,
    createInventoryDiff,
    toRunItems,
  };
});
