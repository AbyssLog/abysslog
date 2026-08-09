const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { version: packageVersion } = require('../package.json');

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

function createHistoryRun(id, shipClass) {
  return {
    id,
    started_at: Math.floor(Date.UTC(2026, 7, id) / 1000),
    tier: 'T1',
    weather: 'Electrical',
    ship_class: shipClass,
    duration: 600,
    outcome: 'Survived',
    net_isk: 1_000,
    total_loss: 0,
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
    characterCapabilities: new Map(),
    completedRuns: [],
    clearActiveCalls: [],
    deleteCharacterCalls: [],
    deleteCharacterGate: null,
    esiPollCalls: 0,
    esiSystemId: 30_000_142,
    janiceCalls: [],
    janiceGate: null,
    killmailGate: null,
    killmailRequests: [],
    manualSaveGate: null,
    manualSaves: [],
    runDetails: new Map(),
    runQueryHandler: null,
    runQueries: [],
    settingsWrites: [],
    trackingCharacters: new Set(),
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
      getCapabilities: async characterId => state.characterCapabilities.get(characterId)
        || (state.trackingCharacters.has(characterId)
          ? { tracking: true }
          : {}),
      hasTokens: async characterId =>
        state.characterCapabilities.has(characterId)
        || state.trackingCharacters.has(characterId),
      deleteCharacter: async characterId => {
        state.deleteCharacterCalls.push(characterId);
        if (state.deleteCharacterGate) return state.deleteCharacterGate.promise;
        return true;
      },
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
      getVersion: async () => packageVersion,
    }),
    runs: apiGroup({
      getAll: async (filters = {}) => {
        const query = { ...filters };
        state.runQueries.push(query);
        if (state.runQueryHandler) return state.runQueryHandler(query);
        return [];
      },
      getActive: async characterId => {
        state.activeRunRequests.push(characterId);
        return null;
      },
      getInventoryBaseline: async () => null,
      saveActive: async () => true,
      clearActive: async characterId => {
        state.clearActiveCalls.push(characterId);
        return true;
      },
      getById: async runId => state.runDetails.get(runId) || null,
      save: async data => {
        state.manualSaves.push(data);
        if (state.manualSaveGate) return state.manualSaveGate.promise;
        return { id: state.manualSaves.length };
      },
      completeActive: async data => {
        state.completedRuns.push(data);
        return state.completedRuns.length;
      },
      getStats: async () => state.stats,
      getDailyStats: async () => state.daily,
      importCSV: async () => ({ success: true, imported: 1, skipped: 0, errors: [] }),
    }),
    janice: apiGroup({
      appraise: async (items, pricing) => {
        state.janiceCalls.push({ items, pricing });
        if (state.janiceGate) return state.janiceGate.promise;
        return createAppraisalResult(items);
      },
    }),
    esi: apiGroup({
      getLocation: async () => {
        state.esiPollCalls++;
        return { solar_system_id: state.esiSystemId };
      },
      getShip: async () => ({ ship_type_id: 17_918, ship_name: 'Gila' }),
      getSystemName: async () => 'Jita',
      getRecentAbyssLoss: async (...args) => {
        state.killmailRequests.push(args);
        if (state.killmailGate) return state.killmailGate.promise;
        return null;
      },
      getTypeNames: async typeIds => Object.fromEntries(
        typeIds.map(typeId => [typeId, `Type ${typeId}`])
      ),
    }),
    shell: apiGroup({}),
  };

  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 600,
  });
  window.confirm = () => true;

  for (const relativePath of rendererScripts) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
    new vm.Script(source, {
      filename: path.join(projectRoot, relativePath),
    }).runInContext(dom.getInternalVMContext());
  }

  await waitFor(
    () => window.document.getElementById('aboutVersion').textContent
      === `Version ${packageVersion}`,
    'renderer initialization'
  );
  await waitFor(
    () => state.activeRunRequests.includes(characters[0].id),
    'initial character restoration'
  );
  assert.equal(window.document.getElementById('globalErrorNotice').hidden, true);

  return {
    characters,
    evaluate: source => new vm.Script(source).runInContext(dom.getInternalVMContext()),
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
    evaluate,
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

    await t.test('late history responses cannot replace the selected character history', async () => {
      const staleHistory = createDeferred();
      state.runQueryHandler = query => {
        if (query.limit !== undefined) return [];
        if (query.character_id === characters[1].id) return staleHistory.promise;
        if (query.character_id === characters[0].id) {
          return [createHistoryRun(1, 'Current First Pilot Ship')];
        }
        return [];
      };
      state.runQueries.length = 0;

      document.querySelector('[data-page="history"]').click();
      await waitFor(
        () => state.runQueries.some(query =>
          query.character_id === characters[1].id && query.limit === undefined),
        'pending history for the previous character'
      );

      changeValue(window, document.getElementById('charSelect'), characters[0].id);
      await waitFor(
        () => document.getElementById('historyContent').textContent.includes('Current First Pilot Ship'),
        'history for the newly selected character'
      );

      staleHistory.resolve([createHistoryRun(2, 'Stale Second Pilot Ship')]);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.match(document.getElementById('historyContent').textContent, /Current First Pilot Ship/);
      assert.doesNotMatch(document.getElementById('historyContent').textContent, /Stale Second Pilot Ship/);
      state.runQueryHandler = null;
    });

    await t.test('late recent-run responses cannot replace the selected character summary', async () => {
      const staleRecentRuns = createDeferred();
      state.runQueryHandler = query => {
        if (query.limit === 5 && query.character_id === characters[0].id) {
          return staleRecentRuns.promise;
        }
        if (query.limit === 5 && query.character_id === characters[1].id) {
          return [{
            ...createHistoryRun(2, 'Current Second Pilot Ship'),
            tier: 'T2',
            weather: 'Dark',
          }];
        }
        return [];
      };
      state.runQueries.length = 0;

      document.querySelector('[data-action="import-csv"]').click();
      await waitFor(
        () => state.runQueries.some(query =>
          query.character_id === characters[0].id && query.limit === 5),
        'pending recent runs for the previous character'
      );

      changeValue(window, document.getElementById('charSelect'), characters[1].id);
      await waitFor(
        () => document.getElementById('recentRunsList').textContent.includes('T2 Dark'),
        'recent runs for the newly selected character'
      );

      staleRecentRuns.resolve([{
        ...createHistoryRun(1, 'Stale First Pilot Ship'),
        tier: 'T4',
        weather: 'Firestorm',
      }]);
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.match(document.getElementById('recentRunsList').textContent, /T2 Dark/);
      assert.doesNotMatch(document.getElementById('recentRunsList').textContent, /T4 Firestorm/);
      state.runQueryHandler = null;
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

    await t.test('historical run details initialize structured inventory editors', async () => {
      const detailRun = {
        ...createHistoryRun(7, 'Gila'),
        cargo_before: 'Caldari Navy Scourge Heavy Missile\t100',
        cargo_after: 'Caldari Navy Scourge Heavy Missile\t90\nTriglavian Survey Database\t2',
        drone_before: 'Vespa II\t5',
        drone_after: '',
        fitting: [],
        implants: [],
        items: [],
      };
      state.runDetails.set(detailRun.id, detailRun);
      state.runQueryHandler = query => query.limit === undefined ? [detailRun] : [];

      document.querySelector('[data-page="history"]').click();
      await waitFor(
        () => document.querySelector(
          `[data-action="show-run-detail"][data-run-id="${detailRun.id}"]`
        ),
        'history detail action'
      );
      document.querySelector(
        `[data-action="show-run-detail"][data-run-id="${detailRun.id}"]`
      ).click();
      await waitFor(
        () => document.getElementById('runDetailModal').classList.contains('open'),
        'historical run detail modal'
      );

      assert.equal(document.querySelectorAll('#runDetailContent .inventory-editor').length, 4);
      assert.match(document.getElementById('runDetailContent').textContent, /Unchanged/);
      assert.equal(document.getElementById('detailDroneAfter').value, 'Vespa II\t5');
      document.querySelector('[data-action="close-modal"][data-modal="runDetailModal"]').click();
      state.runQueryHandler = null;
    });

    await t.test('failed character deletion preserves the active run checkpoint', async () => {
      document.querySelector('[data-page="tracker"]').click();
      document.getElementById('tierSelect').value = 'T3';
      document.getElementById('weatherSelect').value = 'Gamma';
      document.querySelector('[data-action="manual-start"]').click();
      await waitFor(
        () => document.getElementById('state-in-abyss').style.display === 'block',
        'active run before character deletion'
      );

      const clearCallsBeforeDelete = state.clearActiveCalls.length;
      state.deleteCharacterGate = createDeferred();
      document.querySelector(
        `[data-action="remove-character"][data-character-id="${characters[1].id}"]`
      ).click();
      await waitFor(
        () => state.deleteCharacterCalls.at(-1) === characters[1].id,
        'character deletion request'
      );

      assert.equal(document.getElementById('state-in-abyss').style.display, 'block');
      assert.equal(state.clearActiveCalls.length, clearCallsBeforeDelete);
      const originalConsoleError = window.console.error;
      window.console.error = () => {};
      try {
        state.deleteCharacterGate.reject(new Error('Simulated database failure'));
        await waitFor(
          () => document.getElementById('globalErrorNotice').hidden === false,
          'character deletion error notice'
        );
      } finally {
        window.console.error = originalConsoleError;
      }
      assert.equal(document.getElementById('state-in-abyss').style.display, 'block');
      assert.equal(state.clearActiveCalls.length, clearCallsBeforeDelete);
      state.deleteCharacterGate = null;

      document.querySelector('[data-action="cancel-run"]').click();
      await waitFor(
        () => document.getElementById('state-awaiting').style.display === 'block',
        'active run cleanup'
      );
      document.querySelector('[data-action="dismiss-global-error"]').click();
    });

    await t.test('saving a changed poll interval restarts polling immediately', async () => {
      state.trackingCharacters.add(characters[0].id);
      const pollCallsBeforeSwitch = state.esiPollCalls;
      changeValue(window, document.getElementById('charSelect'), characters[0].id);
      await waitFor(
        () => state.esiPollCalls > pollCallsBeforeSwitch,
        'initial ESI poll for the tracking character'
      );

      document.querySelector('[data-page="settings"]').click();
      document.getElementById('pollIntervalInput').value = '7';
      const pollCallsBeforeSave = state.esiPollCalls;
      document.querySelector('[data-action="save-settings"]').click();
      await waitFor(
        () => state.settingsWrites.some(([key, value]) =>
          key === 'esi_poll_interval' && value === '7'),
        'saved poll interval'
      );
      await waitFor(
        () => state.esiPollCalls > pollCallsBeforeSave,
        'restarted ESI poll'
      );
    });

    await t.test('automatic runs preserve the Abyssal system captured on entry', async () => {
      document.querySelector('[data-page="tracker"]').click();
      state.esiSystemId = 32_000_001;
      await evaluate('pollESI(S.pollGeneration, S.activeCharId)');
      await evaluate('pollESI(S.pollGeneration, S.activeCharId)');
      await waitFor(
        () => document.getElementById('state-in-abyss').style.display === 'block',
        'automatic Abyssal entry'
      );

      state.esiSystemId = 30_000_142;
      await evaluate('pollESI(S.pollGeneration, S.activeCharId)');
      await evaluate('pollESI(S.pollGeneration, S.activeCharId)');
      await waitFor(
        () => document.getElementById('state-awaiting-cargo').style.display === 'block',
        'automatic Abyssal exit'
      );

      document.querySelector('[data-action="appraise-run"]').click();
      await waitFor(
        () => document.getElementById('state-appraisal').style.display === 'block',
        'automatic run appraisal'
      );

      const completedBeforeSave = state.completedRuns.length;
      document.querySelector('#state-appraisal [data-action="save-current-run"]').click();
      await waitFor(
        () => state.completedRuns.length === completedBeforeSave + 1,
        'automatic run persistence'
      );

      assert.equal(state.completedRuns.at(-1).system_id, 32_000_001);
      await waitFor(
        () => document.getElementById('state-awaiting').style.display === 'block',
        'automatic run reset'
      );
    });

    await t.test('late killmail outcomes cannot update a switched character UI', async () => {
      state.trackingCharacters.delete(characters[0].id);
      state.characterCapabilities.set(characters[0].id, { killmails: true });

      let switchRequests = state.activeRunRequests.length;
      changeValue(window, document.getElementById('charSelect'), characters[1].id);
      await waitFor(
        () => state.activeRunRequests.length > switchRequests
          && state.activeRunRequests.at(-1) === characters[1].id,
        'switch away before delayed killmail checks'
      );

      const settlements = [
        {
          label: 'missing killmail',
          settle: gate => gate.resolve(null),
        },
        {
          label: 'failed killmail request',
          settle: gate => gate.reject(new Error('Simulated killmail failure')),
        },
      ];

      for (const settlement of settlements) {
        switchRequests = state.activeRunRequests.length;
        changeValue(window, document.getElementById('charSelect'), characters[0].id);
        await waitFor(
          () => state.activeRunRequests.length > switchRequests
            && state.activeRunRequests.at(-1) === characters[0].id,
          `switch to loss-tracked character for ${settlement.label}`
        );

        document.querySelector('[data-page="tracker"]').click();
        document.getElementById('tierSelect').value = 'T4';
        document.getElementById('weatherSelect').value = 'Dark';
        document.querySelector('[data-action="manual-start"]').click();
        await waitFor(
          () => document.getElementById('state-in-abyss').style.display === 'block',
          `manual run start for ${settlement.label}`
        );

        const killmailRequestsBefore = state.killmailRequests.length;
        state.killmailGate = createDeferred();
        document.querySelector('[data-action="manual-end-died"]').click();
        await waitFor(
          () => state.killmailRequests.length === killmailRequestsBefore + 1,
          `pending ${settlement.label}`
        );

        switchRequests = state.activeRunRequests.length;
        changeValue(window, document.getElementById('charSelect'), characters[1].id);
        await waitFor(
          () => state.activeRunRequests.length > switchRequests
            && state.activeRunRequests.at(-1) === characters[1].id,
          `character switch during ${settlement.label}`
        );

        const status = document.getElementById('killmailStatus');
        const retryButton = document.getElementById('retryKillmailBtn');
        const switchedUi = {
          statusText: status.textContent,
          statusClass: status.className,
          statusDisplay: status.style.display,
          retryText: retryButton.textContent,
          retryDisplay: retryButton.style.display,
        };

        settlement.settle(state.killmailGate);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.deepEqual({
          statusText: status.textContent,
          statusClass: status.className,
          statusDisplay: status.style.display,
          retryText: retryButton.textContent,
          retryDisplay: retryButton.style.display,
        }, switchedUi);
        state.killmailGate = null;
      }

      state.characterCapabilities.delete(characters[0].id);
    });
  } finally {
    harness.close();
  }
});
