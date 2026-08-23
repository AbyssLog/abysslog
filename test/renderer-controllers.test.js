const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const { createModalController } = require('../src/renderer/modal-controller');
const { createNavigationController } = require('../src/renderer/navigation-controller');
const formatters = require('../src/renderer/ui-formatters');

test('navigation controller owns active page and accessible navigation state', () => {
  const dom = new JSDOM(`
    <button class="nav-btn active" data-page="tracker" aria-current="page"></button>
    <button class="nav-btn" data-page="history"></button>
    <main class="page active" id="page-tracker" aria-hidden="false"></main>
    <main class="page" id="page-history" aria-hidden="true"></main>
  `);
  const shown = [];
  const navigation = createNavigationController({
    document: dom.window.document,
    onShowPage: page => shown.push(page),
  });

  navigation.show('history');

  assert.equal(dom.window.document.getElementById('page-tracker').getAttribute('aria-hidden'), 'true');
  assert.equal(dom.window.document.getElementById('page-history').getAttribute('aria-hidden'), 'false');
  assert.equal(dom.window.document.querySelector('[data-page="tracker"]').hasAttribute('aria-current'), false);
  assert.equal(dom.window.document.querySelector('[data-page="history"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(shown, ['history']);
});

test('modal controller owns aria state, app inertness, and close requests', () => {
  const dom = new JSDOM(`
    <div class="app"><button id="origin">Open</button></div>
    <div class="modal-overlay" id="dialog" aria-hidden="true">
      <div class="modal" tabindex="-1"><button data-initial-focus>Close</button></div>
    </div>
  `, { pretendToBeVisual: true });
  dom.window.requestAnimationFrame = callback => callback();
  const requested = [];
  let controller;
  controller = createModalController({
    document: dom.window.document,
    onRequestClose: (id, close) => {
      requested.push(id);
      close(id);
    },
  });
  dom.window.document.getElementById('origin').focus();

  controller.open('dialog');
  assert.equal(dom.window.document.getElementById('dialog').getAttribute('aria-hidden'), 'false');
  assert.equal(dom.window.document.querySelector('.app').inert, true);

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.deepEqual(requested, ['dialog']);
  assert.equal(dom.window.document.getElementById('dialog').getAttribute('aria-hidden'), 'true');
  assert.equal(dom.window.document.querySelector('.app').inert, false);
});

test('UI formatters provide canonical values for shared renderer components', () => {
  assert.equal(formatters.formatIsk(1_250_000), '1.25M');
  assert.equal(formatters.formatDuration(3661), '01:01:01');
  assert.equal(formatters.formatBytes(1536), '1.5 KB');
  assert.equal(formatters.formatIsk(Number.NaN), '0');
});

const { createFitNameController } = require('../src/renderer/fit-name-controller');
const { createUiTaskController } = require('../src/renderer/ui-task-controller');
const { createSupportSettingsController } = require('../src/renderer/support-settings-controller');
const { createDocumentHarness } = require('./support/builders');

test('fit names save and clear through the dedicated controller', async () => {
  let focused = 0;
  const { elements, document } = createDocumentHarness([
    ['fitNameIdentityId', { value: '' }],
    ['fitNameInput', { value: '', focus: () => { focused += 1; } }],
    ['fitNameHelp', { textContent: '' }],
    ['clearFitNameButton', { hidden: true }],
  ]);
  const apiCalls = [];
  const modalCalls = [];
  const saved = [];
  const saveContexts = [];
  const controller = createFitNameController({
    document,
    api: {
      runs: {
        setFitDisplayName: async (fitIdentityId, displayName) => {
          apiCalls.push([fitIdentityId, displayName]);
          return { fit_identity_id: fitIdentityId, display_name: displayName };
        },
      },
    },
    openModal: id => modalCalls.push(['open', id]),
    closeModal: id => modalCalls.push(['close', id]),
    onSaved: (result, context) => {
      saved.push(result);
      saveContexts.push(context);
    },
  });

  controller.open({
    dataset: {
      fitIdentityId: '7',
      fitDisplayName: 'Gamma Runner',
      fitHullName: 'Gila',
      fitReturnRunId: '42',
    },
  });
  assert.equal(elements.get('fitNameIdentityId').value, '7');
  assert.equal(elements.get('fitNameInput').value, 'Gamma Runner');
  assert.match(elements.get('fitNameHelp').textContent, /Equivalent Gila snapshots/);
  assert.equal(elements.get('clearFitNameButton').hidden, false);
  elements.get('fitNameInput').value = '  Updated Gamma  ';
  await controller.save();
  await controller.clear();

  assert.equal(focused, 1);
  assert.deepEqual(apiCalls, [[7, 'Updated Gamma'], [7, null]]);
  assert.deepEqual(modalCalls, [
    ['open', 'fitNameModal'],
    ['close', 'fitNameModal'],
    ['close', 'fitNameModal'],
  ]);
  assert.deepEqual(saved.map(value => value.display_name), ['Updated Gamma', null]);
  assert.deepEqual(saveContexts, [{ runId: 42 }, null]);
});

test('support settings controller uses injected formatting, polling, and scheduling', async () => {
  const dom = new JSDOM(`
    <input id="janiceKeyInput" value="test-key" type="password">
    <button id="removeJaniceKeyBtn"></button>
    <div id="secureStorageStatus"></div>
    <input id="pollIntervalInput" value="10">
    <input id="defaultTierInput" value="T5">
    <input id="defaultWeatherInput" value="Gamma">
    <div id="janiceTestResult"></div>
    <div id="csvStatus"></div>
    <div id="settingsSaved"></div>
  `);
  const settingsCalls = [];
  const secretCalls = [];
  let pollingStarts = 0;
  const scheduled = [];
  const state = {
    activeCharId: 9001,
    capabilities: { tracking: true },
    hasJaniceKey: false,
    secureStorage: { available: true, backend: 'test' },
    settings: { esi_poll_interval: '5' },
    dataStatus: null,
    diagnosticsStatus: null,
  };
  const controller = createSupportSettingsController({
    document: dom.window.document,
    api: {
      janice: {
        testKey: async () => ({ items: [{ effectivePrices: { buyPrice: 123 } }] }),
      },
      secrets: { setJaniceKey: async key => secretCalls.push(key) },
      settings: { set: async (key, value) => settingsCalls.push([key, value]) },
    },
    state,
    formatBytes: String,
    formatIsk: value => 'formatted-' + value,
    renderCharList: () => {},
    refreshSavedRunViews: async () => {},
    startPolling: () => { pollingStarts += 1; },
    schedule: (callback, delay) => scheduled.push([callback, delay]),
  });

  await controller.testJaniceKey();
  assert.match(dom.window.document.getElementById('janiceTestResult').textContent, /formatted-123/);
  await controller.save();

  assert.deepEqual(secretCalls, ['test-key']);
  assert.deepEqual(settingsCalls, [
    ['esi_poll_interval', '10'],
    ['default_tier', 'T5'],
    ['default_weather', 'Gamma'],
  ]);
  assert.equal(pollingStarts, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][1], 2500);
});

test('UI tasks report failures and run bounded recovery without rejecting', async () => {
  const { elements, document } = createDocumentHarness([
    ['globalErrorNotice', { hidden: true }],
    ['globalErrorMessage', { textContent: '' }],
  ]);
  const diagnostics = [];
  const logged = [];
  let recovered = false;
  const controller = createUiTaskController({
    document,
    diagnostics: { recordRendererError: async category => diagnostics.push(category) },
    formatError: (context, error) => context + ': ' + error.message,
    logger: { error: (...values) => logged.push(values) },
  });

  await controller.runUiTask(
    'Could not save',
    async () => { throw new Error('disk full'); },
    () => { recovered = true; }
  );

  assert.equal(recovered, true);
  assert.deepEqual(diagnostics, ['ui-error']);
  assert.equal(elements.get('globalErrorNotice').hidden, false);
  assert.equal(elements.get('globalErrorMessage').textContent, 'Could not save: disk full');
  assert.equal(logged.length, 1);
  controller.dismissGlobalError();
  assert.equal(elements.get('globalErrorNotice').hidden, true);
});
