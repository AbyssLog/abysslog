const assert = require('node:assert/strict');
const test = require('node:test');

const reporting = require('../src/shared/statistics-report');

test('statistics report validates mixed run groupings and metrics', () => {
  assert.deepEqual(reporting.validateReportRequest({
    version: 1,
    mode: 'runs',
    character_id: 9001,
    range_start: 100,
    range_end: 200,
    filters: { weather: 'Gamma', outcome: 'Survived' },
    group_by: ['tier', 'fit'],
    metrics: ['runs', 'duration_avg', 'duration_max', 'net_avg'],
    sort: { key: 'net_avg', direction: 'desc' },
  }), {
    version: 1,
    mode: 'runs',
    character_id: 9001,
    range_start: 100,
    range_end: 200,
    filters: { weather: 'Gamma', outcome: 'Survived' },
    group_by: ['tier', 'fit'],
    metrics: ['runs', 'duration_avg', 'duration_max', 'net_avg'],
    sort: { key: 'net_avg', direction: 'desc' },
  });
});

test('item drop reports use implicit Item grouping when no item filter is selected', () => {
  const request = reporting.validateReportRequest({
    version: 1,
    mode: 'drops',
    filters: { item_name: 'Triglavian Survey Database', tier: 'T5' },
    group_by: ['weather', 'fit'],
    metrics: ['observed_runs', 'drop_runs', 'drop_rate', 'qty_per_run'],
  });
  assert.equal(request.sort.key, 'observed_runs');
  const allItems = reporting.validateReportRequest({
    version: 1,
    mode: 'drops', filters: {}, group_by: ['tier', 'weather'], metrics: ['total_qty'],
    sort: { key: 'item', direction: 'asc' },
  });
  assert.deepEqual(allItems.group_by, ['tier', 'weather']);
  assert.equal(allItems.sort.key, 'item');
  assert.throws(() => reporting.validateReportRequest({
    version: 1,
    mode: 'drops', filters: { item_name: 'PLEX' },
    group_by: ['item'], metrics: ['total_qty'],
  }), /grouping 1 is invalid/);
  assert.throws(() => reporting.validateReportRequest({
    version: 1, mode: 'drops', filters: {}, group_by: [],
    metrics: ['net_when_dropped_avg'],
  }), /metric 1 is invalid/);
});

test('statistics report rejects arbitrary fields, identifiers, and excessive grouping', () => {
  assert.throws(() => reporting.validateReportRequest({
    version: 1, mode: 'runs', filters: {}, group_by: ['tier', 'weather', 'fit'],
    metrics: ['runs'],
  }), /at most two/);
  assert.throws(() => reporting.validateReportRequest({
    version: 1, mode: 'runs', filters: {}, group_by: ['tier; DROP TABLE runs'],
    metrics: ['runs'],
  }), /grouping 1 is invalid/);
  assert.throws(() => reporting.validateReportRequest({
    version: 1, mode: 'runs', filters: { item_name: 'PLEX' }, group_by: ['tier'],
    metrics: ['runs'],
  }), /unexpected field/);
});
