const assert = require('node:assert/strict');
const test = require('node:test');

const { createStatsView } = require('../src/renderer/stats-view');
const { createDocumentHarness } = require('./support/builders');

function createHarness(statsResult = {
  overall: { total_runs: 0 },
  iskPerHour: 0,
  daily: [],
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
    overall: { total_runs: 3, survived: 2, died: 1 },
    iskPerHour: 0,
    daily: [],
  });

  await view.render();

  const html = elements.get('statsContent').innerHTML;
  const labels = [
    'Total Runs', 'Avg Run Duration', 'Total Net', 'Avg Net / Run', 'Net / Hour',
    'Survived', 'Survival Rate', 'Deaths', 'Total Death Losses', 'Avg Death Loss',
  ];
  let previousIndex = -1;
  for (const label of labels) {
    const index = html.indexOf(label);
    assert.ok(index > previousIndex, `${label} should follow the previous tile`);
    previousIndex = index;
  }
  assert.match(html, /Avg Run Duration/);
  assert.doesNotMatch(html, /Avg Survival Duration/);
  assert.doesNotMatch(html, /class="analytics-fit-link"/);
  assert.equal(reportCalls[0][0], 'render');
});

test('statistics net tiles keep a general accent and color values by sign', async () => {
  const positive = createHarness({
    overall: {
      total_runs: 2,
      survived: 2,
      died: 0,
      total_net_isk: 100,
      avg_net_isk: 50,
    },
    iskPerHour: 25,
    daily: [],
  });
  await positive.view.render();

  const positiveHtml = positive.elements.get('statsContent').innerHTML;
  assert.match(positiveHtml,
    /tone-cyan[^>]*>[\s\S]*?Total Net[\s\S]*?stat-card-value green">100/);
  assert.match(positiveHtml,
    /tone-cyan[^>]*>[\s\S]*?Avg Net \/ Run[\s\S]*?stat-card-value green">50/);
  assert.match(positiveHtml,
    /tone-cyan[^>]*>[\s\S]*?Net \/ Hour[\s\S]*?stat-card-value green">25/);

  const negative = createHarness({
    overall: {
      total_runs: 1,
      survived: 1,
      died: 0,
      total_net_isk: -100,
      avg_net_isk: -100,
    },
    iskPerHour: -25,
    daily: [],
  });
  await negative.view.render();

  const negativeHtml = negative.elements.get('statsContent').innerHTML;
  assert.match(negativeHtml,
    /tone-cyan[^>]*>[\s\S]*?Total Net[\s\S]*?stat-card-value red">-100/);
  assert.match(negativeHtml,
    /tone-cyan[^>]*>[\s\S]*?Avg Net \/ Run[\s\S]*?stat-card-value red">-100/);
  assert.match(negativeHtml,
    /tone-cyan[^>]*>[\s\S]*?Net \/ Hour[\s\S]*?stat-card-value red">-25/);
});
