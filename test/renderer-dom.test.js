const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const projectRoot = path.join(__dirname, '..');
const rendererScripts = [
  'src/shared/fitting.js',
  'src/shared/security.js',
  'src/shared/run-tracking.js',
  'src/shared/loadouts.js',
  'src/shared/ui-errors.js',
  'src/shared/updates.js',
  'src/shared/statistics.js',
  'src/shared/ship-groups.js',
  'src/renderer/inventory-editor.js',
  'src/renderer/app.js',
];

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for ' + label);
}

function apiGroup(methods) {
  return new Proxy(methods, {
    get(target, property) {
      if (property in target) return target[property];
      return async () => null;
    },
  });
}

function createAppraisalResult(items) {
  return {
    items: items.map(item => ({
      itemType: { name: item.name },
      amount: item.qty,
      effectivePrices: {
        buyPrice: 500,
        sellPrice: 450,
        buyPriceTotal: 500 * item.qty,
        sellPriceTotal: 450 * item.qty,
      },
      buyOrderCount: 1,
      sellOrderCount: 1,
    })),
    totalBuyPrice: items.reduce((sum, item) => sum + 500 * item.qty, 0),
    totalSellPrice: items.reduce((sum, item) => sum + 450 * item.qty, 0),
    failures: '',
    unresolved: [],
    zeroPriceItems: [],
    datasetTime: null,
  };
}

async function createRendererHarness() {
  const html = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'index.html'),
    'utf8'
  );
  const dom = new JSDOM(html, {
    url: 'https://abysslog.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const characters = [
    { id: 1001, name: 'First Pilot', portrait_url: '', client_id: 'first' },
    { id: 1002, name: 'Second Pilot', portrait_url: '', client_id: 'second' },
  ];
  const firstRun = Math.floor(Date.UTC(2026, 7, 1) / 1000);
  const lastRun = Math.floor(Date.UTC(2026, 7, 2) / 1000);
  const state = {
    activeRunRequests: [],
    janiceCalls: [],
    janiceGate: null,
    manualSaveGate: null,
    manualSaves: [],
    runQueries: [],
    settingsWrites: [],
    stats: {
      overall: {
        total_runs: 2,
        survived: 1,
        avg_duration_survived: 900,
        total_net_isk: 500,
        avg_net_isk: 250,
        avg_loss: 500,
        total_loss: 500,
        first_run: firstRun,
        last_run: lastRun,
      },
      byTier: [],
      byWeather: [],
      iskPerHour: 1000,
    },
    daily: [
      { day: '2026-08-01', total_runs: 1, survived: 1, net_isk: 1000, total_loss: 0 },
      { day: '2026-08-02', total_runs: 1, survived: 0, net_isk: -500, total_loss: 500 },
    ],
  };

  window.api = {
    settings: apiGroup({
      getAll: async () => ({ active_character: characters[0].id }),
      set: async (key, value) => {
        state.settingsWrites.push([key, value]);
        return true;
      },
    }),
    auth: apiGroup({
      getCharacters: async () => characters,
      getCapabilities: async () => ({}),
      hasTokens: async () => false,
      onComplete: () => {},
      onError: () => {},
    }),
    secrets: apiGroup({
      status: async () => ({ available: true, backend: 'test' }),
      hasJaniceKey: async () => true,
    }),
    data: apiGroup({
      getStatus: async () => null,
    }),
    diagnostics: apiGroup({
      getStatus: async () => null,
      recordRendererError: async () => true,
    }),
    loadouts: apiGroup({
      get: async () => [],
    }),
    app: apiGroup({
      getVersion: async () => '1.1.2',
    }),
    runs: apiGroup({
      getAll: async (filters = {}) => {
        state.runQueries.push({ ...filters });
        return [];
      },
      getActive: async characterId => {
        state.activeRunRequests.push(characterId);
        return null;
      },
      getInventoryBaseline: async () => null,
      saveActive: async () => true,
      clearActive: async () => true,
      save: async data => {
        state.manualSaves.push(data);
        if (state.manualSaveGate) return state.manualSaveGate.promise;
        return { id: state.manualSaves.length };
      },
      getStats: async () => state.stats,
      getDailyStats: async () => state.daily,
    }),
    janice: apiGroup({
      appraise: async (items, pricing) => {
        state.janiceCalls.push({ items, pricing });
        if (state.janiceGate) return state.janiceGate.promise;
        return createAppraisalResult(items);
      },
    }),
    esi: apiGroup({}),
    shell: apiGroup({}),
  };

  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 600,
  });

  for (const relativePath of rendererScripts) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    window.eval(source + '\n//# sourceURL=' + relativePath);
  }

  await waitFor(
    () => window.document.getElementById('aboutVersion').textContent === 'Version 1.1.2',
    'renderer initialization'
  );
  await waitFor(
    () => state.activeRunRequests.includes(characters[0].id),
    'initial character restoration'
  );
  assert.equal(window.document.getElementById('globalErrorNotice').hidden, true);

  return {
    characters,
    close: () => window.close(),
    document: window.document,
    state,
    window,
  };
}

function changeValue(window, element, value) {
  element.value = String(value);
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('renderer async workflows execute against the real DOM', async t => {
  const harness = await createRendererHarness();
  const {
    characters,
    document,
    state,
    window,
  } = harness;

  try {
    await t.test('character switches refresh visible history', async () => {
      document.querySelector('[data-page="history"]').click();
      await waitFor(
        () => state.runQueries.some(query =>
          query.character_id === characters[0].id && query.limit === undefined),
        'initial history render'
      );

      state.runQueries.length = 0;
      changeValue(window, document.getElementById('charSelect'), characters[1].id);
      await waitFor(
        () => state.runQueries.some(query =>
          query.character_id === characters[1].id && query.limit === undefined),
        'history render for the selected character'
      );

      assert.deepEqual(
        state.settingsWrites.at(-1),
        ['active_character', characters[1].id]
      );
    });

    await t.test('manual submission is single-flight and unlocks after saving', async () => {
      document.querySelector('[data-page="tracker"]').click();
      document.querySelector('[data-action="open-manual-entry"]').click();
      const modal = document.getElementById('manualEntryModal');
      await waitFor(() => modal.classList.contains('open'), 'manual-entry modal');

      document.getElementById('manualTier').value = 'T1';
      document.getElementById('manualWeather').value = 'Electrical';
      state.manualSaveGate = createDeferred();

      const submit = modal.querySelector(
        '[data-action="submit-manual-entry"][data-appraise="true"]'
      );
      submit.click();
      submit.click();

      await waitFor(() => state.manualSaves.length === 1, 'single manual save');
      assert.equal(document.getElementById('manualTier').disabled, true);
      assert.equal(state.manualSaves[0].character_id, characters[1].id);

      state.manualSaveGate.resolve({ id: 42 });
      await waitFor(
        () => modal.getAttribute('aria-hidden') === 'true' && !submit.disabled,
        'manual-entry completion'
      );
      assert.equal(state.manualSaves.length, 1);
      state.manualSaveGate = null;
    });

    await t.test('late appraisal results cannot replace a switched character run', async () => {
      const previousActiveRequests = state.activeRunRequests.length;
      changeValue(window, document.getElementById('charSelect'), characters[0].id);
      await waitFor(
        () => state.activeRunRequests.length > previousActiveRequests
          && state.activeRunRequests.at(-1) === characters[0].id,
        'switch back to the first character'
      );

      document.querySelector('[data-page="tracker"]').click();
      document.getElementById('tierSelect').value = 'T2';
      document.getElementById('weatherSelect').value = 'Dark';
      document.getElementById('cargoBeforeText').value = '';
      document.querySelector('[data-action="manual-start"]').click();
      await waitFor(
        () => document.getElementById('state-in-abyss').style.display === 'block',
        'manual run start'
      );

      document.querySelector('[data-action="manual-end-survived"]').click();
      await waitFor(
        () => document.getElementById('state-awaiting-cargo').style.display === 'block',
        'manual run completion'
      );
      document.getElementById('cargoAfterText').value =
        'Triglavian Survey Database\t2';

      const previousJaniceCalls = state.janiceCalls.length;
      state.janiceGate = createDeferred();
      document.querySelector('[data-action="appraise-run"]').click();
      await waitFor(
        () => state.janiceCalls.length > previousJaniceCalls,
        'pending Janice appraisal'
      );

      const switchRequestCount = state.activeRunRequests.length;
      changeValue(window, document.getElementById('charSelect'), characters[1].id);
      await waitFor(
        () => state.activeRunRequests.length > switchRequestCount
          && state.activeRunRequests.at(-1) === characters[1].id,
        'switch away from the appraised run'
      );

      state.janiceGate.resolve(createAppraisalResult(
        state.janiceCalls.at(-1).items
      ));
      await waitFor(
        () => document.getElementById('appraiseSpinner').style.display === 'none',
        'discarded appraisal completion'
      );

      assert.equal(document.getElementById('state-awaiting').style.display, 'block');
      assert.notEqual(document.getElementById('state-appraisal').style.display, 'block');
      assert.equal(document.getElementById('appraisal-results').textContent, '');
      state.janiceGate = null;
    });

    await t.test('chart bars are painted before the ISK lines', async () => {
      document.querySelector('[data-page="stats"]').click();
      await waitFor(
        () => document.querySelector('#dailyChart svg g'),
        'statistics chart'
      );

      const painted = [...document.querySelector('#dailyChart svg g').children];
      const barIndex = painted.findIndex(element =>
        element.localName === 'rect'
        && element.getAttribute('fill') === '#4fc3f7');
      const iskLineIndex = painted.findIndex(element =>
        element.localName === 'path'
        && element.getAttribute('stroke') === '#66bb6a');

      assert.ok(barIndex >= 0, 'run-count bar should be rendered');
      assert.ok(iskLineIndex > barIndex, 'ISK line should be painted over the bars');
      assert.match(document.getElementById('statsContent').textContent, /Net \/ Hour/);
    });
  } finally {
    harness.close();
  }
});
