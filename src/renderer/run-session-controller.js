(function exposeRunSession(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssRunSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function requireFunction(value, label) {
    if (typeof value !== 'function') throw new TypeError(label + ' must be a function');
    return value;
  }

  function createRunSessionController({
    getActiveRun,
    createSnapshot,
    saveActive,
    clearActive,
    syncInputs = () => {},
    onCheckpointError = () => {},
    debounceMs = 250,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    const currentRun = requireFunction(getActiveRun, 'getActiveRun');
    const snapshotActiveRun = requireFunction(createSnapshot, 'createSnapshot');
    const save = requireFunction(saveActive, 'saveActive');
    const clear = requireFunction(clearActive, 'clearActive');
    const sync = requireFunction(syncInputs, 'syncInputs');
    const reportCheckpointError = requireFunction(onCheckpointError, 'onCheckpointError');
    const scheduleTimer = requireFunction(setTimer, 'setTimer');
    const cancelTimer = requireFunction(clearTimer, 'clearTimer');
    if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) {
      throw new TypeError('debounceMs must be a non-negative integer');
    }

    let appraisalGeneration = 0;
    let checkpointTimer = null;
    let checkpointChain = Promise.resolve();

    function isCurrent(run) {
      return currentRun() === run && !run?.finalizing && !run?.suspended;
    }

    function beginAppraisal(run) {
      appraisalGeneration++;
      return appraisalGeneration;
    }

    function invalidateAppraisals() {
      appraisalGeneration++;
    }

    function isLatestAppraisal(generation) {
      return generation === appraisalGeneration;
    }

    function isCurrentAppraisal(run, generation) {
      return isLatestAppraisal(generation) && isCurrent(run);
    }

    function cancelScheduledCheckpoint() {
      if (checkpointTimer === null) return;
      cancelTimer(checkpointTimer);
      checkpointTimer = null;
    }

    function beginFinalization(run) {
      if (currentRun() !== run || run?.finalizing) return false;
      run.finalizing = true;
      cancelScheduledCheckpoint();
      return true;
    }

    function rollbackFinalization(run) {
      if (currentRun() !== run || !run?.finalizing) return false;
      run.finalizing = false;
      return true;
    }

    function suspend(run) {
      if (currentRun() !== run || run?.finalizing) return false;
      run.suspended = true;
      cancelScheduledCheckpoint();
      return true;
    }

    function resume(run) {
      if (currentRun() !== run || run?.finalizing) return false;
      run.suspended = false;
      return true;
    }

    function persist() {
      const snapshot = snapshotActiveRun();
      if (!snapshot) return checkpointChain;
      checkpointChain = checkpointChain
        .catch(() => {})
        .then(() => save(snapshot));
      return checkpointChain;
    }

    function scheduleCheckpoint() {
      const run = currentRun();
      if (!isCurrent(run)) return;
      cancelScheduledCheckpoint();
      checkpointTimer = scheduleTimer(() => {
        checkpointTimer = null;
        if (!isCurrent(run)) return;
        sync();
        void persist().catch(reportCheckpointError);
      }, debounceMs);
    }

    function clearPersisted(characterId) {
      cancelScheduledCheckpoint();
      checkpointChain = checkpointChain
        .catch(() => {})
        .then(() => clear(characterId));
      return checkpointChain;
    }

    return {
      beginAppraisal,
      beginFinalization,
      cancelScheduledCheckpoint,
      clearPersisted,
      invalidateAppraisals,
      isCurrent,
      isCurrentAppraisal,
      isLatestAppraisal,
      persist,
      resume,
      rollbackFinalization,
      scheduleCheckpoint,
      suspend,
    };
  }

  return { createRunSessionController };
});
