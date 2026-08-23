const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mapAppraisalHistoryItem,
  mapInventoryBaseline,
  mapRunDetail,
  mapRunSummary,
} = require('../src/main/ipc/run-payloads');
const {
  buildFitItem,
  buildImplant,
  buildInventoryItem,
  buildRun,
} = require('./support/builders');

test('appraisal history payloads reduce storage rows and normalize current state', () => {
  assert.deepEqual(mapAppraisalHistoryItem({
    id: 9,
    kind: 'survived',
    source: 'janice',
    provider: 'janice',
    appraised_at: 1_754_000_900,
    resolution_status: 'complete',
    loot_value: 120,
    consumed_cost: 20,
    net_isk: 100,
    total_loss: 0,
    is_current: 1,
    line_count: 3,
    created_at: 1,
    internal_value: 'hidden',
  }), {
    id: 9,
    kind: 'survived',
    source: 'janice',
    provider: 'janice',
    appraised_at: 1_754_000_900,
    resolution_status: 'complete',
    loot_value: 120,
    consumed_cost: 20,
    net_isk: 100,
    total_loss: 0,
    is_current: true,
    line_count: 3,
  });
});

test('run payloads expose canonical summaries without storage-only fields', () => {
  const summary = mapRunSummary(buildRun({
    id: 42,
    character_name: 'Abyss Pilot',
    fit_identity_id: 7,
    fit_key: 'abc12345',
    fit_display_name: 'Gamma Runner',
    created_at: 1,
    internal_value: 'not renderer-facing',
    tags: ['Farm'],
    matching_items: [{ item_name: 'Mutaplasmid', type: 'gained', ignored: true }],
  }));

  assert.equal(summary.hull_name, 'Gila');
  assert.equal(summary.fit_identity_id, 7);
  assert.equal(summary.fit_key, 'abc12345');
  assert.equal(summary.fit_display_name, 'Gamma Runner');
  assert.equal('ship_name' in summary, false);
  assert.equal('created_at' in summary, false);
  assert.equal('internal_value' in summary, false);
  assert.deepEqual(summary.matching_items, [{ item_name: 'Mutaplasmid', type: 'gained' }]);
});

test('run detail and inventory payloads expose only fields required by their views', () => {
  const run = buildRun({
    id: 42,
    cargo_after: 'Loot, 1',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 4',
    items: [buildInventoryItem({ ignored: true })],
    fitting: [buildFitItem({ ignored: true })],
    implants: [buildImplant({ ignored: true })],
    killmail_ids: [123],
  });

  const detail = mapRunDetail(run);
  assert.equal(detail.items[0].ignored, undefined);
  assert.equal(detail.fitting[0].ignored, undefined);
  assert.equal(detail.implants[0].ignored, undefined);
  assert.deepEqual(detail.killmail_ids, [123]);

  assert.deepEqual(mapInventoryBaseline(run), {
    id: 42,
    character_id: 9001,
    started_at: 1_754_000_000,
    outcome: 'Survived',
    cargo_after: 'Loot, 1',
    drone_before: 'Vespa II, 5',
    drone_after: 'Vespa II, 4',
  });
});
