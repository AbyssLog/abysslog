(function initEncounterDetailView(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssEncounterDetail = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function render(run, { fmtIsk, esc }) {
    const participants = run.encounter_participants || [];
    if (participants.length < 2) return '';
    const survivedCount = participants.filter(participant => (
      participant.outcome === 'Survived'
    )).length;
    const groupNet = participants.reduce((total, participant) => (
      total + (participant.outcome === 'Survived'
        ? Number(participant.net_isk || 0)
        : -Number(participant.total_loss || 0))
    ), 0);
    return `<section class="encounter-detail">
      <div class="encounter-detail-heading">
        <div><div class="field-label">Group Abyssal</div>
        <div>${esc(participants.length)} ship entries · ${esc(survivedCount)} survived</div></div>
        <div class="encounter-detail-net ${groupNet >= 0 ? 'positive' : 'negative'}">
          ${groupNet >= 0 ? '+' : '−'}${fmtIsk(Math.abs(groupNet))}
        </div>
      </div>
      <div class="encounter-participants">${participants.map(participant => `
        <button type="button" class="encounter-participant${participant.id === run.id ? ' current' : ''}"
          data-action="show-run-detail" data-run-id="${esc(participant.id)}">
          <span>${esc(participant.character_name)} · ${esc(participant.hull_name || 'Unknown hull')}</span>
          <span class="badge ${participant.outcome === 'Survived' ? 'survived' : 'died'}">${esc(participant.outcome)}</span>
        </button>`).join('')}</div>
    </section>`;
  }

  return Object.freeze({ render });
});
