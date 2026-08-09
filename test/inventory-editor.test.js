const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const {
  compareInventory,
  formatInventoryItems,
  initialize,
  inspectInventory,
  setValue,
} = require('../src/renderer/inventory-editor');

test('structured inventory summaries use the existing EVE paste parser', () => {
  const snapshot = inspectInventory([
    'Vespa II\t2\tCombat Drone\t10 m3',
    'Vespa II x 3',
    'Agency Hardshell\tBooster',
  ].join('\n'));

  assert.deepEqual(snapshot, {
    items: [
      { name: 'Vespa II', qty: 5 },
      { name: 'Agency Hardshell', qty: 1 },
    ],
    itemTypes: 2,
    totalUnits: 6,
  });
});

test('structured inventory rows serialize to the legacy text format', () => {
  assert.equal(formatInventoryItems([
    { name: '  Chaotic Exotic Filament  ', qty: 3 },
    { name: 'Caldari Navy Vespa', qty: 4 },
  ]), 'Chaotic Exotic Filament\t3\nCaldari Navy Vespa\t4');

  assert.throws(
    () => formatInventoryItems([{ name: 'Vespa II', qty: 0 }]),
    /invalid/
  );
});

test('comparison feedback preserves omitted post-run drone semantics', () => {
  assert.deepEqual(compareInventory('Vespa II\t5', ''), { gained: [], consumed: [] });
  assert.deepEqual(
    compareInventory('Vespa II\t5', 'Vespa II\t4\nTriglavian Survey Database\t2'),
    {
      gained: [{ name: 'Triglavian Survey Database', qty: 2 }],
      consumed: [{ name: 'Vespa II', qty: 1 }],
    }
  );
});

test('structured inventory surfaces initialize and update in the DOM', () => {
  const projectRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://abysslog.test/' });
  const previousDocument = global.document;
  const previousEvent = global.Event;
  global.document = dom.window.document;
  global.Event = dom.window.Event;
  try {
    assert.equal(initialize(dom.window.document).length, 10);
    setValue('cargoBeforeText', 'Vespa II\t5', { emit: true });
    setValue('cargoAfterText', 'Vespa II\t4\nTriglavian Survey Database\t2', {
      emit: true,
      announce: true,
    });
    const editor = dom.window.document.querySelector(
      '.inventory-editor[data-inventory-for="cargoAfterText"]'
    );
    assert.equal(editor.querySelectorAll('.inventory-item-row').length, 2);
    assert.match(editor.querySelector('.inventory-diff-summary').textContent, /gained/);
    assert.match(editor.querySelector('.inventory-diff-summary').textContent, /consumed/);
    assert.match(editor.querySelector('.inventory-editor-status').textContent, /Pasted 2 item types/);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousEvent === undefined) delete global.Event;
    else global.Event = previousEvent;
    dom.window.close();
  }
});

test('tracker and historical details use responsive, purpose-built layouts', () => {
  const projectRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'styles', 'app.css'), 'utf8');
  const appJs = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(html, /class="tracker-workspace"/);
  assert.match(html, /class="tracker-sidebar" aria-label="Run overview"/);
  assert.match(styles, /#runDetailModal .modal {[^}]*max-width: 1180px/s);
  assert.match(styles, /.run-detail-actions {[^}]*position: sticky/s);
  assert.match(styles, /@media \(max-width: 1080px\)/);
  assert.match(styles, /\.tracker-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(appJs, /class="run-detail-summary"/);
  assert.match(appJs, /class="run-detail-appraisals"/);
  assert.match(appJs, /class="run-detail-inventory-grid"/);
  assert.match(appJs, /class="run-detail-actions"/);
});
