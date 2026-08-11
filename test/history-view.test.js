const assert = require('node:assert/strict');
const test = require('node:test');

const { createHistoryView } = require('../src/renderer/history-view');

function createHarness() {
  const elements = new Map([
    ['historyDateFrom', { value: '2026-08-01' }],
    ['historyDateTo', { value: '2026-08-09' }],
    ['filterTier', { value: 'T5' }],
    ['filterWeather', { value: 'Gamma' }],
    ['filterOutcome', { value: 'Survived' }],
    ['historySearch', { value: 'mutaplasmid' }],
    ['historyShip', { value: 'Gila' }],
    ['historyTag', { value: 'Farm' }],
    ['historyContent', { innerHTML: '' }],
    ['historyFilterError', { textContent: '', hidden: true }],
    ['historyResultSummary', { textContent: '' }],
  ]);
  const calls = [];
  const runs = [{
    id: 42,
    started_at: 1_754_000_000,
    tier: 'T5',
    weather: 'Gamma',
    ship_name: 'Gila',
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
  }];
  const document = { getElementById: id => elements.get(id) || null };
  const view = createHistoryView({
    document,
    api: {
      runs: {
        getAll: async filters => {
          calls.push(filters);
          return runs.map(run => ({ ...run }));
        },
      },
    },
    getActiveCharacterId: () => 9001,
    formatIsk: value => String(value),
    formatDuration: value => String(value),
    escapeHtml: value => String(value),
  });
  return { calls, elements, view };
}

test('history view maps rich filters and surfaces matching loot context', async () => {
  const { calls, elements, view } = createHarness();

  await view.render();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].character_id, 9001);
  assert.equal(calls[0].search, 'mutaplasmid');
  assert.equal('search_scope' in calls[0], false);
  assert.equal(calls[0].ship, 'Gila');
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
