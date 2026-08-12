const assert = require('node:assert/strict');
const test = require('node:test');

const { createHistoryView } = require('../src/renderer/history-view');
const { buildRun, createDocumentHarness } = require('./support/builders');

function createHarness(options = {}) {
  const { elements, document } = createDocumentHarness([
    ['historyDateFrom', { value: '2026-08-01' }],
    ['historyDateTo', { value: '2026-08-09' }],
    ['filterTier', { value: 'T5' }],
    ['filterWeather', { value: 'Gamma' }],
    ['filterOutcome', { value: 'Survived' }],
    ['historySearch', { value: 'mutaplasmid' }],
    ['historyHull', { value: 'Gila' }],
    ['historyTag', { value: 'Farm' }],
    ['historyContent', { innerHTML: '' }],
    ['historyFilterError', { textContent: '', hidden: true }],
    ['historyResultSummary', { textContent: '' }],
    ['historyActiveFilters', { innerHTML: '', hidden: true }],
    ['historyExportButton', { textContent: '' }],
    ['historyExportStatus', { textContent: '', hidden: true, className: '' }],
  ]);
  const calls = [];
  const exportCalls = [];
  const runs = [buildRun({
    id: 42,
    started_at: 1_754_000_000,
    tier: 'T5',
    weather: 'Gamma',
    hull_name: 'Gila',
    ship_class: 'Cruiser',
    duration: 900,
    outcome: 'Survived',
    net_isk: 500,
    total_loss: 0,
    system_name: 'Abyssal #32000123',
    tags: ['Farm'],
    matching_items: [{
      item_name: 'Unstable Large Plasma Mutaplasmid',
      type: 'gained',
    }],
  })];
  const view = createHistoryView({
    document,
    api: {
      runs: {
        getAll: async filters => {
          calls.push(filters);
          if (options.getAll) return options.getAll(filters);
          return runs.map(run => ({ ...run }));
        },
        exportCSV: async filters => {
          exportCalls.push(filters);
          return options.exportResult || {
            success: true, filePath: 'filtered.csv', scope: 'filtered', runCount: 1,
          };
        },
      },
    },
    getActiveCharacterId: () => 9001,
    formatIsk: value => String(value),
    formatDuration: value => String(value),
    escapeHtml: value => String(value),
  });
  return { calls, exportCalls, elements, runs, view };
}

test('history view maps rich filters and surfaces matching loot context', async () => {
  const { calls, elements, view } = createHarness();

  await view.render();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].character_id, 9001);
  assert.equal(calls[0].search, 'mutaplasmid');
  assert.equal('search_scope' in calls[0], false);
  assert.equal(calls[0].hull, 'Gila');
  assert.equal(calls[0].tag, 'Farm');
  assert.equal(calls[0].date_to - calls[0].date_from, 9 * 86_400);
  assert.equal(elements.get('historyResultSummary').textContent, '1 run');
  assert.match(elements.get('historyContent').innerHTML, /Unstable Large Plasma Mutaplasmid/);
  assert.match(elements.get('historyContent').innerHTML, /Loot:/);
  assert.match(elements.get('historyContent').innerHTML, /Abyssal #32000123/);
  assert.match(elements.get('historyContent').innerHTML, /Farm/);

  await view.sort('net_isk');
  assert.equal(calls.length, 2);
  assert.match(elements.get('historyContent').innerHTML, /sort-desc/);
});

test('history view reports invalid date ranges without querying', async () => {
  const { calls, elements, view } = createHarness();
  elements.get('historyDateFrom').value = '2026-08-10';
  elements.get('historyDateTo').value = '2026-08-09';

  await view.render();

  assert.equal(calls.length, 0);
  assert.equal(elements.get('historyFilterError').hidden, false);
  assert.match(elements.get('historyFilterError').textContent, /must not be before/);
});

test('statistics drill-through is visible, clearable, and used by CSV export', async () => {
  const { calls, exportCalls, elements, view } = createHarness();
  view.applyDrillThrough({
    filters: {
      tier: 'T6',
      date_from: 1_754_000_000,
      date_to: 1_754_086_400,
    },
    labels: ['Tier: T6', 'Date range: Today'],
  });

  await view.render();

  assert.equal(calls.at(-1).character_id, 9001);
  assert.equal(calls.at(-1).tier, 'T6');
  assert.equal(calls.at(-1).search, undefined);
  assert.equal(view.hasActiveFilters(), true);
  assert.equal(elements.get('historyActiveFilters').hidden, false);
  assert.match(elements.get('historyActiveFilters').innerHTML, /Tier: T6/);
  assert.equal(elements.get('historyExportButton').textContent, 'Export filtered history');

  await view.exportCsv();
  assert.equal(exportCalls.length, 1);
  assert.equal(exportCalls[0].tier, 'T6');
  assert.match(elements.get('historyExportStatus').textContent, /filtered history/);

  await view.clearFilters();
  assert.equal(calls.at(-1).tier, undefined);
  assert.equal(view.hasActiveFilters(), false);
  assert.equal(elements.get('historyActiveFilters').hidden, true);
  assert.equal(elements.get('historyExportButton').textContent, 'Export all history');
});

test('history view ignores stale asynchronous responses', async () => {
  const pending = [];
  const { elements, view } = createHarness({
    getAll: () => new Promise(resolve => pending.push(resolve)),
  });

  const firstRender = view.render();
  elements.get('historySearch').value = 'new request';
  const secondRender = view.render();

  pending[1]([buildRun({ id: 2, hull_name: 'Ishtar' })]);
  await secondRender;
  assert.match(elements.get('historyContent').innerHTML, /Ishtar/);

  pending[0]([buildRun({ id: 1, hull_name: 'Gila' })]);
  await firstRender;
  assert.match(elements.get('historyContent').innerHTML, /Ishtar/);
  assert.doesNotMatch(elements.get('historyContent').innerHTML, />Gila</);
});
