(function initStatisticsReportMarkup(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssStatisticsReportMarkup = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function builderHtml() {
    return `<div class="stats-report-builder">
      <div class="stats-report-toolbar">
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportPreset">Preset</label>
          <select class="field-select" id="statsReportPreset" data-change-action="stats-report-preset"></select>
        </div>
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportMode">Report</label>
          <select class="field-select" id="statsReportMode" data-change-action="stats-report-mode"></select>
        </div>
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportGroupPrimary">Group by</label>
          <select class="field-select" id="statsReportGroupPrimary" data-change-action="stats-report-definition"></select>
        </div>
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportGroupSecondary">Then by</label>
          <select class="field-select" id="statsReportGroupSecondary" data-change-action="stats-report-definition"></select>
        </div>
      </div>
      <div class="stats-report-filters">
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportTier">Tier</label>
          <select class="field-select" id="statsReportTier" data-change-action="stats-report-definition"></select>
        </div>
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportWeather">Weather</label>
          <select class="field-select" id="statsReportWeather" data-change-action="stats-report-definition"></select>
        </div>
        <div class="stats-filter-field" id="statsReportOutcomeField">
          <label class="field-label" for="statsReportOutcome">Outcome</label>
          <select class="field-select" id="statsReportOutcome" data-change-action="stats-report-definition"></select>
        </div>
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportHull">Hull</label>
          <select class="field-select" id="statsReportHull" data-change-action="stats-report-definition">
            <option value="">Any hull</option>
          </select>
        </div>
        <div class="stats-filter-field">
          <label class="field-label" for="statsReportFit">Fit</label>
          <select class="field-select" id="statsReportFit" data-change-action="stats-report-definition">
            <option value="">Any fit</option>
          </select>
        </div>
        <div class="stats-filter-field" id="statsReportItemField" hidden>
          <label class="field-label" for="statsReportItem">Item</label>
          <input class="field-input" id="statsReportItem" maxlength="256"
            list="statsReportItemOptions" placeholder="All dropped items"
            data-change-action="stats-report-definition">
          <datalist id="statsReportItemOptions"></datalist>
        </div>
      </div>
      <fieldset class="stats-report-metrics-fieldset">
        <legend class="field-label">Columns</legend>
        <div class="stats-report-metrics" id="statsReportMetrics"></div>
      </fieldset>
      <div class="field-note" id="statsReportOptionNote"></div>
      <div class="stats-report-actions">
        <button type="button" class="btn gold sm" data-action="run-statistics-report">Run Report</button>
        <button type="button" class="btn ghost sm" data-action="reset-statistics-report">Reset</button>
        <div class="stats-report-summary" id="statsReportSummary" role="status" aria-live="polite"></div>
      </div>
      <div class="stats-filter-error" id="statsReportError" role="alert" hidden></div>
    </div>
    <div id="statsReportResults"></div>`;
  }

  return Object.freeze({ builderHtml });
});
