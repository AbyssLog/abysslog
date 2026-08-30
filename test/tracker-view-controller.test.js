const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const { createTrackerViewController } = require('../src/renderer/tracker-view-controller');

function createHarness({ activeRun = null, runState = 'awaiting', now = 1_800_000_000_000 } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="trackerSessionMount"></div>
    <div id="trackerViewModalMount"></div>
    <div id="preRunContentsPanel"><span class="run-contents-stage before">Before Run</span>
      <div id="preRunInventoryHome"><div id="preRunInventoryFields">
        <textarea id="cargoBeforeText">Missile\t10\nFilament\t1</textarea>
        <textarea id="droneBeforeText">Vespa II\t5</textarea>
      </div></div>
    </div>
    <span id="postRunPreSummary"></span>
    <textarea id="cargoAfterText"></textarea>
    <textarea id="droneAfterText"></textarea>
    <div id="recentRunsList"></div>
  </body>`);
  const refreshes = [];
  const modalOpens = [];
  const calls = [];
  const api = {
    runs: {
      getAll: async filters => {
        calls.push(['recent', filters]);
        return [{ tier: 'T5', weather: 'Gamma', outcome: 'Survived', net_isk: 12 }];
      },
      getSessionStats: async filters => {
        calls.push(['session', filters]);
        return {
          total_runs: 4,
          survived: 3,
          total_duration: 2400,
          total_net_isk: 120,
          ended_at: Math.floor(now / 1000) - 60,
          gap_seconds: 3600,
        };
      },
    },
  };
  const inventoryEditors = {
    inspectInventory: raw => {
      const rows = String(raw).trim().split(/\n/).filter(Boolean).map(line => line.split(/\t/));
      return {
        itemTypes: rows.length,
        totalUnits: rows.reduce((sum, row) => sum + Number(row[1] || 0), 0),
      };
    },
    refresh: id => refreshes.push(id),
  };
  const controller = createTrackerViewController({
    document: dom.window.document,
    api,
    inventoryEditors,
    formatDuration: value => `${value}s`,
    formatIsk: value => `${value} ISK`,
    escapeHtml: value => String(value),
    getActiveCharacterId: () => 9001,
    getActiveRun: () => activeRun,
    getRunState: () => runState,
    openModal: id => modalOpens.push(id),
    now: () => now,
  });
  return { calls, controller, document: dom.window.document, modalOpens, refreshes };
}

test('Tracker contents swaps to post-run entry and reviews the live pre-run fields', () => {
  const { controller, document, modalOpens, refreshes } = createHarness();
  controller.setState('awaiting-cargo');

  assert.equal(document.getElementById('preRunReviewModal').getAttribute('aria-modal'), 'true');
  assert.equal(document.getElementById('preRunContentsPanel').hidden, true);
  assert.equal(
    document.getElementById('postRunPreSummary').textContent,
    'Pre-run: 2 cargo item types · 5 drones'
  );

  controller.openPreRunReview();
  assert.deepEqual(modalOpens, ['preRunReviewModal']);
  assert.equal(
    document.getElementById('preRunInventoryFields').parentElement.id,
    'preRunReviewMount'
  );

  controller.restorePreRunFields();
  assert.equal(
    document.getElementById('preRunInventoryFields').parentElement.id,
    'preRunInventoryHome'
  );
  assert.deepEqual(refreshes, ['cargoAfterText', 'droneAfterText']);
});

test('Tracker session renders completed metrics and an active run', async () => {
  const activeRun = { started_at: 1_799_999_700, duration: 0 };
  const { calls, controller, document } = createHarness({
    activeRun,
    runState: 'in-abyss',
  });

  await controller.refresh();

  assert.deepEqual(calls, [
    ['recent', { character_id: 9001, limit: 3 }],
    ['session', { character_id: 9001 }],
  ]);
  assert.equal(document.getElementById('trackerSessionRuns').textContent, '4');
  assert.equal(document.getElementById('trackerSessionSurvival').textContent, '75%');
  assert.equal(document.getElementById('trackerSessionDuration').textContent, '2700s');
  assert.equal(document.getElementById('trackerSessionNet').textContent, '120 ISK');
  assert.equal(document.getElementById('trackerSessionActive').textContent, '1 active');
  assert.match(document.getElementById('recentRunsList').textContent, /T5 Gamma/);
});
