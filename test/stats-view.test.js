const assert = require('node:assert/strict');
const test = require('node:test');

const { createStatsView } = require('../src/renderer/stats-view');

function createHarness() {
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
        return { overall: { total_runs: 0 }, byTier: [], byWeather: [], iskPerHour: 0 };
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
