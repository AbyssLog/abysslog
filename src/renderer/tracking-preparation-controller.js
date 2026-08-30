(function initTrackingPreparationController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssTrackingPreparation = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function createTrackingPreparationController({
    api,
    state,
    trackingUi,
    restoreBaseline,
    afterRestore,
    onSaved,
    onError,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    if (!api?.runs || !state || !trackingUi) {
      throw new TypeError('Tracking preparation requires run APIs, state, and UI mapping');
    }
    for (const dependency of [restoreBaseline, afterRestore, onSaved, onError, setTimer, clearTimer]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Tracking preparation dependencies must be functions');
      }
    }

    let timer = null;

    async function persist() {
      if (!state.activeCharId || state.activeRun || state.runState !== 'awaiting') return null;
      const draft = trackingUi.createDraft();
      if (!draft) return null;
      const saved = await api.runs.saveTrackingDraft(draft);
      onSaved(saved);
      return saved;
    }

    function schedule() {
      if (state.activeRun || state.runState !== 'awaiting') return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        void persist().catch(onError);
      }, 250);
    }

    async function restore(characterId) {
      const draft = await api.runs.getTrackingDraft(characterId);
      if (draft) {
        trackingUi.applyDraft(draft);
        onSaved(draft);
      } else {
        await restoreBaseline(characterId);
        await persist();
      }
      afterRestore(Boolean(draft));
      return draft;
    }

    return Object.freeze({ persist, restore, schedule });
  }

  return Object.freeze({ createTrackingPreparationController });
});
