const assert = require('node:assert/strict');
const test = require('node:test');

const { createStatsView } = require('../src/renderer/stats-view');
const { createDocumentHarness } = require('./support/builders');

function createHarness(statsResult = {
  overall: { total_runs: 0 },
  byTier: [],
  byWeather: [],
  iskPerHour: 0,
}) {
  const { elements, document } = createDocumentHarness([
    ['statsRangePreset', { value: 'all' }],
    ['statsCustomRange', { hidden: true }],
    ['statsDateFrom', { value: '' }],
    ['statsDateTo', { value: '' }],
    ['statsContent', { innerHTML: '' }],
    ['statsFilterError', { textContent: '', hidden: true }],
    ['statsRangeSummary', { textContent: '' }],
  ]);
  const calls = [];
  const reportCalls = [];
  const range = { preset: 'all', label: 'All time' };
  const api = {
    runs: {
      getStats: async filters => {
        calls.push(['stats', filters]);
        return statsResult;
      },
      getDailyStats: async filters => {
        calls.push(['daily', filters]);
        return [];
      },
    },
  };
  const statistics = {
    defaultCustomDates: () => ({ from: '2026-08-01', to: '2026-08-09' }),
    resolveDateRange: () => range,
    createChartSeries: () => ({ rows: [], bucket: 'day', bucketDays: 1 }),
  };
  const view = createStatsView({
    document,
    api,
    statistics,
    getActiveCharacterId: () => 9001,
    formatIsk: value => String(value),
    formatDuration: value => String(value),
    escapeHtml: value => String(value),
    reportController: {
      hide: () => reportCalls.push(['hide']),
      render: async context => reportCalls.push(['render', context]),
    },
  });
  return { calls, elements, range, reportCalls, view };
}

test('statistics view owns range-to-query mapping and empty-state rendering', async () => {
  const { calls, elements, range, reportCalls, view } = createHarness();

  assert.deepEqual(view.getSelectedRange(), range);
  assert.deepEqual(view.createFilters(
    { range_start: 100, range_end: 200 },
    9001
  ), {
    character_id: 9001,
    range_start: 100,
    range_end: 200,
  });

  await view.render();

  assert.equal(elements.get('statsRangeSummary').textContent, 'All time');
  assert.match(elements.get('statsContent').innerHTML, /No runs logged yet/);
  assert.deepEqual(calls, [
    ['stats', { character_id: 9001 }],
    ['daily', { character_id: 9001 }],
  ]);
  assert.deepEqual(reportCalls, [['hide']]);
});

test('statistics view initializes a missing custom range before rendering', async () => {
  const { elements, view } = createHarness();
  elements.get('statsRangePreset').value = 'custom';

  await view.handleRangeChange();

  assert.equal(elements.get('statsCustomRange').hidden, false);
  assert.equal(elements.get('statsDateFrom').value, '2026-08-01');
  assert.equal(elements.get('statsDateTo').value, '2026-08-09');
});

test('statistics overview delegates fit reporting instead of rendering fixed fit rows', async () => {
  const { elements, reportCalls, view } = createHarness({
    overall: { total_runs: 1 },
    byTier: [],
    byWeather: [],
    byFit: [{
      fit_identity_id: 7,
      fit_key: 'abc12345',
      display_name: 'Gamma Runner',
      representative_run_id: 42,
      hull_name: 'Gila',
      total_runs: 3,
      survived: 2,
      avg_duration: 600,
      avg_net_isk: 100,
    }],
    iskPerHour: 0,
  });

  await view.render();

  const html = elements.get('statsContent').innerHTML;
  assert.doesNotMatch(html, /class="analytics-fit-link"/);
  assert.equal(reportCalls[0][0], 'render');
});

test('statistics overview no longer renders the four fixed grouping tables', async () => {
  const metrics = {
    total_runs: 3,
    survived: 2,
    avg_duration: 600,
    avg_net_isk: 100,
  };
  const { elements, reportCalls, view } = createHarness({
    overall: { total_runs: 3 },
    byTier: [{ tier: 'T5', ...metrics }],
    byWeather: [{ weather: 'Exotic', ...metrics }],
    byHull: [{ hull_name: 'Gila', ship_class: 'Cruiser', ...metrics }],
    byFit: [{
      fit_identity_id: 7,
      fit_key: 'abc12345',
      representative_run_id: 42,
      hull_name: 'Gila',
      ...metrics,
    }],
    iskPerHour: 0,
  });

  await view.render();

  const html = elements.get('statsContent').innerHTML;
  assert.doesNotMatch(html, /data-table analytics-table stats-table/);
  assert.equal(reportCalls[0][0], 'render');
});
