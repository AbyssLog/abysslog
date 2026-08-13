const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'app.js'),
  'utf8'
);
const runDetailsJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'run-details-controller.js'),
  'utf8'
);

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} was not found`);
  assert.notEqual(end, -1, `${nextName} was not found`);
  return source.slice(start, end);
}

test('historical re-appraisal stages changes until Save and supports Discard', () => {
  const statusHelper = functionSource(runDetailsJs, 'setReappraisalStatus', 'reappraiseRun');
  const reappraise = functionSource(runDetailsJs, 'reappraiseRun', 'saveHistoricalReappraisal');
  const save = functionSource(runDetailsJs, 'saveHistoricalReappraisal', 'discardHistoricalReappraisal');
  const discard = functionSource(runDetailsJs, 'discardHistoricalReappraisal', 'itemTableHtml');

  assert.match(statusHelper, /if \(!status\) return null/);
  assert.match(statusHelper, /status\.replaceChildren\(\)/);
  assert.match(reappraise, /if \(!statusEl \|\| !spinner \|\| !cargoBeforeEl \|\| !cargoAfterEl\) return/);
  assert.match(reappraise, /pendingHistoricalReappraisal = \{ runId, appraisal \}/);
  assert.match(reappraise, /setReappraisalActionsVisible\(runId, true\)/);
  assert.doesNotMatch(reappraise, /runs\.updateAppraisal/);
  assert.match(reappraise, /finally \{/);

  assert.match(save, /await api\.runs\.updateAppraisal\(runId, pending\.appraisal\)/);
  assert.match(save, /await refreshSavedRunViews\(\)/);
  assert.match(save, /await showRunDetail\(runId\)/);
  assert.match(discard, /pendingHistoricalReappraisal = null/);
  assert.match(discard, /await showRunDetail\(runId\)/);
  assert.doesNotMatch(discard, /runs\.updateAppraisal/);
});

test('run editing exposes Re-Appraise, Save, and Cancel with staged appraisal values', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'index.html'),
    'utf8'
  );
  const editFlow = functionSource(appJs, 'submitManualEntry', 'cancelRun');

  assert.match(html, /id="manualSaveBtn"[^>]*>Save<\/button>/);
  assert.match(html, /data-action="close-manual-entry">Cancel<\/button>/);
  assert.match(appJs, /manualSubmitLabel'\)\.textContent = 'Re-Appraise'/);
  assert.match(editFlow, /const pendingAppraisal = manualEditPendingAppraisal\?\.signature === formSignature/);
  assert.match(editFlow, /manualEditPendingAppraisal = \{/);
  assert.match(editFlow, /\? \{ meta, appraisal: pendingAppraisal\.appraisal \}/);
  assert.match(editFlow, /: \(editOriginal\?\.total_loss \|\| 0\)/);
});
