const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { JSDOM } = require('jsdom');
const reporting = require('../src/shared/statistics-report');
const {
  createStatisticsReportController,
} = require('../src/renderer/statistics-report-controller');

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function harness({ reports = null } = {}) {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'index.html'),
    'utf8'
  );
  const dom = new JSDOM(html);
  const requests = [];
  const drillThrough = [];
  const api = {
    runs: {
      getStatisticsReportOptions: async () => ({
        items: ['Triglavian Survey Database', 'Zero-Point Condensate'],
        hulls: [{ hull_name: 'Gila', ship_class: 'Cruiser', label: 'Gila (Cruiser)' }],
        fits: [{
          fit_identity_id: 7,
          fit_key: 'abc12345',
          hull_name: 'Gila',
          display_name: 'Gamma Gila',
          label: 'Gamma Gila',
          representative_run_id: 42,
        }],
        truncated: false,
      }),
      getStatisticsReport: async request => {
        requests.push(request);
        if (reports) return reports(request);
        return {
          version: 1,
          mode: request.mode,
          group_by: request.group_by,
          metrics: request.metrics,
          population: 'filtered_runs',
          truncated: false,
          rows: [{
            dimensions: { tier: 'T5' },
            values: { runs: 3, survived: 2, died: 1, survival_pct: 66.666, duration_avg: 600, net_avg: 50 },
          }],
        };
      },
    },
  };
  const controller = createStatisticsReportController({
    document: dom.window.document,
    api,
    reporting,
    getActiveCharacterId: () => 9001,
    formatIsk: value => `${value} ISK`,
    formatDuration: value => `${value}s`,
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    onDrillThrough: selection => drillThrough.push(selection),
  });
  return {
    close: () => dom.window.close(),
    controller,
    document: dom.window.document,
    drillThrough,
    requests,
  };
}

test('report controller renders the default preset and dynamic columns', async () => {
  const { close, controller, document, requests } = harness();
  await controller.render({
    scope: { character_id: 9001, range_start: 100, range_end: 200 },
    history: { filters: { date_from: 100, date_to: 200 }, label: 'Date range: Test' },
  });
  assert.equal(document.getElementById('statsReportSection').hidden, false);
  assert.equal(requests[0].mode, 'runs');
  assert.deepEqual(requests[0].group_by, ['tier']);
  assert.match(document.getElementById('statsReportResults').textContent, /T5/);
  assert.match(document.getElementById('statsReportResults').textContent, /66\.7%/);
  assert.ok(document.querySelector(
    '#statsReportResults th.stat-number [data-report-sort-key="runs"]'
  ));
  assert.equal(
    document.querySelector('#statsReportResults [data-report-sort-key="tier"]')
      .closest('th').classList.contains('stat-number'),
    false
  );
  assert.match(document.getElementById('statsReportSummary').textContent, /1 report row/);
  close();
});

test('drop preset exposes cargo-observation metrics and exact History drill-through', async () => {
  const { close, controller, document, drillThrough, requests } = harness({
    reports: async request => ({
      version: 1,
      mode: request.mode,
      group_by: request.mode === 'drops' && !request.filters.item_name
        ? ['item', ...request.group_by]
        : request.group_by,
      metrics: request.metrics,
      population: 'survived_with_cargo_gain',
      truncated: false,
      rows: [{
        dimensions: { item: 'Triglavian Survey Database' },
        values: {
          observed_runs: 10,
          drop_runs: 8,
          drop_rate: 80,
          total_qty: 40,
          qty_per_run: 4,
        },
      }],
    }),
  });
  await controller.render({
    scope: { character_id: 9001 },
    history: { filters: { date_from: 100 }, label: 'Date range: Test' },
  });
  await controller.handlePreset('drop-rates');
  assert.equal(requests.at(-1).mode, 'drops');
  assert.deepEqual(requests.at(-1).group_by, []);
  assert.match(document.getElementById('statsReportResults').textContent, /Item/);
  assert.match(document.getElementById('statsReportSummary').textContent, /any cargo loot was gained/);
  controller.openHistory({ dataset: { reportRow: '0' } });
  assert.equal(drillThrough.length, 1);
  assert.deepEqual(drillThrough[0].filters, {
    date_from: 100,
    drop_item_name: 'Triglavian Survey Database',
  });
  close();
});

test('report controller ignores stale asynchronous results', async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const { close, controller, document } = harness({
    reports: () => (++call === 1 ? first.promise : second.promise),
  });
  const initialRender = controller.render({ scope: { character_id: 9001 }, history: {} });
  await new Promise(resolve => setImmediate(resolve));
  const latestRender = controller.run();
  second.resolve({
    version: 1, mode: 'runs', group_by: ['tier'], metrics: ['runs'],
    population: 'filtered_runs', truncated: false,
    rows: [{ dimensions: { tier: 'T6' }, values: { runs: 9 } }],
  });
  await latestRender;
  first.resolve({
    version: 1, mode: 'runs', group_by: ['tier'], metrics: ['runs'],
    population: 'filtered_runs', truncated: false,
    rows: [{ dimensions: { tier: 'T1' }, values: { runs: 1 } }],
  });
  await initialRender;
  assert.match(document.getElementById('statsReportResults').textContent, /T6/);
  assert.doesNotMatch(document.getElementById('statsReportResults').textContent, /T1/);
  close();
});

test('selecting one item creates a summary report without the implicit Item column', async () => {
  const { close, controller, document, requests } = harness();
  await controller.render({ scope: { character_id: 9001 }, history: {} });
  await controller.handlePreset('drop-rates');
  const item = document.getElementById('statsReportItem');
  item.value = 'Triglavian Survey Database';
  controller.handleDefinitionChange(item);
  await controller.run();
  assert.equal(document.getElementById('statsReportPreset').value, 'custom');
  assert.equal(document.getElementById('statsReportGroupPrimary').value, '');
  assert.deepEqual(requests.at(-1).filters, {
    item_name: 'Triglavian Survey Database',
  });
  assert.deepEqual(requests.at(-1).group_by, []);
  close();
});
