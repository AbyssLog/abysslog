const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { resolveDroneAfterSnapshot } = require('../src/renderer/inventory-editor');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'styles', 'app.css'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'app.js'), 'utf8');
const editorJs = fs.readFileSync(path.join(projectRoot, 'src', 'renderer', 'inventory-editor.js'), 'utf8');

test('empty survived post-run drone snapshots display the pre-run bay as unchanged', () => {
  assert.deepEqual(
    resolveDroneAfterSnapshot('Vespa II\t5', '', 'Survived'),
    { text: 'Vespa II\t5', usesFallback: true }
  );
  assert.deepEqual(
    resolveDroneAfterSnapshot('Vespa II\t5', 'Vespa II\t4', 'Survived'),
    { text: 'Vespa II\t4', usesFallback: false }
  );
  assert.deepEqual(
    resolveDroneAfterSnapshot('Vespa II\t5', '', 'Died'),
    { text: '', usesFallback: false }
  );
});

test('tracker places Run Setup after Recent Runs and history uses balanced inventory cards', () => {
  assert.match(appJs, /function initializeTrackerLayout\(\)/);
  assert.match(appJs, /recentRunsPanel\.after\(runSetup\)/);
  assert.equal((appJs.match(/class="run-detail-inventory-card"/g) || []).length, 6);
  assert.match(styles, /\.run-detail-inventory-card \{[^}]*display: flex/s);
  assert.match(styles, /\.inventory-unchanged-badge/);
});

test('unchanged drone fallback remains visual until edited and clipboard wording is explicit', () => {
  assert.match(appJs, /data-inventory-fallback="unchanged"/);
  assert.match(appJs, /dataset\.inventoryFallback === 'unchanged'/);
  assert.match(appJs, /delete element\.dataset\.inventoryFallback/);
  assert.match(editorJs, /'Paste Clipboard'/);
  assert.doesNotMatch(editorJs, /'Paste from EVE'/);
});

test('Statistics precedes History in the primary navigation', () => {
  const statistics = html.indexOf('data-page="stats"');
  const history = html.indexOf('data-page="history"');
  assert.ok(statistics >= 0);
  assert.ok(history > statistics);
});

test('statistics tables use one fixed seven-column grid and uniform weather badges', () => {
  assert.match(styles, /\.stats-table \{[^}]*table-layout: fixed[^}]*min-width: 840px/);
  assert.match(styles, /\.stats-table th:first-child \{[^}]*width: 28%/);
  assert.match(styles, /\.stats-table \.stat-number \{[^}]*width: 12%[^}]*text-align: right/);
  assert.match(styles, /\.weather-badge-group \.badge\.weather \{[^}]*width: 78px/);
});
