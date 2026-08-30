(function initCharacterTrackingUiController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssCharacterTrackingUi = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function createCharacterTrackingUiController({
    document,
    state,
    parseTags,
    setInventoryText,
  }) {
    if (!document || !state || typeof parseTags !== 'function'
      || typeof setInventoryText !== 'function') {
      throw new TypeError('Character tracking UI requires document, state, and input helpers');
    }

    function foregroundStatus() {
      if (!state.activeRun) return 'Monitoring';
      if (state.runState === 'in-abyss') return 'In Abyss';
      if (state.runState === 'died') return 'Died';
      return 'Needs Cargo';
    }

    function createDraft() {
      if (!state.activeCharId) return null;
      return {
        version: 1,
        character_id: Number(state.activeCharId),
        tier: document.getElementById('tierSelect').value || 'Unknown',
        weather: document.getElementById('weatherSelect').value || 'Unknown',
        cargo_before: document.getElementById('cargoBeforeText').value,
        drone_before: document.getElementById('droneBeforeText').value,
        notes: document.getElementById('activeRunNotes').value,
        tags: parseTags(document.getElementById('activeRunTags').value),
      };
    }

    function applyDraft(draft) {
      document.getElementById('tierSelect').value = draft.tier;
      document.getElementById('weatherSelect').value = draft.weather;
      setInventoryText('cargoBeforeText', draft.cargo_before);
      setInventoryText('droneBeforeText', draft.drone_before);
      document.getElementById('activeRunNotes').value = draft.notes || '';
      document.getElementById('activeRunTags').value = (draft.tags || []).join(', ');
    }

    function renderStatuses(backgroundStatus) {
      const select = document.getElementById('charSelect');
      let activeCount = 0;
      let attentionCount = 0;
      for (const character of state.characters) {
        const selected = Number(character.id) === Number(state.activeCharId);
        const status = selected ? foregroundStatus() : backgroundStatus(character.id);
        const option = [...select.options].find(candidate => (
          Number(candidate.value) === Number(character.id)
        ));
        if (option) option.textContent = `${character.name} · ${status}`;
        if (status === 'In Abyss') activeCount++;
        if (status === 'Needs Cargo' || status === 'Died') attentionCount++;
      }
      select.value = state.activeCharId || '';
      const summary = document.getElementById('trackingSummary');
      const parts = [];
      if (activeCount) parts.push(`${activeCount} active`);
      if (attentionCount) parts.push(`${attentionCount} needs attention`);
      summary.textContent = parts.join(' · ');
      summary.hidden = parts.length === 0;
    }

    function renderEncounter(groupForRun, candidateGroupForRun) {
      const element = document.getElementById('activeEncounterStatus');
      const text = document.getElementById('activeEncounterText');
      const actions = document.getElementById('encounterCandidateActions');
      const run = state.activeRun;
      const participants = run ? groupForRun(run) : [];
      if (participants.length >= 2) {
        const names = participants.map(participant => participant.character_name).join(', ');
        text.textContent = `Group Abyssal · ${participants.length} characters · ${names}`;
        actions.hidden = true;
        element.hidden = false;
        return;
      }
      const candidates = run ? candidateGroupForRun(run) : [];
      if (candidates.length < 2) {
        element.hidden = true;
        text.textContent = '';
        actions.hidden = true;
        return;
      }
      text.textContent = `${candidates.length} characters may be sharing this Abyssal: `
        + candidates.map(candidate => candidate.character_name).join(', ');
      actions.hidden = false;
      element.hidden = false;
    }

    return Object.freeze({
      applyDraft,
      createDraft,
      foregroundStatus,
      renderEncounter,
      renderStatuses,
    });
  }

  return Object.freeze({ createCharacterTrackingUiController });
});
