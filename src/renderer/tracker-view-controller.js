(function initTrackerViewController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tracker-view-markup'));
  } else {
    root.AbyssTrackerView = factory(root.AbyssTrackerViewMarkup);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule(markup) {
  function createTrackerViewController({
    document,
    api,
    inventoryEditors,
    formatDuration,
    formatIsk,
    escapeHtml,
    getActiveCharacterId,
    getActiveRun,
    getRunState,
    openModal,
    now = () => Date.now(),
  }) {
    for (const dependency of [
      formatDuration, formatIsk, escapeHtml, getActiveCharacterId,
      getActiveRun, getRunState, openModal, now,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Tracker view dependencies must be functions');
      }
    }
    if (!document || !api?.runs || !markup
      || !inventoryEditors?.inspectInventory || !inventoryEditors?.refresh) {
      throw new TypeError('Tracker view requires the document and inventory editor');
    }

    document.getElementById('trackerSessionMount').innerHTML = markup.sessionCardHtml();
    document.getElementById('trackerViewModalMount').innerHTML = markup.reviewModalHtml();

    let session = null;
    let recentGeneration = 0;
    let sessionGeneration = 0;
    const byId = id => document.getElementById(id);

    function inventoryCount(id, noun) {
      try {
        const snapshot = inventoryEditors.inspectInventory(byId(id)?.value || '');
        const count = noun === 'drone' ? snapshot.totalUnits : snapshot.itemTypes;
        const label = count === 1 ? noun : `${noun}s`;
        return `${count.toLocaleString()} ${label}`;
      } catch {
        return `${noun} contents captured`;
      }
    }

    function updatePreRunSummary() {
      const summary = byId('postRunPreSummary');
      if (!summary) return;
      summary.textContent = `Pre-run: ${inventoryCount('cargoBeforeText', 'cargo item type')}`
        + ` · ${inventoryCount('droneBeforeText', 'drone')}`;
    }

    function restorePreRunFields() {
      const fields = byId('preRunInventoryFields');
      const home = byId('preRunInventoryHome');
      if (fields && home && fields.parentElement !== home) home.append(fields);
      inventoryEditors.refresh('cargoAfterText');
      inventoryEditors.refresh('droneAfterText');
      updatePreRunSummary();
    }

    function openPreRunReview() {
      const fields = byId('preRunInventoryFields');
      const mount = byId('preRunReviewMount');
      if (!fields || !mount) return;
      mount.append(fields);
      openModal('preRunReviewModal');
    }

    function setState(state) {
      const preRunPanel = byId('preRunContentsPanel');
      if (preRunPanel) preRunPanel.hidden = !['awaiting', 'in-abyss'].includes(state);
      const badge = preRunPanel?.querySelector('.run-contents-stage');
      if (badge) {
        const captured = state === 'in-abyss';
        badge.textContent = captured ? 'Captured' : 'Before Run';
        badge.className = `run-contents-stage ${captured ? 'captured' : 'before'}`;
      }
      if (state === 'awaiting-cargo') updatePreRunSummary();
      const tone = state === 'died'
        ? 'red'
        : ['awaiting-cargo', 'appraisal'].includes(state) ? 'green'
          : state === 'in-abyss' ? 'cyan' : 'gold';
      const stateCard = byId('hudRunStateCard');
      if (stateCard) {
        stateCard.classList.remove('tone-cyan', 'tone-gold', 'tone-green', 'tone-red');
        stateCard.classList.add(`tone-${tone}`);
      }
      const stateValue = byId('hudRunState');
      if (stateValue) {
        stateValue.classList.remove('cyan', 'gold', 'green', 'red');
        stateValue.classList.add(tone);
      }
      renderSession();
    }

    function setSession(nextSession) {
      session = nextSession || null;
      renderSession();
    }

    async function refreshSession() {
      const generation = ++sessionGeneration;
      const characterId = getActiveCharacterId();
      if (!characterId) {
        setSession(null);
        return;
      }
      const nextSession = await api.runs.getSessionStats({ character_id: characterId });
      if (generation !== sessionGeneration || getActiveCharacterId() !== characterId) return;
      const anchor = getActiveRun()?.started_at || Math.floor(now() / 1000);
      const gapSeconds = Number(nextSession?.gap_seconds) || 3600;
      const isCurrent = nextSession && anchor - Number(nextSession.ended_at || 0) <= gapSeconds;
      setSession(isCurrent ? nextSession : null);
    }

    async function refreshRecentRuns() {
      const generation = ++recentGeneration;
      const characterId = getActiveCharacterId();
      const element = byId('recentRunsList');
      if (!characterId) {
        element.textContent = 'No runs yet';
        return;
      }
      const runs = await api.runs.getAll({ character_id: characterId, limit: 3 });
      if (generation !== recentGeneration || getActiveCharacterId() !== characterId) return;
      if (!runs.length) {
        element.textContent = 'No runs yet';
        return;
      }
      element.innerHTML = runs.map(run => {
        const positive = run.outcome === 'Survived' && run.net_isk >= 0;
        const value = run.outcome === 'Survived'
          ? formatIsk(run.net_isk)
          : `−${formatIsk(run.total_loss)}`;
        return `<div class="recent-run-row"><span>${escapeHtml(run.tier)} `
          + `${escapeHtml(run.weather)} <span class="badge `
          + `${run.outcome === 'Survived' ? 'survived' : 'died'} recent-run-outcome">`
          + `${run.outcome === 'Survived' ? '✓' : '✗'}</span></span>`
          + `<span class="recent-run-value ${positive ? 'positive' : 'negative'}">`
          + `${escapeHtml(value)}</span></div>`;
      }).join('');
    }

    function refresh() {
      return Promise.all([refreshRecentRuns(), refreshSession()]);
    }

    function activeDuration(run, state) {
      if (!run) return 0;
      if (state === 'in-abyss') {
        return Math.max(0, Math.floor(now() / 1000) - Number(run.started_at || 0));
      }
      return Math.max(0, Number(run.duration) || 0);
    }

    function renderSession() {
      const run = getActiveRun();
      const state = getRunState();
      const hasActiveRun = Boolean(run);
      const hasCompletedRuns = Boolean(session?.total_runs);
      const empty = byId('trackerSessionEmpty');
      const grid = byId('trackerSessionGrid');
      const active = byId('trackerSessionActive');
      if (!empty || !grid || !active) return;

      empty.hidden = hasActiveRun || hasCompletedRuns;
      grid.hidden = !hasActiveRun && !hasCompletedRuns;
      active.hidden = !hasActiveRun;
      active.textContent = state === 'in-abyss' ? '1 active' : '1 pending';
      if (!hasActiveRun && !hasCompletedRuns) return;

      const completedRuns = Number(session?.total_runs) || 0;
      const survived = Number(session?.survived) || 0;
      const duration = (Number(session?.total_duration) || 0) + activeDuration(run, state);
      const net = Number(session?.total_net_isk) || 0;
      byId('trackerSessionRuns').textContent = completedRuns.toLocaleString();
      byId('trackerSessionSurvival').textContent = completedRuns
        ? `${Math.round(survived / completedRuns * 100)}%`
        : '—';
      byId('trackerSessionDuration').textContent = formatDuration(duration);
      const netElement = byId('trackerSessionNet');
      netElement.textContent = completedRuns ? formatIsk(net) : '—';
      netElement.classList.toggle('positive', completedRuns && net >= 0);
      netElement.classList.toggle('negative', completedRuns && net < 0);
    }

    return Object.freeze({
      openPreRunReview,
      refresh,
      refreshRecentRuns,
      refreshSession,
      renderSession,
      restorePreRunFields,
      setSession,
      setState,
      updatePreRunSummary,
    });
  }

  return Object.freeze({ createTrackerViewController });
});
