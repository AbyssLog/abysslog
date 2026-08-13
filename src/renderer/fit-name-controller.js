(function initFitNameController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssFitNames = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function createFitNameController({
    document,
    api,
    openModal,
    closeModal,
    onSaved = null,
  }) {
    if (!document || !api?.runs?.setFitDisplayName) {
      throw new Error('Fit name controller requires document and run APIs');
    }
    if (typeof openModal !== 'function' || typeof closeModal !== 'function') {
      throw new TypeError('Fit name controller requires modal controls');
    }
    if (onSaved !== null && typeof onSaved !== 'function') {
      throw new TypeError('Fit name save callback must be a function');
    }

    function open(element) {
      const fitIdentityId = Number(element.dataset.fitIdentityId);
      if (!Number.isSafeInteger(fitIdentityId)) throw new TypeError('Fit identity is invalid');
      const displayName = element.dataset.fitDisplayName || '';
      const hullName = element.dataset.fitHullName || 'this hull';
      document.getElementById('fitNameIdentityId').value = String(fitIdentityId);
      document.getElementById('fitNameInput').value = displayName;
      document.getElementById('fitNameHelp').textContent =
        `Equivalent ${hullName} snapshots will share this display name. `
        + 'Captured setups and equivalence are unchanged.';
      document.getElementById('clearFitNameButton').hidden = !displayName;
      openModal('fitNameModal');
      document.getElementById('fitNameInput').focus();
    }

    async function persist(displayName) {
      const fitIdentityId = Number(document.getElementById('fitNameIdentityId').value);
      if (!Number.isSafeInteger(fitIdentityId)) throw new TypeError('Fit identity is invalid');
      const result = await api.runs.setFitDisplayName(fitIdentityId, displayName);
      closeModal('fitNameModal');
      if (onSaved) await onSaved(result);
      return result;
    }

    function save() {
      const input = document.getElementById('fitNameInput');
      const name = input.value.trim();
      if (!name) {
        input.focus();
        throw new TypeError('Fit display name is required');
      }
      return persist(name);
    }

    function clear() {
      return persist(null);
    }

    return Object.freeze({ clear, open, save });
  }

  return Object.freeze({ createFitNameController });
});
