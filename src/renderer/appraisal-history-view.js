(function initAppraisalHistoryView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssAppraisalHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function render(history, { fmtIsk, esc }) {
    if (!Array.isArray(history) || history.length === 0) return '';
    let html = `<section class="appraisal-history">
      <div class="section-title">Appraisal History</div>
      <div class="appraisal-history-list">`;
    for (const appraisal of history) {
      const timestamp = appraisal.appraised_at
        ? new Date(appraisal.appraised_at * 1000).toLocaleString()
        : 'No appraisal timestamp';
      const value = appraisal.kind === 'loss'
        ? `Loss ${fmtIsk(appraisal.total_loss)}`
        : `Net ${appraisal.net_isk >= 0 ? '+' : ''}${fmtIsk(appraisal.net_isk)}`;
      html += `<div class="appraisal-history-row${appraisal.is_current ? ' current' : ''}">
        <div>
          <span class="appraisal-history-source">${esc(appraisal.source)}</span>
          ${appraisal.is_current ? '<span class="badge survived">Current</span>' : ''}
          <div class="field-note">${esc(timestamp)} · ${esc(appraisal.resolution_status)}</div>
        </div>
        <div class="mono appraisal-history-value">${esc(value)}</div>
      </div>`;
    }
    return `${html}</div></section>`;
  }

  return Object.freeze({ render });
});
