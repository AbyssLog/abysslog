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
const runDetailsJs = fs.readFileSync(
  path.join(projectRoot, 'src', 'renderer', 'run-details-controller.js'),
  'utf8'
);
const statsViewJs = fs.readFileSync(
  path.join(projectRoot, 'src', 'renderer', 'stats-view.js'),
  'utf8'
);
const statsReportMarkup = fs.readFileSync(
  path.join(projectRoot, 'src', 'renderer', 'statistics-report-markup.js'),
  'utf8'
);

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
  assert.equal((runDetailsJs.match(/class="run-detail-inventory-card"/g) || []).length, 6);
  assert.match(styles, /\.run-detail-inventory-card \{[^}]*display: flex/s);
  assert.match(styles, /\.inventory-unchanged-badge/);
});

test('unchanged drone fallback remains visual until edited and clipboard wording is explicit', () => {
  assert.match(runDetailsJs, /data-inventory-fallback="unchanged"/);
  assert.match(runDetailsJs, /dataset\.inventoryFallback === 'unchanged'/);
  assert.match(appJs, /delete element\.dataset\.inventoryFallback/);
  assert.match(editorJs, /'Paste Clipboard'/);
  assert.doesNotMatch(editorJs, /'Paste from EVE'/);
  assert.match(runDetailsJs, /Implants are included as cargo/);
});

test('Statistics precedes History in the primary navigation', () => {
  const statistics = html.indexOf('data-page="stats"');
  const history = html.indexOf('data-page="history"');
  assert.ok(statistics >= 0);
  assert.ok(history > statistics);
});

test('History is the single run CSV export location', () => {
  assert.match(html, /data-action="history-export-csv"/);
  assert.doesNotMatch(html, /data-action="export-csv"/);
  assert.match(html, /Export run history from the History tab/);
  assert.match(html, /data-action="import-csv"/);
});

test('Statistics keeps the overview and provides a responsive report builder', () => {
  assert.match(html, /id="statsReportSection"[^>]*aria-labelledby="statsReportTitle"/);
  assert.match(statsReportMarkup, /id=\"statsReportMode\"/);
  assert.match(statsReportMarkup, /id=\"statsReportGroupPrimary\"/);
  assert.match(statsReportMarkup, /id=\"statsReportMetrics\"/);
  assert.match(styles, /\.stats-report-toolbar,[\s\S]*grid-template-columns: repeat\(auto-fit/);
  assert.match(styles, /\.stats-report-table \{[^}]*min-width: 760px/);
  assert.match(styles, /\.stats-report-table th\.stat-number \.table-sort \{[^}]*text-align: right/);
  assert.match(styles, /#statsReportItem \{[^}]*background-color: var\(--surface\)[^}]*color-scheme: dark/);
  assert.match(styles, /#statsReportItem:-webkit-autofill[\s\S]*-webkit-box-shadow: 0 0 0 1000px var\(--surface\) inset/);
  assert.doesNotMatch(statsViewJs, /section-title">By Tier/);
  assert.doesNotMatch(statsViewJs, /section-title">By Weather/);
});
