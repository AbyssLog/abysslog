(function exposeManualEncounterMarkup(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssManualEncounterMarkup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function modalHtml() {
    return `<div class="modal-overlay" id="manualEncounterModal" role="dialog" aria-modal="true"
      aria-hidden="true" aria-labelledby="manualEncounterTitle">
      <div class="modal manual-encounter-modal" tabindex="-1">
        <div class="modal-title">
          <span id="manualEncounterTitle">Enter Group Encounter</span>
          <button type="button" class="modal-close" data-action="close-manual-encounter"
            aria-label="Close manual group encounter dialog">✕</button>
        </div>
        <div class="manual-entry-mode" role="group" aria-label="Manual entry type">
          <button type="button" class="manual-entry-mode-option" data-action="switch-manual-entry-mode"
            data-manual-mode="solo" aria-pressed="false">Solo</button>
          <button type="button" class="manual-entry-mode-option active" data-action="switch-manual-entry-mode"
            data-manual-mode="group" aria-pressed="true">Group</button>
        </div>
        <div class="manual-encounter-shared-grid">
          <div><label class="field-label" for="manualEncounterTier">Tier</label>
            <select class="field-select" id="manualEncounterTier" data-initial-focus>
              <option value="">— Select —</option>
              <option value="T0">Tier 0</option><option value="T1">Tier 1</option>
              <option value="T2">Tier 2</option><option value="T3">Tier 3</option>
              <option value="T4">Tier 4</option><option value="T5">Tier 5</option>
              <option value="T6">Tier 6</option>
            </select></div>
          <div><label class="field-label" for="manualEncounterWeather">Weather</label>
            <select class="field-select" id="manualEncounterWeather">
              <option value="">— Select —</option>
              <option value="Electrical">Electrical</option><option value="Dark">Dark</option>
              <option value="Exotic">Exotic</option><option value="Firestorm">Firestorm</option>
              <option value="Gamma">Gamma</option>
            </select></div>
          <div><label class="field-label" for="manualEncounterShipClass">Ship Class</label>
            <select class="field-select" id="manualEncounterShipClass"
              data-change-action="manual-encounter-definition">
              <option value="Frigate">Frigate</option>
              <option value="Destroyer">Destroyer</option>
            </select></div>
          <div><label class="field-label" for="manualEncounterDuration">Duration (mm:ss)</label>
            <input class="field-input" id="manualEncounterDuration" placeholder="20:00"></div>
          <div><label class="field-label" for="manualEncounterDate">Date &amp; Time</label>
            <input type="datetime-local" class="field-input" id="manualEncounterDate"></div>
          <div><label class="field-label" for="manualEncounterSystem">System</label>
            <input class="field-input" id="manualEncounterSystem" maxlength="128"
              placeholder="Solar system or Abyssal ID"></div>
        </div>
        <div class="manual-encounter-heading">
          <div><div class="panel-title">Participants</div>
            <div class="field-note">Loot and consumables remain on the character whose inventory changed.</div></div>
          <button type="button" class="btn sm ghost" id="addManualEncounterParticipant"
            data-action="add-manual-encounter-participant">+ Add Participant</button>
        </div>
        <div id="manualEncounterParticipants"></div>
        <div id="manualEncounterStatus" role="alert" aria-live="assertive"></div>
        <div class="modal-button-row">
          <button type="button" class="btn ghost sm" data-action="close-manual-encounter">Cancel</button>
          <button type="button" class="btn gold" data-action="submit-manual-encounter">
            <span id="manualEncounterSpinner" class="spinner" hidden></span>
            Appraise &amp; Save Group
          </button>
        </div>
      </div>
    </div>`;
  }

  return Object.freeze({ modalHtml });
});
