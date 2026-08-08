const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'app.js'),
  'utf8'
);

function functionSource(name, nextName) {
  const start = appJs.indexOf(`function ${name}`);
  const end = appJs.indexOf(`function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} was not found`);
  assert.notEqual(end, -1, `${nextName} was not found`);
  return appJs.slice(start, end);
}

test('historical re-appraisal stages changes until Save and supports Discard', () => {
  const statusHelper = functionSource('setReappraisalStatus', 'reappraiseRun');
  const reappraise = functionSource('reappraiseRun', 'saveHistoricalReappraisal');
  const save = functionSource('saveHistoricalReappraisal', 'discardHistoricalReappraisal');
  const discard = functionSource('discardHistoricalReappraisal', 'itemTableHtml');

  assert.match(statusHelper, /if \(!status\) return null/);
  assert.match(statusHelper, /status\.replaceChildren\(\)/);
  assert.match(reappraise, /if \(!statusEl \|\| !spinner \|\| !cargoBeforeEl \|\| !cargoAfterEl\) return/);
  assert.match(reappraise, /pendingHistoricalReappraisal = \{ runId, appraisal \}/);
  assert.match(reappraise, /setReappraisalActionsVisible\(runId, true\)/);
  assert.doesNotMatch(reappraise, /runs\.updateAppraisal/);
  assert.match(reappraise, /finally \{/);

  assert.match(save, /await window\.api\.runs\.updateAppraisal\(runId, pending\.appraisal\)/);
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
  const editFlow = functionSource('submitManualEntry', 'cancelRun');

  assert.match(html, /id="manualSaveBtn"[^>]*>Save<\/button>/);
  assert.match(html, /data-action="close-manual-entry">Cancel<\/button>/);
  assert.match(appJs, /manualSubmitLabel'\)\.textContent = 'Re-Appraise'/);
  assert.match(editFlow, /const pendingAppraisal = manualEditPendingAppraisal\?\.signature === formSignature/);
  assert.match(editFlow, /manualEditPendingAppraisal = \{/);
  assert.match(editFlow, /\? \{ meta, appraisal: pendingAppraisal\.appraisal \}/);
  assert.match(editFlow, /: \(manualEditOriginal\?\.total_loss \|\| 0\)/);
});
