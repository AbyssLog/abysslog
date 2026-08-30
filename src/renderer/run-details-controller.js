(function initRunDetailsController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./appraisal-history-view'),
      require('./encounter-detail-view')
    );
  } else {
    root.AbyssRunDetails = factory(root.AbyssAppraisalHistory, root.AbyssEncounterDetail);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule(
  appraisalHistoryView,
  encounterDetailView
) {
  function createRunDetailsController({
    document,
    api,
    state,
    fitting,
    appraisalHelpers,
    inventoryEditors,
    fmtIsk,
    fmtDuration,
    esc,
    openModal,
    closeModal,
    refreshSavedRunViews,
    confirmAction = message => globalThis.confirm(message),
  }) {
    if (!document || !api?.runs || !state || !fitting || !appraisalHelpers || !inventoryEditors) {
      throw new Error('Run details controller requires document, APIs, state, and domain helpers');
    }
    for (const dependency of [
      fmtIsk, fmtDuration, esc, openModal, closeModal,
      refreshSavedRunViews, confirmAction,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Run details controller dependencies must be functions');
      }
    }

    let pendingHistoricalReappraisal = null;

    async function showRunDetail(runId) {
      pendingHistoricalReappraisal = null;
      const [run, appraisalHistory] = await Promise.all([
        api.runs.getById(runId),
        typeof api.runs.getAppraisalHistory === 'function'
          ? api.runs.getAppraisalHistory(runId)
          : Promise.resolve([]),
      ]);
      if (!run) return;

      const d = new Date(run.started_at * 1000);
      document.getElementById('runDetailTitle').textContent = `${run.tier} ${run.weather} — ${d.toLocaleDateString()}`;

      const gained = run.items.filter(i => i.type === 'gained');
      const consumed = run.items.filter(i => i.type === 'consumed');
      const lost = run.items.filter(i => i.type === 'lost');
      const droneAfterSnapshot = inventoryEditors.resolveDroneAfterSnapshot(
        run.drone_before, run.drone_after, run.outcome
      );
      const displayUnchangedDroneBay = droneAfterSnapshot.usesFallback;
      const displayedDroneAfter = droneAfterSnapshot.text;
      const unchangedDroneAttribute = displayUnchangedDroneBay
        ? ' data-inventory-fallback="unchanged"'
        : '';
      const unchangedDroneBadge = displayUnchangedDroneBay
        ? '<span class="inventory-unchanged-badge">Unchanged</span>'
        : '';

      let html = `<div class="run-detail-summary">
        <div><div class="field-label">Date</div><div class="mono" style="font-size:12px">${d.toLocaleString()}</div></div>
        <div><div class="field-label">Duration</div><div class="mono" style="font-size:12px">${fmtDuration(run.duration)}</div></div>
        <div><div class="field-label">Outcome</div><div><span class="badge ${run.outcome === 'Survived' ? 'survived' : 'died'}">${esc(run.outcome)}</span></div></div>
        <div><div class="field-label">Hull Class</div><div>${run.ship_class ? '<span class="badge tier">' + esc(run.ship_class) + '</span>' : '<span style="color:var(--muted)">—</span>'}</div></div>
        <div><div class="field-label">${run.outcome === 'Survived' ? 'Net ISK' : 'Total Loss'}</div>
        <div class="mono" style="font-size:14px;color:${run.outcome === 'Survived' ? (run.net_isk >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--red)'}">
          ${run.outcome === 'Survived' ? (run.net_isk >= 0 ? '+' : '') + fmtIsk(run.net_isk) : '−' + fmtIsk(run.total_loss)}
        </div></div>
      </div>`;

      html += encounterDetailView.render(run, { fmtIsk, esc });

      const metadataRows = [];
      if (run.fit_display_name) metadataRows.push(['Fit name', run.fit_display_name]);
      if (run.hull_name) metadataRows.push(['Hull', run.hull_name]);
      if (run.system_name || run.system_id) {
        metadataRows.push(['System', run.system_name || String(run.system_id)]);
      }
      if (run.appraised_at) {
        metadataRows.push(['Appraised', new Date(run.appraised_at * 1000).toLocaleString()]);
      }
      if (run.killmail_ids?.length) {
        metadataRows.push(['Killmail IDs', run.killmail_ids.join(', ')]);
      }
      if (metadataRows.length || run.tags?.length || run.notes) {
        html += '<section class="run-detail-metadata"><div class="run-detail-metadata-grid">';
        for (const [label, value] of metadataRows) {
          html += '<div><div class="field-label">' + esc(label)
            + '</div><div>' + esc(value) + '</div></div>';
        }
        html += '</div>';
        if (run.tags?.length) {
          html += '<div class="run-detail-tags">'
            + run.tags.map(tag => '<span class="history-tag">' + esc(tag) + '</span>').join(' ')
            + '</div>';
        }
        if (run.notes) {
          html += '<div class="run-detail-notes"><div class="field-label">Notes</div>'
            + '<div>' + esc(run.notes) + '</div></div>';
        }
        html += '</section>';
      }
      if (run.fitting.length || run.implants.length) {
        const summary = fitting.summarizeSnapshot(run.fitting, run.implants);
        const counts = [];
        if (summary.fittedItemCount > 0) {
          counts.push(`${summary.fittedItemCount} fitted item${summary.fittedItemCount === 1 ? '' : 's'}`);
        }
        if (summary.droneCount > 0) {
          counts.push(`${summary.droneCount} drone${summary.droneCount === 1 ? '' : 's'}`);
        }
        if (summary.implantCount > 0) {
          counts.push(`${summary.implantCount} implant${summary.implantCount === 1 ? '' : 's'}`);
        }
        const fitNameButton = run.fit_identity_id
          ? `<button type="button" class="btn sm ghost" data-action="edit-fit-name" `
            + `data-fit-identity-id="${esc(run.fit_identity_id)}" `
            + `data-fit-display-name="${esc(run.fit_display_name || '')}" `
            + `data-fit-hull-name="${esc(run.hull_name || 'this hull')}" `
            + `data-fit-return-run-id="${esc(run.id)}">`
            + (run.fit_display_name ? 'Rename fit' : 'Name fit')
            + '</button>'
          : '';
        html += `<div class="fit-summary-card">
          <div>
            <div class="fit-summary-title">Ship setup captured at run start</div>
            <div class="fit-summary-counts">${esc(counts.join(' · ') || 'Ship hull captured')}</div>
          </div>
          <div class="fit-summary-actions">
            ${fitNameButton}
            <button class="btn sm ghost" data-action="show-ship-setup" data-run-id="${esc(run.id)}">View fit &amp; implants</button>
          </div>
        </div>`;
      }

      html += '<div class="run-detail-appraisals">';
      if (gained.length) {
        html += itemTableHtml('Loot Gained', gained, 'gained', 'unit_price_buy');
      }
      if (consumed.length) {
        html += itemTableHtml('Items Consumed', consumed, 'consumed', 'unit_price_sell');
      }
      if (lost.length) {
        html += itemTableHtml('Items Lost', lost, 'consumed', 'unit_price_sell');
      }
      html += '</div>';

      html += appraisalHistoryView.render(appraisalHistory, { fmtIsk, esc });

      // Cargo paste section — always shown, editable for re-appraisal
      html += `<div class="section-title run-detail-inventory-title">Inventory Snapshots</div>`;

      if (run.outcome === 'Survived') {
        html += `<div class="run-detail-inventory-grid">
          <div class="run-detail-inventory-card">
            <label class="field-label" for="detailCargoBefore">Pre-Run Cargo</label>
            <textarea class="field-textarea" id="detailCargoBefore" style="min-height:80px;font-size:11px" data-inventory-editor>${esc(run.cargo_before || '')}</textarea>
          </div>
          <div class="run-detail-inventory-card">
            <label class="field-label" for="detailCargoAfter">Post-Run Cargo</label>
            <textarea class="field-textarea" id="detailCargoAfter" style="min-height:80px;font-size:11px" data-inventory-editor data-inventory-compare="detailCargoBefore">${esc(run.cargo_after || '')}</textarea>
          </div>
          <div class="run-detail-inventory-card">
            <label class="field-label" for="detailDroneBefore">Pre-Run Drone Bay</label>
            <textarea class="field-textarea" id="detailDroneBefore" style="min-height:60px;font-size:11px" data-inventory-editor>${esc(run.drone_before || '')}</textarea>
          </div>
          <div class="run-detail-inventory-card">
            <label class="field-label" for="detailDroneAfter">Post-Run Drone Bay ${unchangedDroneBadge}</label>
            <textarea class="field-textarea" id="detailDroneAfter" style="min-height:60px;font-size:11px" data-inventory-editor data-inventory-compare="detailDroneBefore"${unchangedDroneAttribute}>${esc(displayedDroneAfter)}</textarea>
          </div>
        </div>
        <div class="run-detail-reappraisal-status" id="reappraise-status-${run.id}" role="status" aria-live="polite"></div>
        <div class="run-detail-actions">
          <button class="btn gold sm" data-action="reappraise-run" data-run-id="${esc(run.id)}"><span id="reappraise-spinner-${esc(run.id)}" style="display:none" class="spinner"></span> Re-Appraise Loot</button>
          <button class="btn green sm" id="reappraise-save-${esc(run.id)}" data-action="save-reappraisal" data-run-id="${esc(run.id)}" hidden>Save Changes</button>
          <button class="btn sm ghost" id="reappraise-discard-${esc(run.id)}" data-action="discard-reappraisal" data-run-id="${esc(run.id)}" hidden>Discard</button>
          <button class="btn sm ghost" data-action="edit-run" data-run-id="${esc(run.id)}">✎ Edit Run</button>
          <button class="btn sm red" data-action="delete-run" data-run-id="${esc(run.id)}">Delete Run</button>
        </div>`;
      } else {
        // Died — only pre-run cargo, no post-run
        html += `<div class="run-detail-inventory-grid">
          <div class="run-detail-inventory-card">
            <label class="field-label" for="detailCargoBefore">Pre-Run Cargo (at time of death)</label>
            <textarea class="field-textarea" id="detailCargoBefore" style="min-height:90px;font-size:11px" readonly data-inventory-editor>${esc(run.cargo_before || '')}</textarea>
          </div>
          <div class="run-detail-inventory-card">
            <label class="field-label" for="detailDroneBefore">Pre-Run Drone Bay (at time of death)</label>
            <textarea class="field-textarea" id="detailDroneBefore" style="min-height:90px;font-size:11px" readonly data-inventory-editor>${esc(run.drone_before || '')}</textarea>
          </div>
        </div>
        <div class="run-detail-actions">
          <button class="btn sm ghost" data-action="edit-run" data-run-id="${esc(run.id)}">✎ Edit Run</button>
          <button class="btn sm red" data-action="delete-run" data-run-id="${esc(run.id)}">Delete Run</button>
        </div>`;
      }

      document.getElementById('runDetailContent').innerHTML = html;
      inventoryEditors.initialize(document.getElementById('runDetailContent'));
      openModal('runDetailModal');
    }

    function setReappraisalStatus(runId, message = '', type = '') {
      const status = document.getElementById(`reappraise-status-${runId}`);
      if (!status) return null;
      status.replaceChildren();
      if (message) {
        const alert = document.createElement('div');
        alert.className = `alert ${type}`;
        alert.textContent = message;
        status.append(alert);
      }
      return status;
    }

    function setReappraisalActionsVisible(runId, visible) {
      const saveButton = document.getElementById(`reappraise-save-${runId}`);
      const discardButton = document.getElementById(`reappraise-discard-${runId}`);
      if (saveButton) saveButton.hidden = !visible;
      if (discardButton) discardButton.hidden = !visible;
    }

    const HISTORICAL_REAPPRAISAL_FIELDS = new Set([
      'detailCargoBefore',
      'detailCargoAfter',
      'detailDroneBefore',
      'detailDroneAfter',
    ]);

    function invalidateHistoricalReappraisalPreview(element) {
      const pending = pendingHistoricalReappraisal;
      if (!pending || !HISTORICAL_REAPPRAISAL_FIELDS.has(element.id)) return;
      pendingHistoricalReappraisal = null;
      setReappraisalActionsVisible(pending.runId, false);
      setReappraisalStatus(
        pending.runId,
        'Inventory changed after the preview. Re-appraise again before saving.',
        'warn'
      );
    }

    async function reappraiseRun(runId) {
      const statusId = `reappraise-status-${runId}`;
      const spinnerId = `reappraise-spinner-${runId}`;
      const statusEl = document.getElementById(statusId);
      const spinner = document.getElementById(spinnerId);
      const actionButton = spinner?.closest('button');
      const cargoBeforeEl = document.getElementById('detailCargoBefore');
      const cargoAfterEl = document.getElementById('detailCargoAfter');
      if (!statusEl || !spinner || !cargoBeforeEl || !cargoAfterEl) return;

      if (!state.hasJaniceKey) {
        setReappraisalStatus(runId, 'Janice API key not set. Go to Settings.', 'err');
        return;
      }

      const cargoBefore = cargoBeforeEl.value;
      const cargoAfter = cargoAfterEl.value;
      const droneBefore = document.getElementById('detailDroneBefore')?.value || '';
      const droneAfterEl = document.getElementById('detailDroneAfter');
      const droneAfter = droneAfterEl?.dataset.inventoryFallback === 'unchanged'
        ? ''
        : droneAfterEl?.value || '';

      if (!cargoAfter.trim()) {
        setReappraisalStatus(runId, 'Post-run cargo is empty - paste it first.', 'warn');
        return;
      }

      pendingHistoricalReappraisal = null;
      setReappraisalActionsVisible(runId, false);
      spinner.style.display = 'inline-block';
      if (actionButton) actionButton.disabled = true;
      statusEl.replaceChildren();

      try {
        const preview = await appraisalHelpers.appraiseSurvivedInventory({
          cargoBefore,
          cargoAfter,
          droneBefore,
          droneAfter,
          appraise: (appraisalItems, pricing) =>
            api.janice.appraise(appraisalItems, pricing),
        });
        const appraisal = {
          loot_value: preview.loot_value,
          consumed_cost: preview.consumed_cost,
          net_isk: preview.net_isk,
          cargo_before: cargoBefore,
          cargo_after: cargoAfter,
          drone_before: droneBefore,
          drone_after: droneAfter,
          items: preview.items,
          appraised_at: Math.floor(Date.now() / 1000),
        };
        pendingHistoricalReappraisal = { runId, appraisal };
        setReappraisalActionsVisible(runId, true);
        setReappraisalStatus(
          runId,
          `Preview: ${fmtIsk(preview.loot_value)} loot, ${fmtIsk(preview.consumed_cost)} consumed, ${fmtIsk(preview.net_isk)} net. Save or discard these changes.`,
          'success'
        );
      } catch (error) {
        setReappraisalStatus(
          runId,
          `Re-appraisal failed: ${error?.message || 'Unknown error'}`,
          'err'
        );
      } finally {
        const currentSpinner = document.getElementById(spinnerId);
        if (currentSpinner) currentSpinner.style.display = 'none';
        const currentButton = currentSpinner?.closest('button');
        if (currentButton) currentButton.disabled = false;
      }
    }


    async function saveHistoricalReappraisal(runId) {
      const pending = pendingHistoricalReappraisal;
      if (!pending || pending.runId !== runId) {
        setReappraisalStatus(runId, 'Re-appraise the run before saving changes.', 'warn');
        return;
      }

      const saveButton = document.getElementById(`reappraise-save-${runId}`);
      const discardButton = document.getElementById(`reappraise-discard-${runId}`);
      if (saveButton) saveButton.disabled = true;
      if (discardButton) discardButton.disabled = true;
      setReappraisalStatus(runId, 'Saving re-appraisal changes...', '');

      try {
        await api.runs.updateAppraisal(runId, pending.appraisal);
        pendingHistoricalReappraisal = null;
        await refreshSavedRunViews();

        const detailIsOpen = document.getElementById('runDetailModal')?.classList.contains('open')
          && document.getElementById(`reappraise-status-${runId}`);
        if (detailIsOpen) {
          await showRunDetail(runId);
          setReappraisalStatus(
            runId,
            `Re-appraisal saved - Net ISK updated to ${fmtIsk(pending.appraisal.net_isk)}`,
            'success'
          );
        }
      } catch (error) {
        setReappraisalStatus(
          runId,
          `Could not save re-appraisal: ${error?.message || 'Unknown error'}`,
          'err'
        );
      } finally {
        const currentSaveButton = document.getElementById(`reappraise-save-${runId}`);
        const currentDiscardButton = document.getElementById(`reappraise-discard-${runId}`);
        if (currentSaveButton) currentSaveButton.disabled = false;
        if (currentDiscardButton) currentDiscardButton.disabled = false;
      }
    }

    async function discardHistoricalReappraisal(runId) {
      if (!pendingHistoricalReappraisal || pendingHistoricalReappraisal.runId !== runId) {
        setReappraisalStatus(runId, 'There are no re-appraisal changes to discard.', 'warn');
        return;
      }

      pendingHistoricalReappraisal = null;
      const detailIsOpen = document.getElementById('runDetailModal')?.classList.contains('open')
        && document.getElementById(`reappraise-status-${runId}`);
      if (detailIsOpen) {
        await showRunDetail(runId);
        setReappraisalStatus(runId, 'Re-appraisal changes discarded.', 'success');
      }
    }

    function itemTableHtml(title, items, priceClass, priceField) {
      let html = `<div class="appraisal-section"><div class="appraisal-header">${title}</div>
        <table class="item-table"><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>`;
      for (const item of items) {
        const unit = item[priceField] || 0;
        const total = unit * item.qty;
        html += `<tr>
          <td class="name">${esc(item.item_name)}</td>
          <td class="qty">${item.qty.toLocaleString()}</td>
          <td class="price ${unit === 0 ? 'zero' : priceClass}">${unit === 0 ? 'no orders' : fmtIsk(unit)}</td>
          <td class="price ${total === 0 ? 'zero' : priceClass}">${total === 0 ? '—' : fmtIsk(total)}</td>
        </tr>`;
      }
      html += `</tbody></table></div>`;
      return html;
    }

    function shipSetupSectionHtml(title, items) {
      if (!items.length) return '';
      let html = `<div class="ship-setup-section">
        <div class="ship-setup-section-title">${esc(title)}</div>`;
      for (const item of items) {
        html += `<div class="ship-setup-row">
          <span class="ship-setup-item">${esc(item.name)}</span>
          <span class="ship-setup-qty">×${item.qty.toLocaleString()}</span>
        </div>`;
      }
      return `${html}</div>`;
    }

    async function showShipSetup(runId, returnModal = 'runDetailModal') {
      const run = await api.runs.getById(runId);
      if (!run) return;

      const setupModal = document.getElementById('shipSetupModal');
      setupModal.dataset.returnModal = returnModal;
      const closeButton = setupModal.querySelector('[data-action="close-ship-setup"]');
      closeButton.setAttribute('aria-label', returnModal ? 'Back to run details' : 'Back to statistics');
      const grouped = fitting.groupSnapshot(run.fitting, run.implants);
      const summary = fitting.summarizeSnapshot(run.fitting, run.implants);
      const hullName = grouped.hull?.name || run.hull_name || 'Unknown ship';
      const startedAt = new Date(run.started_at * 1000);
      const runContext = [run.tier, run.weather]
        .filter(value => value && value !== 'Unknown')
        .join(' ');

      document.getElementById('shipSetupTitle').textContent = 'Fit & Implants';
      let html = `<div class="ship-setup-meta">
        <div class="ship-setup-hull">${esc(hullName)}</div>
        <div class="ship-setup-context">${esc(
          ['Captured at run start', runContext, startedAt.toLocaleString()]
            .filter(Boolean)
            .join(' · ')
        )}</div>
      </div>`;

      for (const section of fitting.DISPLAY_SECTIONS) {
        html += shipSetupSectionHtml(section.label, grouped.sections[section.id]);
      }
      html += shipSetupSectionHtml('Implants', grouped.implants);

      if (summary.unclassifiedCount > 0) {
        html += `<div class="alert warn">${summary.unclassifiedCount} unclassified fitted item${summary.unclassifiedCount === 1 ? '' : 's'} will not be included in the EVE clipboard export.</div>`;
      }
      html += `<div class="field-note">
        Implants are included as cargo in the copied fitting. Loaded charges and other cargo may not be included.
      </div>
      <div id="copyFittingStatus" role="status" aria-live="polite" style="margin-top:10px"></div>
      <div class="ship-setup-actions">
        <button class="btn gold" data-action="copy-run-fitting" data-run-id="${esc(run.id)}">Copy to Clipboard</button>
        <button class="btn sm ghost" data-action="close-ship-setup">${returnModal ? 'Back to run details' : 'Back to statistics'}</button>
      </div>`;

      document.getElementById('shipSetupContent').innerHTML = html;
      closeModal('runDetailModal');
      openModal('shipSetupModal');
    }

    function closeShipSetupModal() {
      const returnModal = document.getElementById('shipSetupModal').dataset.returnModal;
      closeModal('shipSetupModal');
      if (returnModal) openModal(returnModal);
    }

    async function copyRunFitting(runId) {
      const status = document.getElementById('copyFittingStatus');
      if (status) status.innerHTML = '';
      const result = await api.runs.copyFitting(runId);
      if (!status) return;
      status.innerHTML = result.omittedItemCount > 0
        ? `<div class="alert warn">Fitting copied. Implants are included as cargo; ${result.omittedItemCount} unclassified item${result.omittedItemCount === 1 ? ' was' : 's were'} omitted.</div>`
        : '<div class="alert success">Fitting copied. Implants are included as cargo.</div>';
    }

    async function deleteRun(runId) {
      if (!confirmAction('Delete this run? This cannot be undone.')) return;
      await api.runs.delete(runId);
      closeModal('runDetailModal');
      await refreshSavedRunViews();
    }


    function clearPendingReappraisal() {
      pendingHistoricalReappraisal = null;
    }

    return Object.freeze({
      clearPendingReappraisal,
      closeShipSetupModal,
      copyRunFitting,
      deleteRun,
      discardHistoricalReappraisal,
      invalidateHistoricalReappraisalPreview,
      reappraiseRun,
      saveHistoricalReappraisal,
      showRunDetail,
      showShipSetup,
    });
  }

  return Object.freeze({ createRunDetailsController });
});
