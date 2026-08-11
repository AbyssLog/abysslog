const assert = require('node:assert/strict');
const test = require('node:test');

const { createStatsView } = require('../src/renderer/stats-view');

function createHarness(statsResult = {
  overall: { total_runs: 0 },
  byTier: [],
  byWeather: [],
  iskPerHour: 0,
}) {
  const elements = new Map([
    ['statsRangePreset', { value: 'all' }],
    ['statsCustomRange', { hidden: true }],
    ['statsDateFrom', { value: '' }],
    ['statsDateTo', { value: '' }],
    ['statsContent', { innerHTML: '' }],
    ['statsFilterError', { textContent: '', hidden: true }],
    ['statsRangeSummary', { textContent: '' }],
  ]);
  const calls = [];
  const range = { preset: 'all', label: 'All time' };
  const document = {
    getElementById: id => elements.get(id) || null,
  };
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
  });
  return { calls, elements, range, view };
}

test('statistics view owns range-to-query mapping and empty-state rendering', async () => {
  const { calls, elements, range, view } = createHarness();

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
});

test('statistics view initializes a missing custom range before rendering', async () => {
  const { elements, view } = createHarness();
  elements.get('statsRangePreset').value = 'custom';

  await view.handleRangeChange();

  assert.equal(elements.get('statsCustomRange').hidden, false);
  assert.equal(elements.get('statsDateFrom').value, '2026-08-01');
  assert.equal(elements.get('statsDateTo').value, '2026-08-09');
});

test('statistics fit rows link to the captured fit and implants dialog', async () => {
  const { elements, view } = createHarness({
    overall: { total_runs: 1 },
    byTier: [],
    byWeather: [],
    byFit: [{
      fit_key: 'abc12345',
      representative_run_id: 42,
      ship_name: 'Gila',
      total_runs: 3,
      survived: 2,
      avg_duration: 600,
      avg_net_isk: 100,
    }],
    iskPerHour: 0,
  });

  await view.render();

  const html = elements.get('statsContent').innerHTML;
  assert.match(html, /class="analytics-fit-link"/);
  assert.match(html, /data-action="show-ship-setup"/);
  assert.match(html, /data-run-id="42" data-return-modal="none"/);
  assert.match(html, /View Gila fit #abc12345 details/);
  assert.doesNotMatch(html, /<th>Weather<\/th>/);
  assert.doesNotMatch(html, /weather-badge-group/);
});

test('statistics grouped tables share metric columns and combine ship metadata', async () => {
  const metrics = {
    total_runs: 3,
    survived: 2,
    avg_duration: 600,
    avg_net_isk: 100,
  };
  const { elements, view } = createHarness({
    overall: { total_runs: 3 },
    byTier: [{ tier: 'T5', ...metrics }],
    byWeather: [{ weather: 'Exotic', ...metrics }],
    byShip: [{ ship_name: 'Gila', ship_class: 'Cruiser', ...metrics }],
    byFit: [{
      fit_key: 'abc12345',
      representative_run_id: 42,
      ship_name: 'Gila',
      ...metrics,
    }],
    iskPerHour: 0,
  });

  await view.render();

  const html = elements.get('statsContent').innerHTML;
  const commonHeaders = '<th class="stat-number">Runs</th>'
    + '<th class="stat-number">Survived</th>'
    + '<th class="stat-number">Died</th>'
    + '<th class="stat-number">Survival %</th>'
    + '<th class="stat-number">Avg. Duration</th>'
    + '<th class="stat-number">Avg. Net</th>';
  assert.equal(html.split(commonHeaders).length - 1, 4);
  assert.equal((html.match(/data-table analytics-table stats-table/g) || []).length, 4);
  assert.match(html, /<td>Gila <span class="stats-group-detail">\(Cruiser\)<\/span><\/td>/);
  assert.equal((html.match(/class="badge weather"/g) || []).length, 1);
});
