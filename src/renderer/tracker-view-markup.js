(function initTrackerViewMarkup(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssTrackerViewMarkup = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function sessionCardHtml() {
    return `<div class="panel tracker-session-panel tile-tone tone-green" id="trackerSessionPanel">
      <div class="tracker-panel-title-row">
        <div class="panel-title"><span class="ui-icon icon-session" aria-hidden="true"></span>Current Session</div>
        <span class="tracker-session-active" id="trackerSessionActive" hidden>1 active</span>
      </div>
      <div class="tracker-session-empty" id="trackerSessionEmpty">No active session</div>
      <div class="tracker-session-grid" id="trackerSessionGrid" hidden>
        <div><div class="field-label">Runs</div><div class="tracker-session-value" id="trackerSessionRuns">0</div></div>
        <div><div class="field-label">Survival</div><div class="tracker-session-value green" id="trackerSessionSurvival">—</div></div>
        <div><div class="field-label">Run Time</div><div class="tracker-session-value mono" id="trackerSessionDuration">00:00:00</div></div>
        <div><div class="field-label">Session Net</div><div class="tracker-session-value mono" id="trackerSessionNet">—</div></div>
      </div>
    </div>`;
  }

  function reviewModalHtml() {
    return `<div class="modal-overlay" id="preRunReviewModal" role="dialog" aria-modal="true"
      aria-hidden="true" aria-labelledby="preRunReviewTitle">
      <div class="modal pre-run-review-modal" tabindex="-1">
        <div class="modal-title">
          <span class="modal-title-label" id="preRunReviewTitle"><span class="ui-icon icon-cargo" aria-hidden="true"></span>Review Pre-Run Contents</span>
          <button type="button" class="modal-close" data-action="close-modal"
            data-modal="preRunReviewModal" aria-label="Close pre-run contents">✕</button>
        </div>
        <p class="field-note pre-run-review-note">
          Changes here update the captured pre-run comparison for this unfinished run.
        </p>
        <div id="preRunReviewMount"></div>
        <div class="modal-button-row">
          <span class="spacer"></span>
          <button type="button" class="btn primary sm" data-action="close-modal"
            data-modal="preRunReviewModal">Done</button>
        </div>
      </div>
    </div>`;
  }

  return Object.freeze({ reviewModalHtml, sessionCardHtml });
});
