const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAppraisalRecord,
  createExactFitSnapshot,
  createInventorySnapshot,
} = require('../src/shared/data-model-v6');
const {
  createMigratedRunUid,
  createNewRunUid,
  signatureHash,
} = require('../src/main/database/v6-identities');

test('migrated run UUIDs are deterministic, distinct, and standards-shaped', () => {
  const run = { id: 7, character_id: 9001, started_at: 1_700_000_000 };
  const first = createMigratedRunUid(run);
  assert.equal(createMigratedRunUid({ ...run }), first);
  assert.notEqual(createMigratedRunUid({ ...run, id: 8 }), first);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(
    createNewRunUid(() => '550e8400-e29b-41d4-a716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000'
  );
});

test('exact fit snapshots include slots but exclude aliases, runs, and prices', () => {
  const fitting = [
    { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull', unit_price_sell: 1 },
    { type_id: 33_201, type_name: 'Launcher II', qty: 1, slot: 'HiSlot0', unit_price_sell: 2 },
    { type_id: 21_638, type_name: 'Vespa II', qty: 5, slot: 'DroneBay', unit_price_sell: 3 },
  ];
  const implants = [
    { type_id: 22_101, type_name: 'Crystal Alpha', slot: 1, unit_price_sell: 4 },
  ];
  const first = createExactFitSnapshot(fitting, implants);
  const repriced = createExactFitSnapshot(
    fitting.map(item => ({ ...item, unit_price_sell: 999 })),
    implants.map(item => ({ ...item, unit_price_sell: 999 }))
  );
  const moved = createExactFitSnapshot(
    fitting.map(item => item.slot === 'HiSlot0' ? { ...item, slot: 'HiSlot1' } : item),
    implants
  );
  assert.equal(first.signature, repriced.signature);
  assert.notEqual(first.signature, moved.signature);
  assert.equal(first.hull_name, 'Gila');
  assert.match(signatureHash(first.signature), /^[0-9a-f]{64}$/);
  assert.doesNotMatch(first.signature, /unit_price|alias|character|run_id/);
});

test('inventory snapshots retain exact raw text and parsed items', () => {
  const raw = 'Vespa II\t5\r\nNanite Repair Paste\t20';
  const snapshot = createInventorySnapshot({
    rawText: raw,
    phase: 'before',
    location: 'cargo',
    capturedAt: 1_700_000_000,
  });
  assert.equal(snapshot.raw_text, raw);
  assert.equal(snapshot.parse_status, 'complete');
  assert.deepEqual(snapshot.items, [
    { type_id: null, item_name: 'Nanite Repair Paste', qty: 20 },
    { type_id: null, item_name: 'Vespa II', qty: 5 },
  ]);

  const unparsed = createInventorySnapshot({
    rawText: 'Vespa II\t999999999999999999999',
    phase: 'loss',
    location: 'drone',
  });
  assert.equal(unparsed.raw_text, 'Vespa II\t999999999999999999999');
  assert.equal(unparsed.parse_status, 'unparsed');
  assert.equal(unparsed.parse_error_code, 'quantity_out_of_range');
  assert.deepEqual(unparsed.items, []);
});

test('migrated appraisals preserve totals, lines, and partial resolution', () => {
  const appraisal = createAppraisalRecord({
    run: {
      outcome: 'Survived',
      appraised_at: 1_700_000_900,
      loot_value: 120,
      consumed_cost: 20,
      net_isk: 100,
      total_loss: 0,
    },
    items: [
      {
        item_name: 'Triglavian Survey Database',
        qty: 1,
        type: 'gained',
        unit_price_buy: 120,
        unit_price_sell: 0,
      },
      {
        item_name: 'Unpriced Loot',
        qty: 2,
        type: 'gained',
        unit_price_buy: 0,
        unit_price_sell: 0,
      },
    ],
  });
  assert.equal(appraisal.kind, 'survived');
  assert.equal(appraisal.source, 'migrated');
  assert.equal(appraisal.provider, 'legacy');
  assert.equal(appraisal.resolution_status, 'partial');
  assert.equal(appraisal.net_isk, 100);
  assert.equal(appraisal.lines.length, 2);
});
