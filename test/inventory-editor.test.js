const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  compareInventory,
  formatInventoryItems,
  inspectInventory,
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

test('all inventory entry surfaces opt into the structured editor', () => {
  const projectRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');

  for (const id of [
    'cargoBeforeText',
    'droneBeforeText',
    'cargoAfterText',
    'droneAfterText',
    'manualCargoBefore',
    'manualDroneBefore',
    'manualCargoAfter',
    'manualDroneAfter',
    'loadoutCargoText',
    'loadoutDroneText',
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-inventory-editor`));
  }

  assert.match(html, /src="\.\/inventory-editor\.js"/);
  assert.match(appJs, /id="detailCargoBefore"[^>]*data-inventory-editor/);
  assert.match(appJs, /inventoryEditors\.initialize\(document\.getElementById\('runDetailContent'\)\)/);
  assert.match(appJs, /function setInventoryText\(/);
});

test('tracker and historical details use responsive, purpose-built layouts', () => {
  const projectRoot = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(html, /class="tracker-workspace"/);
  assert.match(html, /class="tracker-sidebar" aria-label="Run overview"/);
  assert.match(html, /#runDetailModal .modal {[^}]*max-width: 1180px/s);
  assert.match(html, /.run-detail-actions {[^}]*position: sticky/s);
  assert.match(html, /@media \(max-width: 1080px\)/);
  assert.match(html, /\.tracker-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(appJs, /class="run-detail-summary"/);
  assert.match(appJs, /class="run-detail-appraisals"/);
  assert.match(appJs, /class="run-detail-inventory-grid"/);
  assert.match(appJs, /class="run-detail-actions"/);
});
