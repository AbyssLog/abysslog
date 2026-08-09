const assert = require('node:assert/strict');
const test = require('node:test');
const appraisal = require('../src/shared/appraisal');

function result(items, buyPrice, sellPrice) {
  return {
    items: items.map(item => ({
      itemType: { name: item.name },
      amount: item.qty,
      effectivePrices: {
        buyPrice,
        sellPrice,
        buyPriceTotal: buyPrice * item.qty,
        sellPriceTotal: sellPrice * item.qty,
      },
    })),
    totalBuyPrice: items.reduce((sum, item) => sum + buyPrice * item.qty, 0),
    totalSellPrice: items.reduce((sum, item) => sum + sellPrice * item.qty, 0),
  };
}

test('survived appraisal combines cargo and optional drone changes', async () => {
  const calls = [];
  const output = await appraisal.appraiseSurvivedInventory({
    cargoBefore: 'Filament\t2\nAmmo\t10',
    cargoAfter: 'Filament\t1\nLoot\t3\nAmmo\t10',
    droneBefore: 'Drone\t2',
    droneAfter: 'Drone\t1\nNew Drone\t1',
    appraise: async (items, pricing) => {
      calls.push({ items, pricing });
      return pricing === 'buy' ? result(items, 100, 90) : result(items, 80, 70);
    },
  });

  assert.deepEqual(calls, [
    {
      items: [
        { name: 'Loot', qty: 3 },
        { name: 'New Drone', qty: 1 },
      ],
      pricing: 'buy',
    },
    {
      items: [
        { name: 'Filament', qty: 1 },
        { name: 'Drone', qty: 1 },
      ],
      pricing: 'sell',
    },
  ]);
  assert.equal(output.loot_value, 400);
  assert.equal(output.consumed_cost, 140);
  assert.equal(output.net_isk, 260);
  assert.deepEqual(output.items.map(item => item.type), [
    'gained',
    'gained',
    'consumed',
    'consumed',
  ]);
});

test('omitted post-run drones remain unchanged', async () => {
  const calls = [];
  const output = await appraisal.appraiseSurvivedInventory({
    cargoBefore: 'Ammo\t2',
    cargoAfter: 'Ammo\t2',
    droneBefore: 'Drone\t5',
    droneAfter: '',
    appraise: async (...args) => {
      calls.push(args);
      return result(args[0], 1, 1);
    },
  });

  assert.deepEqual(output.diff, { gained: [], consumed: [] });
  assert.equal(output.net_isk, 0);
  assert.deepEqual(calls, []);
});

test('loss appraisal creates canonical lost run items', async () => {
  const output = await appraisal.appraiseLostInventory(
    [{ name: 'Drone', qty: 2 }],
    async items => result(items, 40, 50)
  );

  assert.equal(output.total_loss, 100);
  assert.deepEqual(output.items, [{
    item_name: 'Drone',
    qty: 2,
    type: 'lost',
    unit_price_buy: 40,
    unit_price_sell: 50,
  }]);
});

test('run item conversion rejects invalid types and malformed results', () => {
  assert.throws(
    () => appraisal.toRunItems(result([{ name: 'Item', qty: 1 }], 1, 1), 'other'),
    /type is invalid/
  );
  assert.throws(
    () => appraisal.toRunItems({ items: [{}] }, 'gained'),
    /item is invalid/
  );
});
