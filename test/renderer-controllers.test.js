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
