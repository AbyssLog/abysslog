(function initManualEncounterController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./manual-encounter-markup'));
  } else {
    root.AbyssManualEncounters = factory(root.AbyssManualEncounterMarkup);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule(markup) {
  function parseDuration(value) {
    const parts = String(value || '').trim().split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return Number.parseInt(value, 10) || 0;
  }

  function createManualEncounterController({
    document,
    api,
    state,
    appraisal,
    inventoryEditors,
    parseTags,
    parseInventory,
    mergeInventory,
    escapeHtml,
    openModal,
    closeModal,
    refreshSavedRunViews,
    now = Date.now,
  }) {
    if (!document || !api?.runs || !api?.janice || !state || !appraisal || !inventoryEditors) {
      throw new TypeError('Manual encounters require document, APIs, state, and inventory helpers');
    }
    for (const dependency of [
      parseTags, parseInventory, mergeInventory, escapeHtml,
      openModal, closeModal, refreshSavedRunViews, now,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Manual encounter dependencies must be functions');
      }
    }

    document.getElementById('manualEncounterModalMount').innerHTML = markup.modalHtml();
    let nextParticipantIndex = 0;
    let submitting = false;
    let generation = 0;
    let initialEntrySignature = '';

    const byId = id => document.getElementById(id);
    const participantNodes = () => [
      ...document.querySelectorAll('#manualEncounterParticipants [data-manual-participant]'),
    ];

    function entrySignature() {
      return JSON.stringify([...document.querySelectorAll(
        '#manualEncounterModal input, #manualEncounterModal select, '
        + '#manualEncounterModal textarea'
      )].map(control => [control.id, control.value, Boolean(control.checked)]));
    }

    function hasUnsavedInput() {
      return Boolean(initialEntrySignature) && entrySignature() !== initialEntrySignature;
    }

    function characterOptions(preferredId = null) {
      return state.characters.map(character => `<option value="${escapeHtml(character.id)}"${
        Number(character.id) === Number(preferredId) ? ' selected' : ''
      }>${escapeHtml(character.name)}</option>`).join('');
    }

    function participantHtml(index, preferredCharacterId) {
      return `<section class="manual-encounter-participant" data-manual-participant="${index}">
        <div class="manual-encounter-participant-heading">
          <span class="panel-title">Participant ${index + 1}</span>
          <button type="button" class="btn sm ghost" data-action="remove-manual-encounter-participant"
            data-participant-index="${index}">Remove</button>
        </div>
        <div class="manual-encounter-participant-grid">
          <div><label class="field-label" for="manualEncounterCharacter${index}">Character</label>
            <select class="field-select" id="manualEncounterCharacter${index}">${characterOptions(preferredCharacterId)}</select></div>
          <div><label class="field-label" for="manualEncounterHull${index}">Hull Type</label>
            <input class="field-input" id="manualEncounterHull${index}" maxlength="256"
              placeholder="e.g. Hawk"></div>
          <div><label class="field-label" for="manualEncounterOutcome${index}">Outcome</label>
            <select class="field-select" id="manualEncounterOutcome${index}"
              data-change-action="manual-encounter-definition" data-participant-index="${index}">
              <option value="Survived">Survived</option><option value="Died">Died</option>
            </select></div>
          <div><label class="field-label" for="manualEncounterTags${index}">Tags</label>
            <input class="field-input" id="manualEncounterTags${index}" maxlength="512"
              placeholder="Comma-separated tags"></div>
        </div>
        <div><label class="field-label" for="manualEncounterNotes${index}">Notes</label>
          <textarea class="field-textarea" id="manualEncounterNotes${index}" maxlength="16384"
            placeholder="Character-specific notes"></textarea></div>
        <div class="manual-encounter-inventory-grid">
          <div><label class="field-label" for="manualEncounterCargoBefore${index}">Pre-Run Cargo</label>
            <textarea class="field-textarea" id="manualEncounterCargoBefore${index}"
              data-inventory-editor></textarea>
            <label class="field-label" for="manualEncounterDroneBefore${index}">Drone Bay (before)</label>
            <textarea class="field-textarea" id="manualEncounterDroneBefore${index}"
              data-inventory-editor></textarea></div>
          <div data-participant-after="${index}">
            <label class="field-label" for="manualEncounterCargoAfter${index}">Post-Run Cargo</label>
            <textarea class="field-textarea" id="manualEncounterCargoAfter${index}"
              data-inventory-editor data-inventory-compare="manualEncounterCargoBefore${index}"></textarea>
            <label class="field-label" for="manualEncounterDroneAfter${index}">Drone Bay (after)</label>
            <textarea class="field-textarea" id="manualEncounterDroneAfter${index}"
              data-inventory-editor data-inventory-compare="manualEncounterDroneBefore${index}"></textarea></div>
        </div>
      </section>`;
    }

    function updateControls() {
      const nodes = participantNodes();
      const frigates = byId('manualEncounterShipClass').value === 'Frigate';
      byId('addManualEncounterParticipant').hidden = !frigates
        || nodes.length >= 3
        || nodes.length >= state.characters.length;
      for (const node of nodes) {
        node.querySelector('[data-action="remove-manual-encounter-participant"]').hidden =
          nodes.length <= 2;
        const index = node.dataset.manualParticipant;
        node.querySelector(`[data-participant-after="${index}"]`).hidden =
          byId(`manualEncounterOutcome${index}`).value === 'Died';
      }
    }

    function addParticipant(preferredCharacterId = null) {
      const usedCharacterIds = new Set(participantNodes().map(node => Number(
        node.querySelector('select').value
      )));
      preferredCharacterId ||= state.characters.find(character => (
        !usedCharacterIds.has(Number(character.id))
      ))?.id;
      const index = nextParticipantIndex++;
      const container = byId('manualEncounterParticipants');
      container.insertAdjacentHTML('beforeend', participantHtml(index, preferredCharacterId));
      const section = container.querySelector(`[data-manual-participant="${index}"]`);
      inventoryEditors.initialize(section);
      updateControls();
    }

    function removeParticipant(index) {
      if (participantNodes().length <= 2) return;
      document.querySelector(`[data-manual-participant="${index}"]`)?.remove();
      updateControls();
    }

    function handleDefinitionChange(element) {
      if (element.id === 'manualEncounterShipClass'
        && element.value === 'Destroyer'
        && participantNodes().length > 2) {
        participantNodes().slice(2).forEach(node => node.remove());
      }
      updateControls();
    }

    function setSubmitting(value) {
      submitting = value;
      document.querySelectorAll(
        '#manualEncounterModal button, #manualEncounterModal input, '
        + '#manualEncounterModal select, #manualEncounterModal textarea'
      ).forEach(control => { control.disabled = value; });
      byId('manualEncounterSpinner').hidden = !value;
    }

    function open() {
      generation++;
      nextParticipantIndex = 0;
      byId('manualEncounterTier').value = state.settings.default_tier || '';
      byId('manualEncounterWeather').value = state.settings.default_weather || '';
      byId('manualEncounterShipClass').value = 'Frigate';
      byId('manualEncounterDuration').value = '';
      byId('manualEncounterSystem').value = '';
      byId('manualEncounterStatus').innerHTML = '';
      const date = new Date(now());
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      byId('manualEncounterDate').value = date.toISOString().slice(0, 16);
      byId('manualEncounterParticipants').replaceChildren();
      addParticipant(state.activeCharId || state.characters[0]?.id);
      const second = state.characters.find(character => (
        Number(character.id) !== Number(state.activeCharId)
      ));
      addParticipant(second?.id || state.characters[1]?.id);
      if (state.characters.length < 2) {
        byId('manualEncounterStatus').innerHTML =
          '<div class="alert err">Add at least two characters before entering a group encounter.</div>';
      }
      initialEntrySignature = entrySignature();
      openModal('manualEncounterModal');
    }

    function close(force = false) {
      if (submitting && !force) return false;
      generation++;
      initialEntrySignature = '';
      closeModal('manualEncounterModal');
      return true;
    }

    function readParticipant(node, shared) {
      const index = node.dataset.manualParticipant;
      const outcome = byId(`manualEncounterOutcome${index}`).value;
      return {
        characterId: Number(byId(`manualEncounterCharacter${index}`).value),
        outcome,
        hullName: byId(`manualEncounterHull${index}`).value.trim(),
        tags: parseTags(byId(`manualEncounterTags${index}`).value),
        notes: byId(`manualEncounterNotes${index}`).value,
        cargoBefore: byId(`manualEncounterCargoBefore${index}`).value,
        cargoAfter: outcome === 'Survived' ? byId(`manualEncounterCargoAfter${index}`).value : '',
        droneBefore: byId(`manualEncounterDroneBefore${index}`).value,
        droneAfter: outcome === 'Survived' ? byId(`manualEncounterDroneAfter${index}`).value : '',
        ...shared,
      };
    }

    async function appraiseParticipant(participant, submissionGeneration) {
      let result;
      if (participant.outcome === 'Survived') {
        result = await appraisal.appraiseSurvivedInventory({
          cargoBefore: participant.cargoBefore,
          cargoAfter: participant.cargoAfter,
          droneBefore: participant.droneBefore,
          droneAfter: participant.droneAfter,
          appraise: (items, pricing) => api.janice.appraise(items, pricing),
        });
      } else {
        const lost = mergeInventory(
          parseInventory(participant.cargoBefore),
          parseInventory(participant.droneBefore)
        );
        result = await appraisal.appraiseLostInventory(
          lost,
          (items, pricing) => api.janice.appraise(items, pricing)
        );
      }
      if (submissionGeneration !== generation) {
        throw new Error('The manual encounter was closed before appraisal completed');
      }
      return {
        character_id: participant.characterId,
        started_at: participant.startedAt,
        duration: participant.duration,
        tier: participant.tier,
        weather: participant.weather,
        outcome: participant.outcome,
        loot_value: result.loot_value || 0,
        consumed_cost: result.consumed_cost || 0,
        net_isk: result.net_isk || 0,
        total_loss: result.total_loss || 0,
        cargo_before: participant.cargoBefore,
        cargo_after: participant.cargoAfter,
        drone_before: participant.droneBefore,
        drone_after: participant.droneAfter,
        system_name: participant.systemName || null,
        hull_name: participant.hullName,
        ship_class: participant.shipClass,
        notes: participant.notes,
        tags: participant.tags,
        appraised_at: Math.floor(now() / 1000),
        items: result.items || [],
        fitting: [],
        implants: [],
      };
    }

    async function submit() {
      if (submitting) return;
      const status = byId('manualEncounterStatus');
      const tier = byId('manualEncounterTier').value;
      const weather = byId('manualEncounterWeather').value;
      const dateValue = byId('manualEncounterDate').value;
      const duration = parseDuration(byId('manualEncounterDuration').value);
      if (!tier || !weather || !dateValue) {
        status.innerHTML = '<div class="alert err">Select tier, weather, and date.</div>';
        return;
      }
      if (!state.hasJaniceKey) {
        status.innerHTML = '<div class="alert err">Janice API key not set. Go to Settings.</div>';
        return;
      }
      const shared = {
        tier,
        weather,
        duration,
        startedAt: Math.floor(new Date(dateValue).getTime() / 1000),
        systemName: byId('manualEncounterSystem').value.trim(),
        shipClass: byId('manualEncounterShipClass').value,
      };
      const participants = participantNodes().map(node => readParticipant(node, shared));
      if (new Set(participants.map(participant => participant.characterId)).size !== participants.length) {
        status.innerHTML = '<div class="alert err">Select a different character for each participant.</div>';
        return;
      }
      if (participants.some(participant => !participant.characterId || !participant.hullName)) {
        status.innerHTML = '<div class="alert err">Select every character and enter every hull type.</div>';
        return;
      }

      const submissionGeneration = generation;
      setSubmitting(true);
      status.innerHTML = '';
      try {
        const runData = [];
        for (const participant of participants) {
          runData.push(await appraiseParticipant(participant, submissionGeneration));
        }
        await api.runs.saveEncounter({ participants: runData });
        if (submissionGeneration !== generation) return;
        close(true);
        await refreshSavedRunViews();
      } catch (error) {
        status.innerHTML = `<div class="alert err">Failed: ${escapeHtml(error.message)}</div>`;
      } finally {
        setSubmitting(false);
      }
    }

    return Object.freeze({
      addParticipant,
      close,
      handleDefinitionChange,
      hasUnsavedInput,
      open,
      removeParticipant,
      submit,
    });
  }

  return Object.freeze({ createManualEncounterController, parseDuration });
});
