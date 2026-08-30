(function initLoadoutController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssLoadoutController = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  function createLoadoutController({
    document,
    api,
    state,
    loadouts,
    openModal,
    applyInventory,
    setInventoryText,
    confirmAction = message => globalThis.confirm(message),
    createId = () => `preset-${globalThis.crypto.randomUUID()}`,
  }) {
    if (!document || !api?.loadouts || !state || !loadouts) {
      throw new Error('Loadout controller requires document, loadout APIs, state, and helpers');
    }
    for (const dependency of [openModal, applyInventory, setInventoryText, confirmAction, createId]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Loadout controller dependencies must be functions');
      }
    }

    let editId = null;

    function findPreset(id) {
      return state.loadoutPresets.find(preset => preset.id === id) || null;
    }

    function populateSelect(select, emptyLabel, selectedId = '') {
      select.replaceChildren();
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = emptyLabel;
      select.append(emptyOption);
      const sortedPresets = [...state.loadoutPresets].sort((left, right) => (
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
      ));
      for (const preset of sortedPresets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        select.append(option);
      }
      select.value = findPreset(selectedId) ? selectedId : '';
    }

    function renderPresetSelect(preferredId = null) {
      const select = document.getElementById('loadoutPresetSelect');
      const selectedId = preferredId ?? select.value;
      populateSelect(select, '-- No presets saved --', selectedId);
      updateControls();
    }

    function updateControls() {
      const select = document.getElementById('loadoutPresetSelect');
      const apply = document.getElementById('applyLoadoutBtn');
      if (!select || !apply) return;
      apply.disabled = state.runState !== 'awaiting' || !findPreset(select.value);
    }

    function setEditorStatus(message = '', type = '') {
      const status = document.getElementById('loadoutEditorStatus');
      status.textContent = message;
      status.className = type ? `alert ${type}` : '';
      status.hidden = !message;
    }

    function renderManagerSelect(preferredId = '') {
      populateSelect(
        document.getElementById('loadoutManagerSelect'),
        '-- New preset --',
        preferredId
      );
    }

    function showEditorPreset(preset) {
      editId = preset?.id || null;
      document.getElementById('loadoutManagerSelect').value = editId || '';
      document.getElementById('loadoutNameInput').value = preset?.name || '';
      setInventoryText('loadoutCargoText', preset
        ? loadouts.formatInventoryItems(preset.cargo)
        : document.getElementById('cargoBeforeText').value);
      setInventoryText('loadoutDroneText', preset
        ? loadouts.formatInventoryItems(preset.drone)
        : document.getElementById('droneBeforeText').value);
      document.getElementById('deleteLoadoutBtn').hidden = !preset;
      setEditorStatus();
    }

    function startNewPreset() {
      renderManagerSelect('');
      showEditorPreset(null);
      document.getElementById('loadoutNameInput').focus();
    }

    function openManager() {
      const selectedId = document.getElementById('loadoutPresetSelect').value;
      renderManagerSelect(selectedId);
      showEditorPreset(findPreset(selectedId));
      openModal('loadoutModal');
    }

    function handleEditorSelection() {
      const selectedId = document.getElementById('loadoutManagerSelect').value;
      showEditorPreset(findPreset(selectedId));
    }

    async function savePreset() {
      try {
        const id = editId || createId();
        const preset = loadouts.createPresetFromInventoryText({
          id,
          name: document.getElementById('loadoutNameInput').value,
          cargoText: document.getElementById('loadoutCargoText').value,
          droneText: document.getElementById('loadoutDroneText').value,
        });
        const nextPresets = state.loadoutPresets.filter(existing => existing.id !== id);
        nextPresets.push(preset);
        state.loadoutPresets = await api.loadouts.save(nextPresets);
        renderPresetSelect(id);
        renderManagerSelect(id);
        showEditorPreset(findPreset(id));
        setEditorStatus(`Saved ${preset.name}.`, 'success');
      } catch (error) {
        setEditorStatus(error?.message || 'The loadout preset could not be saved.', 'err');
      }
    }

    async function deletePreset() {
      const preset = findPreset(editId);
      if (!preset || !confirmAction(`Delete the ${preset.name} loadout preset?`)) return;
      try {
        state.loadoutPresets = await api.loadouts.save(
          state.loadoutPresets.filter(existing => existing.id !== preset.id)
        );
        renderPresetSelect();
        startNewPreset();
        setEditorStatus(`Deleted ${preset.name}.`, 'success');
      } catch (error) {
        setEditorStatus(error?.message || 'The loadout preset could not be deleted.', 'err');
      }
    }

    function applyPreset() {
      if (state.runState !== 'awaiting' || state.activeRun) {
        throw new Error('A loadout preset can only be applied before a run starts');
      }
      const preset = findPreset(document.getElementById('loadoutPresetSelect').value);
      if (!preset) throw new Error('Choose a loadout preset first');
      applyInventory({
        cargoText: loadouts.formatInventoryItems(preset.cargo),
        droneText: loadouts.formatInventoryItems(preset.drone),
      });
      const status = document.getElementById('loadoutApplyStatus');
      status.textContent = `Applied ${preset.name} to the pre-run cargo hold and drone bay.`;
      status.hidden = false;
    }

    return Object.freeze({
      applyPreset,
      deletePreset,
      handleEditorSelection,
      openManager,
      renderPresetSelect,
      savePreset,
      startNewPreset,
      updateControls,
    });
  }

  return Object.freeze({ createLoadoutController });
});
