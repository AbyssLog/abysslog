(function initManualRunController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssManualRuns = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  const PREVIEW_FIELDS = new Set([
    'manualTier',
    'manualWeather',
    'manualOutcome',
    'manualDuration',
    'manualDate',
    'manualShipClass',
    'manualCargoBefore',
    'manualCargoAfter',
    'manualDroneBefore',
    'manualDroneAfter',
  ]);

  function parseDuration(value) {
    if (!value || !value.trim()) return 0;
    const parts = value.trim().split(':');
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return parseInt(value) || 0;
  }

  function createManualRunController({
    document,
    api,
    state,
    appraisal,
    parseTags,
    parseInventory,
    mergeInventory,
    setInventoryText,
    formatIsk,
    escapeHtml,
    openModal,
    closeModal,
    refreshSavedRunViews,
    now = Date.now,
  }) {
    if (!document || !api?.runs || !api?.janice || !state || !appraisal) {
      throw new Error('Manual run controller requires document, APIs, state, and appraisal');
    }
    for (const dependency of [
      parseTags,
      parseInventory,
      mergeInventory,
      setInventoryText,
      formatIsk,
      escapeHtml,
      openModal,
      closeModal,
      refreshSavedRunViews,
      now,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Manual run controller dependencies must be functions');
      }
    }

    let editRunId = null;
    let editOriginal = null;
    let pendingAppraisal = null;
    let submitting = false;
    let generation = 0;
    let initialEntrySignature = '';

    function entrySignature() {
      return JSON.stringify([...document.querySelectorAll(
        '#manualEntryModal input, #manualEntryModal select, #manualEntryModal textarea'
      )].map(control => [control.id, control.value, Boolean(control.checked)]));
    }

    function hasUnsavedInput() {
      return !editRunId && Boolean(initialEntrySignature)
        && entrySignature() !== initialEntrySignature;
    }

    function setSubmitting(value) {
      submitting = value;
      document.querySelectorAll(
        '#manualEntryModal button, #manualEntryModal input, '
        + '#manualEntryModal select, #manualEntryModal textarea'
      ).forEach(control => { control.disabled = value; });
      document.getElementById('manualSpinner').style.display = value ? 'inline-block' : 'none';
    }

    function updateOutcome() {
      document.getElementById('manualCargoAfterCol').style.display =
        document.getElementById('manualOutcome').value === 'Died' ? 'none' : 'block';
    }

    function close(force = false) {
      if (submitting && !force) return false;
      generation++;
      closeModal('manualEntryModal');
      editRunId = null;
      editOriginal = null;
      pendingAppraisal = null;
      initialEntrySignature = '';
      return true;
    }

    function openNew() {
      generation++;
      editRunId = null;
      editOriginal = null;
      pendingAppraisal = null;
      document.getElementById('manualEntryTitle').textContent = 'Enter Run Manually';
      const modeSwitch = document.getElementById('manualEntryModeSwitch');
      if (modeSwitch) modeSwitch.hidden = false;
      document.getElementById('manualSubmitLabel').textContent = 'Appraise & Save';
      document.getElementById('manualSaveBtn').style.display = 'none';
      document.getElementById('manualTier').value = state.settings.default_tier || '';
      document.getElementById('manualWeather').value = state.settings.default_weather || '';
      document.getElementById('manualOutcome').value = 'Survived';
      document.getElementById('manualDuration').value = '';
      document.getElementById('manualShipClass').value = 'Unknown';
      document.getElementById('manualHullName').value = '';
      document.getElementById('manualSystemName').value = '';
      document.getElementById('manualTags').value = '';
      document.getElementById('manualNotes').value = '';
      setInventoryText('manualCargoBefore', '');
      setInventoryText('manualDroneBefore', '');
      setInventoryText('manualCargoAfter', '');
      setInventoryText('manualDroneAfter', '');
      document.getElementById('manualEntryStatus').innerHTML = '';
      const date = new Date(now());
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      document.getElementById('manualDate').value = date.toISOString().slice(0, 16);
      updateOutcome();
      initialEntrySignature = entrySignature();
      openModal('manualEntryModal');
    }

    async function openEdit(runId) {
      const requestGeneration = ++generation;
      const characterId = state.activeCharId;
      const run = await api.runs.getById(runId);
      if (requestGeneration !== generation || characterId !== state.activeCharId || !run) return;
      editRunId = runId;
      pendingAppraisal = null;
      editOriginal = { outcome: run.outcome, total_loss: run.total_loss || 0 };
      document.getElementById('manualEntryTitle').textContent = 'Edit Run';
      const modeSwitch = document.getElementById('manualEntryModeSwitch');
      if (modeSwitch) modeSwitch.hidden = true;
      document.getElementById('manualSubmitLabel').textContent = 'Re-Appraise';
      document.getElementById('manualSaveBtn').style.display = 'inline-flex';
      document.getElementById('manualTier').value = run.tier || '';
      document.getElementById('manualWeather').value = run.weather || '';
      document.getElementById('manualOutcome').value = run.outcome || 'Survived';
      const duration = run.duration || 0;
      const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
      const seconds = (duration % 60).toString().padStart(2, '0');
      document.getElementById('manualDuration').value = `${minutes}:${seconds}`;
      const date = new Date(run.started_at * 1000);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      document.getElementById('manualDate').value = date.toISOString().slice(0, 16);
      document.getElementById('manualShipClass').value = run.ship_class || 'Unknown';
      document.getElementById('manualHullName').value = run.hull_name || '';
      document.getElementById('manualSystemName').value = run.system_name || '';
      document.getElementById('manualTags').value = (run.tags || []).join(', ');
      document.getElementById('manualNotes').value = run.notes || '';
      setInventoryText('manualCargoBefore', run.cargo_before || '');
      setInventoryText('manualDroneBefore', run.drone_before || '');
      setInventoryText('manualDroneAfter', run.drone_after || '');
      setInventoryText('manualCargoAfter', run.cargo_after || '');
      document.getElementById('manualEntryStatus').innerHTML = '';
      updateOutcome();
      closeModal('runDetailModal');
      openModal('manualEntryModal');
    }

    function invalidatePreview(element) {
      if (!editRunId || !pendingAppraisal || !PREVIEW_FIELDS.has(element.id)) return;
      pendingAppraisal = null;
      const status = document.getElementById('manualEntryStatus');
      if (!status) return;
      const alert = document.createElement('div');
      alert.className = 'alert warn';
      alert.textContent = 'The form changed after re-appraisal. Re-Appraise again to update '
        + 'the totals, or Save to retain the stored appraisal where compatible.';
      status.replaceChildren(alert);
    }

    function assertCurrentSubmission(submissionGeneration, characterId) {
      if (submissionGeneration !== generation || characterId !== state.activeCharId) {
        throw new Error('The active character changed before the manual run could be saved');
      }
    }

    async function submit(doAppraise = true) {
      if (submitting) return;
      const submissionGeneration = generation;
      const currentEditRunId = editRunId;
      const currentEditOriginal = editOriginal;
      const characterId = state.activeCharId;
      const tier = document.getElementById('manualTier').value;
      const weather = document.getElementById('manualWeather').value;
      const outcome = document.getElementById('manualOutcome').value;
      const duration = parseDuration(document.getElementById('manualDuration').value);
      const shipClass = document.getElementById('manualShipClass').value;
      const hullName = document.getElementById('manualHullName').value.trim();
      const systemName = document.getElementById('manualSystemName').value.trim();
      const tags = parseTags(document.getElementById('manualTags').value);
      const notes = document.getElementById('manualNotes').value;
      const dateValue = document.getElementById('manualDate').value;
      const cargoBefore = document.getElementById('manualCargoBefore').value;
      const cargoAfter = document.getElementById('manualCargoAfter').value;
      const droneBefore = document.getElementById('manualDroneBefore')?.value || '';
      const droneAfter = document.getElementById('manualDroneAfter')?.value || '';
      const status = document.getElementById('manualEntryStatus');
      const formSignature = JSON.stringify({
        tier,
        weather,
        outcome,
        duration,
        shipClass,
        dateValue,
        cargoBefore,
        cargoAfter,
        droneBefore,
        droneAfter,
      });
      const currentPendingAppraisal = pendingAppraisal?.signature === formSignature
        ? pendingAppraisal
        : null;
      if (doAppraise && currentEditRunId) pendingAppraisal = null;

      if (!tier || !weather) {
        status.innerHTML = '<div class="alert err">Please select a tier and weather type.</div>';
        return;
      }
      if (doAppraise && !state.hasJaniceKey) {
        status.innerHTML = '<div class="alert err">Janice API key not set — go to Settings.</div>';
        return;
      }
      if (
        !doAppraise
        && currentEditRunId
        && outcome !== currentEditOriginal?.outcome
        && !currentPendingAppraisal
      ) {
        status.innerHTML = '<div class="alert warn">Changing the outcome requires re-appraisal '
          + 'so the saved totals and item records remain consistent.</div>';
        return;
      }

      const startedAt = dateValue
        ? Math.floor(new Date(dateValue).getTime() / 1000)
        : Math.floor(now() / 1000);
      const savedCargoAfter = outcome === 'Survived' ? cargoAfter : '';
      const savedDroneAfter = outcome === 'Survived' ? droneAfter : '';
      setSubmitting(true);
      status.innerHTML = '';

      try {
        let lootValue = 0;
        let consumedCost = 0;
        let netIsk = 0;
        let totalLoss = 0;
        let items = [];

        if (!doAppraise && currentEditRunId) {
          assertCurrentSubmission(submissionGeneration, characterId);
          const meta = {
            tier,
            weather,
            outcome,
            duration,
            started_at: startedAt,
            total_loss: currentPendingAppraisal
              ? currentPendingAppraisal.total_loss
              : (currentEditOriginal?.total_loss || 0),
            hull_name: hullName,
            ship_class: shipClass,
            system_name: systemName,
            notes,
            tags,
          };
          const update = currentPendingAppraisal
            ? { meta, appraisal: currentPendingAppraisal.appraisal }
            : {
                meta,
                cargo: {
                  cargo_before: cargoBefore,
                  cargo_after: savedCargoAfter,
                  drone_before: droneBefore,
                  drone_after: savedDroneAfter,
                },
              };
          await api.runs.update(currentEditRunId, update);
          close(true);
          await refreshSavedRunViews();
          return;
        }

        if (outcome === 'Survived') {
          const result = await appraisal.appraiseSurvivedInventory({
            cargoBefore,
            cargoAfter: savedCargoAfter,
            droneBefore,
            droneAfter: savedDroneAfter,
            appraise: (appraisalItems, pricing) => api.janice.appraise(appraisalItems, pricing),
          });
          assertCurrentSubmission(submissionGeneration, characterId);
          lootValue = result.loot_value;
          consumedCost = result.consumed_cost;
          netIsk = result.net_isk;
          items = result.items;
        } else {
          const lossItems = mergeInventory(
            parseInventory(cargoBefore),
            parseInventory(droneBefore)
          );
          const result = await appraisal.appraiseLostInventory(
            lossItems,
            (appraisalItems, pricing) => api.janice.appraise(appraisalItems, pricing)
          );
          assertCurrentSubmission(submissionGeneration, characterId);
          totalLoss = result.total_loss;
          items = result.items;
        }

        const appraisedAt = Math.floor(now() / 1000);
        const runData = {
          character_id: characterId,
          started_at: startedAt,
          duration,
          tier,
          weather,
          outcome,
          loot_value: lootValue,
          consumed_cost: consumedCost,
          net_isk: netIsk,
          total_loss: totalLoss,
          cargo_before: cargoBefore,
          cargo_after: savedCargoAfter,
          drone_before: droneBefore,
          drone_after: savedDroneAfter,
          system_name: systemName,
          hull_name: hullName,
          ship_class: shipClass,
          notes,
          tags,
          appraised_at: appraisedAt,
          items,
          fitting: [],
          implants: [],
        };
        const appraisalUpdate = {
          loot_value: lootValue,
          consumed_cost: consumedCost,
          net_isk: netIsk,
          cargo_before: cargoBefore,
          cargo_after: savedCargoAfter,
          drone_before: droneBefore,
          drone_after: savedDroneAfter,
          items,
          appraised_at: appraisedAt,
        };

        if (currentEditRunId) {
          pendingAppraisal = {
            signature: formSignature,
            total_loss: totalLoss,
            appraisal: appraisalUpdate,
          };
          const previewMessage = outcome === 'Survived'
            ? `Re-appraisal preview: ${formatIsk(lootValue)} loot, `
              + `${formatIsk(consumedCost)} consumed, ${formatIsk(netIsk)} net. `
              + 'Click Save to commit it.'
            : `Re-appraisal preview: ${formatIsk(totalLoss)} total loss. `
              + 'Click Save to commit it.';
          status.innerHTML = `<div class="alert success">${escapeHtml(previewMessage)}</div>`;
        } else {
          await api.runs.save(runData);
          close(true);
          await refreshSavedRunViews();
          status.innerHTML = '';
        }
      } catch (error) {
        status.innerHTML = `<div class="alert err">Failed: ${escapeHtml(error.message)}</div>`;
      } finally {
        setSubmitting(false);
      }
    }

    return Object.freeze({
      close,
      hasUnsavedInput,
      invalidatePreview,
      openEdit,
      openNew,
      submit,
      updateOutcome,
    });
  }

  return Object.freeze({ createManualRunController, parseDuration });
});
