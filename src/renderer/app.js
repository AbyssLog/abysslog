// ── State ─────────────────────────────────────────────────────────────────
const runTracking = window.AbyssRunTracking;
const appraisalHelpers = window.AbyssAppraisal;
const uiErrors = window.AbyssUiErrors;
const updateHelpers = window.AbyssUpdates;
const statistics = window.AbyssStatistics;
const statisticsReport = window.AbyssStatisticsReport;
const statsViewHelpers = window.AbyssStatsView;
const statisticsReportControllerHelpers = window.AbyssStatisticsReportController;
const historyViewHelpers = window.AbyssHistoryView;
const loadoutHelpers = window.AbyssLoadouts;
const shipGroups = window.AbyssShipGroups;
const loadoutControllerHelpers = window.AbyssLoadoutController;
const inventoryEditors = window.AbyssInventoryEditor;
const trackerViewHelpers = window.AbyssTrackerView;
const runSessionHelpers = window.AbyssRunSession;
const concurrentTrackingHelpers = window.AbyssConcurrentTracking;
const characterTrackingUiHelpers = window.AbyssCharacterTrackingUi;
const trackingPreparationHelpers = window.AbyssTrackingPreparation;
const navigationHelpers = window.AbyssNavigation;
const modalHelpers = window.AbyssModals;
const formatters = window.AbyssUiFormatters;
const fitNameHelpers = window.AbyssFitNames;
const supportSettingsHelpers = window.AbyssSupportSettings;
const uiTaskHelpers = window.AbyssUiTasks;
const runDetailsHelpers = window.AbyssRunDetails;
const manualRunHelpers = window.AbyssManualRuns;
const manualEncounterHelpers = window.AbyssManualEncounters;
const characterHelpers = window.AbyssCharacters;
const formatBytes = formatters.formatBytes;
const fmtIsk = formatters.formatIsk;
const fmtDuration = formatters.formatDuration;

const {
  dismissGlobalError,
  recordRendererDiagnostic,
  reportUiError,
  runUiTask,
} = uiTaskHelpers.createUiTaskController({
  document,
  diagnostics: window.api?.diagnostics,
  formatError: uiErrors.formatUiError,
});

const S = {
  characters: [],
  activeCharId: null,
  hasAuth: false,
  capabilities: { tracking: false, fitting: false, implants: false, killmails: false },
  characterCapabilities: {},
  hasJaniceKey: false,
  secureStorage: { available: false, backend: 'unknown' },
  dataStatus: null,
  diagnosticsStatus: null,
  settings: {},
  loadoutPresets: [],
  runState: 'awaiting', // awaiting | in-abyss | awaiting-cargo | appraisal | died
  activeRun: null,
  timerInterval: null,
  pollTimeout: null,
  pollGeneration: 0,
  pollFailureCount: 0,
  trackingStatuses: {},
};
const normalizeCapabilities = characterHelpers.normalizeCapabilities;
const characterController = characterHelpers.createCharacterController({
  document,
  api: window.api,
  state: S,
  escapeHtml: esc,
  switchCharacter,
  onRemoveActiveCharacter: async () => {
    stopESIPoll();
    S.activeRun = null;
    resetRunUI();
  },
  openModal,
  closeModal,
  confirmAction: message => confirm(message),
});
const {
  getSelectedCapabilities,
  handleComplete: handleAuthComplete,
  handleError: handleAuthError,
  openAdd: openAddCharModal,
  populateSelect: populateCharSelect,
  reauthorize: reauthCharacter,
  refreshCapabilities: refreshCharacterCapabilities,
  remove: removeCharacter,
  renderList: renderCharList,
  setSelectedCapabilities,
  showNoCharacter: showNoCharPrompt,
  startSso: startSSO,
  updatePermissionSummary,
} = characterController;
const supportSettings = supportSettingsHelpers.createSupportSettingsController({
  document,
  api: window.api,
  state: S,
  formatBytes,
  formatIsk: fmtIsk,
  renderCharList,
  refreshSavedRunViews,
  startPolling: startESIPoll,
  confirmAction: message => confirm(message),
});
const {
  copyDiagnostics,
  createFullBackup,
  importCSV,
  load: loadSettingsPage,
  openBackupFolder,
  openDiagnosticsFolder,
  removeJaniceKey,
  restoreFullBackup,
  save: saveSettings,
  testJaniceKey,
  toggleJaniceKey,
} = supportSettings;

const loadoutController = loadoutControllerHelpers.createLoadoutController({
  document,
  api: window.api,
  state: S,
  loadouts: loadoutHelpers,
  openModal,
  confirmAction: message => confirm(message),
  setInventoryText,
  applyInventory: ({ cargoText, droneText }) => {
    setInventoryText('cargoBeforeText', cargoText);
    setInventoryText('droneBeforeText', droneText);
    inventoryBaselineRunId = null;
    hideInventoryBaselineStatus();
    updatePasteHint('cargoBeforeText', 'preCargoHint');
    updatePasteHint('droneBeforeText', 'preDroneHint');
    if (droneText) setCollapsibleState('preDroneBody', 'preDroneArrow', true);
    updateFilamentInference();
    scheduleTrackingDraftSave();
  },
});
const {
  applyPreset: applyLoadoutPreset,
  deletePreset: deleteLoadoutPreset,
  handleEditorSelection: handleLoadoutEditorSelection,
  openManager: openLoadoutManager,
  renderPresetSelect: renderLoadoutPresetSelect,
  savePreset: saveLoadoutPreset,
  startNewPreset: startNewLoadoutPreset,
  updateControls: updateLoadoutControls,
} = loadoutController;


const runDetailsController = runDetailsHelpers.createRunDetailsController({
  document,
  api: window.api,
  state: S,
  fitting: window.AbyssFitting,
  appraisalHelpers,
  inventoryEditors,
  fmtIsk,
  fmtDuration,
  esc,
  openModal,
  closeModal,
  refreshSavedRunViews,
  confirmAction: message => confirm(message),
});
const {
  closeShipSetupModal,
  copyRunFitting,
  deleteRun,
  discardHistoricalReappraisal,
  invalidateHistoricalReappraisalPreview,
  reappraiseRun,
  saveHistoricalReappraisal,
  showRunDetail,
  showShipSetup,
} = runDetailsController;

const manualRunController = manualRunHelpers.createManualRunController({
  document,
  api: window.api,
  state: S,
  appraisal: appraisalHelpers,
  parseTags: parseRunTags,
  parseInventory: parseCargo,
  mergeInventory: mergeDiffItems,
  setInventoryText,
  formatIsk: fmtIsk,
  escapeHtml: esc,
  openModal,
  closeModal,
  refreshSavedRunViews,
});
const {
  close: closeManualEntryModal,
  hasUnsavedInput: hasUnsavedManualRunInput,
  invalidatePreview: invalidateManualEditAppraisalPreview,
  openEdit: openEditRunModal,
  openNew: openManualEntryModal,
  submit: submitManualEntry,
  updateOutcome: updateManualOutcomeUI,
} = manualRunController;

const manualEncounterController = manualEncounterHelpers.createManualEncounterController({
  document,
  api: window.api,
  state: S,
  appraisal: appraisalHelpers,
  inventoryEditors,
  parseTags: parseRunTags,
  parseInventory: parseCargo,
  mergeInventory: mergeDiffItems,
  escapeHtml: esc,
  openModal,
  closeModal,
  refreshSavedRunViews,
});
const {
  addParticipant: addManualEncounterParticipant,
  close: closeManualEncounterModal,
  handleDefinitionChange: handleManualEncounterDefinitionChange,
  hasUnsavedInput: hasUnsavedManualEncounterInput,
  open: openManualEncounterModal,
  removeParticipant: removeManualEncounterParticipant,
  submit: submitManualEncounter,
} = manualEncounterController;

function switchManualEntryMode(mode) {
  if (mode === 'group') {
    if (document.getElementById('manualEncounterModal').getAttribute('aria-hidden') === 'false') return;
    if (hasUnsavedManualRunInput()
      && !confirm('Switching to Group clears the current Solo form. Continue?')) return;
    closeManualEntryModal(true);
    openManualEncounterModal();
  } else if (mode === 'solo') {
    if (document.getElementById('manualEntryModal').getAttribute('aria-hidden') === 'false') return;
    if (hasUnsavedManualEncounterInput()
      && !confirm('Switching to Solo clears the current Group form. Continue?')) return;
    closeManualEncounterModal(true);
    openManualEntryModal();
  }
}

const trackerViewController = trackerViewHelpers.createTrackerViewController({
  document,
  api: window.api,
  inventoryEditors,
  formatDuration: fmtDuration,
  formatIsk: fmtIsk,
  escapeHtml: esc,
  getActiveCharacterId: () => S.activeCharId,
  getActiveRun: () => S.activeRun,
  getRunState: () => S.runState,
  openModal,
});

const characterTrackingUi = characterTrackingUiHelpers
  .createCharacterTrackingUiController({
    document,
    state: S,
    parseTags: parseRunTags,
    setInventoryText,
  });

const concurrentTrackingController = concurrentTrackingHelpers
  .createConcurrentTrackingController({
    api: window.api,
    runTracking,
    getCharacters: () => S.characters,
    getCapabilities: characterId => normalizeCapabilities(
      S.characterCapabilities[characterId]
    ),
    getSelectedCharacterId: () => S.activeCharId,
    getForegroundRun: () => S.activeRun,
    getSettings: () => S.settings,
    classifyShip,
    onStatusChange: (characterId, status) => {
      S.trackingStatuses[characterId] = status;
      renderCharacterTrackingStatus();
      renderActiveEncounterStatus();
    },
  });

function renderCharacterTrackingStatus() {
  characterTrackingUi.renderStatuses(characterId => (
    concurrentTrackingController.statusFor(characterId)
  ));
}

function renderActiveEncounterStatus() {
  characterTrackingUi.renderEncounter(
    run => concurrentTrackingController.groupForRun(run),
    run => concurrentTrackingController.candidateGroupForRun(run)
  );
}

async function confirmEncounterGroup() {
  if (!S.activeRun) return;
  const participants = await concurrentTrackingController.confirmGroupCandidate(S.activeRun);
  if (participants.length < 2) return;
  await persistActiveRun();
  renderActiveEncounterStatus();
}

function dismissEncounterGroup() {
  if (S.activeRun) concurrentTrackingController.dismissGroupCandidate(S.activeRun);
  renderActiveEncounterStatus();
}

const trackingPreparationController = trackingPreparationHelpers
  .createTrackingPreparationController({
    api: window.api,
    state: S,
    trackingUi: characterTrackingUi,
    restoreBaseline: restoreInventoryBaseline,
    afterRestore: usedStoredDraft => {
      if (usedStoredDraft) {
        inventoryBaselineRunId = null;
        hideInventoryBaselineStatus();
      }
      updatePasteHint('cargoBeforeText', 'preCargoHint');
      updatePasteHint('droneBeforeText', 'preDroneHint');
      if (document.getElementById('droneBeforeText').value.trim()) {
        setCollapsibleState('preDroneBody', 'preDroneArrow', true);
      }
      updateFilamentInference();
    },
    onSaved: draft => concurrentTrackingController.updateDraft(draft),
    onError: error => reportUiError(
      'Could not save the character preparation',
      error,
      'checkpoint-error'
    ),
  });
const {
  persist: persistTrackingDraft,
  restore: restoreTrackingDraft,
  schedule: scheduleTrackingDraftSave,
} = trackingPreparationController;

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  inventoryEditors.initialize(document);
  initializeTrackerLayout();
  window.api.auth.onComplete(handleAuthComplete);
  window.api.auth.onError(handleAuthError);

  [
    S.settings,
    S.characters,
    S.secureStorage,
    S.hasJaniceKey,
    S.dataStatus,
    S.diagnosticsStatus,
    S.loadoutPresets,
  ] = await Promise.all([
    window.api.settings.getAll(),
    window.api.auth.getCharacters(),
    window.api.secrets.status(),
    window.api.secrets.hasJaniceKey(),
    window.api.data.getStatus(),
    window.api.diagnostics.getStatus(),
    window.api.loadouts.get(),
  ]);
  await refreshCharacterCapabilities();

  loadSettingsPage();
  renderLoadoutPresetSelect();
  await initAboutPage();
  await populateCharSelect();

  const savedCharId = S.settings.active_character;
  if (savedCharId && S.characters.find(c => String(c.id) === String(savedCharId))) {
    await switchCharacter(savedCharId, false);
  } else if (S.characters.length > 0) {
    await switchCharacter(S.characters[0].id, false);
  } else {
    showNoCharPrompt();
  }

  await concurrentTrackingController.start();
  renderCharacterTrackingStatus();
  renderActiveEncounterStatus();

}

function initializeTrackerLayout() {
  const runSetup = document.getElementById('state-awaiting');
  const recentRunsPanel = document.getElementById('recentRunsList')?.closest('.panel');
  if (!runSetup || !recentRunsPanel) return;
  recentRunsPanel.after(runSetup);
}

// ── Navigation ────────────────────────────────────────────────────────────
const navigationController = navigationHelpers.createNavigationController({
  document,
  onShowPage: name => {
    if (name === 'history') return renderHistory();
    if (name === 'stats') return renderStats();
    return undefined;
  },
});
function showPage(name) {
  return navigationController.show(name);
}

// Character switching remains the top-level owner of active-run and polling transitions.
let characterSwitchChain = Promise.resolve();

function switchCharacter(charId, save = true) {
  characterSwitchChain = characterSwitchChain
    .catch(() => {})
    .then(() => performCharacterSwitch(charId, save));
  return characterSwitchChain;
}

async function performCharacterSwitch(charId, save = true) {
  if (S.activeRun?.finalizing) {
    document.getElementById('charSelect').value = S.activeCharId || '';
    return;
  }
  const previousCharacterId = S.activeCharId;
  if (previousCharacterId && !S.activeRun && S.runState === 'awaiting') {
    await persistTrackingDraft();
  }
  stopESIPoll();
  if (S.activeRun) {
    const run = S.activeRun;
    runSessionController.suspend(run);
    syncActiveRunInputs();
    try {
      await persistActiveRun();
    } catch (error) {
      runSessionController.resume(run);
      if (S.capabilities.tracking) startESIPoll();
      throw error;
    }
  }
  S.activeRun = null;
  resetRunUI();
  clearTrackerInputs();
  lastShipTypeId = lastShipHullName = null;
  lastSystemId = null;
  lastSystemName = null;

  const normalizedCharacterId = charId ? Number(charId) : null;
  S.activeCharId = normalizedCharacterId;
  document.getElementById('charSelect').value = normalizedCharacterId || '';

  if (previousCharacterId && Number(previousCharacterId) !== normalizedCharacterId) {
    await concurrentTrackingController.refreshCharacter(previousCharacterId);
  }

  if (!normalizedCharacterId) {
    S.hasAuth = false;
    S.capabilities = normalizeCapabilities(null);
    trackerViewController.setSession(null);
    showNoCharPrompt();
    if (document.getElementById('page-history').classList.contains('active')) await renderHistory();
    if (document.getElementById('page-stats').classList.contains('active')) await renderStats();
    return;
  }

  if (save) await window.api.settings.set('active_character', normalizedCharacterId);

  S.hasAuth = await window.api.auth.hasTokens(normalizedCharacterId);
  S.capabilities = S.hasAuth
    ? normalizeCapabilities(await window.api.auth.getCapabilities(normalizedCharacterId))
    : normalizeCapabilities(null);
  S.characterCapabilities[normalizedCharacterId] = S.capabilities;

  document.getElementById('no-char-prompt').style.display = 'none';
  document.getElementById('tracker-ui').style.display = 'block';

  loadDefaultSelects();
  await trackerViewController.refreshRecentRuns();
  const restored = await restoreActiveRun(normalizedCharacterId);
  if (!restored) await restoreTrackingDraft(normalizedCharacterId);
  resetTransitionTracker(restored?.state === 'in-abyss' ? 'inside' : 'outside');
  await trackerViewController.refreshSession();

  if (S.capabilities.tracking) {
    startESIPoll();
    document.getElementById('statusDot').className = 'status-dot online';
  } else {
    document.getElementById('statusDot').className = 'status-dot';
    document.getElementById('hudEsiVal').textContent = S.hasAuth ? 'Manual Mode' : 'No Token';
    document.getElementById('hudEsiVal').title = S.hasAuth
      ? 'Automatic tracking was not authorized for this character'
      : '';
  }

  renderCharList();
  renderCharacterTrackingStatus();
  renderActiveEncounterStatus();
  if (document.getElementById('page-history').classList.contains('active')) await renderHistory();
  if (document.getElementById('page-stats').classList.contains('active')) await renderStats();
}

function loadDefaultSelects() {
  if (S.settings.default_tier) document.getElementById('tierSelect').value = S.settings.default_tier;
  if (S.settings.default_weather) document.getElementById('weatherSelect').value = S.settings.default_weather;
}

// ── ESI Polling ───────────────────────────────────────────────────────────
const ABYSSAL_MIN = 32000000;
const CAPSULE_IDS = [670, 33328];
let lastShipTypeId = null, lastShipHullName = null;
let lastSystemId = null;
let lastSystemName = null;
let inventoryBaselineRunId = null;
let transitionTracker = runTracking.createTransitionTracker();

function resetTransitionTracker(phase = 'outside') {
  transitionTracker = runTracking.createTransitionTracker({ initialPhase: phase });
}

function isCurrentPoll(generation, characterId) {
  return (
    generation === S.pollGeneration
    && characterId === S.activeCharId
    && S.capabilities.tracking
  );
}

async function pollESI(generation, characterId) {
  if (!isCurrentPoll(generation, characterId)) return;
  document.getElementById('statusDot').className = 'status-dot scanning';

  try {
    const [loc, ship] = await Promise.all([
      window.api.esi.getLocation(characterId),
      window.api.esi.getShip(characterId)
    ]);
    if (!isCurrentPoll(generation, characterId)) return;

    const sysId = Number(loc?.solar_system_id);
    const shipTypeId = Number(ship?.ship_type_id);
    if (!Number.isSafeInteger(sysId) || sysId < 1) {
      throw new TypeError('ESI returned an invalid solar system');
    }
    if (!Number.isSafeInteger(shipTypeId) || shipTypeId < 1) {
      throw new TypeError('ESI returned an invalid ship type');
    }
    const unresolvedHullName = 'Ship ' + shipTypeId;
    let shipHullName = lastShipHullName;
    if (shipTypeId !== lastShipTypeId || !shipHullName || shipHullName === unresolvedHullName) {
      const typeNames = await window.api.esi.getTypeNames([shipTypeId]).catch(() => ({}));
      if (!isCurrentPoll(generation, characterId)) return;
      shipHullName = typeNames[shipTypeId] || unresolvedHullName;
    }
    const inAbyss = sysId >= ABYSSAL_MIN;
    const isCapsule = CAPSULE_IDS.includes(shipTypeId);

    // Update HUD
    if (inAbyss) {
      lastSystemName = 'Abyssal #' + sysId;
      document.getElementById('hudLocationVal').textContent = lastSystemName;
      document.getElementById('hudLocation').classList.add('active');
    } else {
      document.getElementById('hudLocation').classList.remove('active');
      if (sysId !== lastSystemId) {
        window.api.esi.getSystemName(sysId).then(name => {
          if (isCurrentPoll(generation, characterId) && lastSystemId === sysId) {
            lastSystemName = name;
            document.getElementById('hudLocationVal').textContent = name;
          }
        }).catch(() => {});
      }
    }
    document.getElementById('hudShipVal').textContent = shipHullName;
    document.getElementById('hudEsiVal').textContent = inAbyss ? '⚡ IN ABYSS' : 'Active';
    document.getElementById('hudEsiVal').title = '';
    document.getElementById('statusDot').className = inAbyss ? 'status-dot abyss' : 'status-dot online';

    lastSystemId = sysId;
    lastShipTypeId = shipTypeId;
    lastShipHullName = shipHullName;

    const transition = transitionTracker.observe({
      inAbyss,
      isCapsule,
      observedAt: Math.floor(Date.now() / 1000),
    });
    if (transition?.type === 'entered' && S.runState === 'awaiting') {
      autoStartRun(transition.observedAt);
    } else if (transition?.type === 'exited' && S.runState === 'in-abyss') {
      if (transition.outcome === 'Died') {
        await autoEndDied(transition.observedAt);
      } else {
        autoEndSurvived(transition.observedAt);
      }
    }
    return { success: true };

  } catch (e) {
    if (!isCurrentPoll(generation, characterId)) return null;
    const authError = /character authorization|\bHTTP (?:401|403)\b/i.test(e.message || '');
    let authorizationAvailable = true;
    if (authError) {
      try {
        authorizationAvailable = await window.api.auth.hasTokens(characterId);
      } catch {
        authorizationAvailable = true;
      }
      if (!isCurrentPoll(generation, characterId)) return null;
      if (!authorizationAvailable) {
        S.hasAuth = false;
        S.capabilities = normalizeCapabilities(null);
        S.characterCapabilities[characterId] = S.capabilities;
        renderCharList();
      }
    }
    document.getElementById('hudEsiVal').textContent = !authorizationAvailable
      ? 'Authorization Required'
      : authError ? 'Auth Error' : 'Reconnecting…';
    document.getElementById('hudEsiVal').title = authError
      ? 'Go to Settings → Permissions to authorize this character again'
      : 'ESI is temporarily unavailable; AbyssLog will retry automatically';
    document.getElementById('statusDot').className = 'status-dot';
    return { success: false, authError };
  }
}

async function runESIPollLoop(generation, characterId, interval) {
  const result = await pollESI(generation, characterId);
  if (!isCurrentPoll(generation, characterId)) return;
  if (result?.authError) return;
  let delay = interval;
  if (result?.success) {
    S.pollFailureCount = 0;
  } else {
    S.pollFailureCount++;
    delay = runTracking.calculateBackoffDelay(interval, S.pollFailureCount);
    if (!result?.authError) {
      document.getElementById('hudEsiVal').textContent =
        `Reconnecting in ${Math.ceil(delay / 1000)}s`;
    }
  }
  S.pollTimeout = setTimeout(() => {
    void runESIPollLoop(generation, characterId, interval);
  }, delay);
}

function startESIPoll() {
  stopESIPoll();
  const interval = Math.max(3, parseInt(S.settings.esi_poll_interval) || 5) * 1000;
  const generation = S.pollGeneration;
  void runESIPollLoop(generation, S.activeCharId, interval);
}

function stopESIPoll() {
  S.pollGeneration++;
  S.pollFailureCount = 0;
  if (S.pollTimeout) {
    clearTimeout(S.pollTimeout);
    S.pollTimeout = null;
  }
}

// ── Run Lifecycle ─────────────────────────────────────────────────────────
let runSessionController = null;

function isCurrentRunAppraisal(run, generation) {
  return runSessionController.isCurrentAppraisal(run, generation);
}

async function classifyShip(typeId) {
  if (!typeId) return 'Unknown';
  try {
    const info = await window.api.esi.getTypeInfo(typeId);
    return shipGroups.classifyShipByGroup(info.group_id);
  } catch (e) {
    return 'Unknown';
  }
}

let activeCheckpointErrorReportedAt = 0;
const ACTIVE_CHECKPOINT_ERROR_COOLDOWN_MS = 60_000;

function reportActiveRunCheckpointError(error) {
  const now = Date.now();
  if (now - activeCheckpointErrorReportedAt < ACTIVE_CHECKPOINT_ERROR_COOLDOWN_MS) {
    console.error('Failed to checkpoint active run:', error);
    return;
  }
  activeCheckpointErrorReportedAt = now;
  reportUiError(
    'Could not save the current run recovery checkpoint',
    error,
    'checkpoint-error'
  );
}

runSessionController = runSessionHelpers.createRunSessionController({
  getActiveRun: () => S.activeRun,
  createSnapshot: () => activeRunSnapshot(),
  saveActive: snapshot => window.api.runs.saveActive(snapshot).then(result => {
    activeCheckpointErrorReportedAt = 0;
    return result;
  }),
  clearActive: characterId => window.api.runs.clearActive(characterId),
  syncInputs: () => syncActiveRunInputs(),
  onCheckpointError: error => reportActiveRunCheckpointError(error),
});

function clearTrackerInputs() {
  inventoryBaselineRunId = null;
  for (const id of [
    'cargoBeforeText',
    'cargoAfterText',
    'droneBeforeText',
    'droneAfterText',
  ]) {
    setInventoryText(id, '');
  }
  hideInventoryBaselineStatus();
  document.getElementById('loadoutApplyStatus').hidden = true;
  clearFilamentInference();
}

function hideInventoryBaselineStatus() {
  document.getElementById('inventoryBaselineStatus').style.display = 'none';
}

function showInventoryBaselineStatus(startedAt) {
  const date = new Date(startedAt * 1000);
  document.getElementById('inventoryBaselineText').textContent =
    `Prefilled from the run started ${date.toLocaleString()}. Clear or replace it if you docked, unloaded loot, restocked, or changed drones.`;
  document.getElementById('inventoryBaselineStatus').style.display = 'block';
}

async function restoreInventoryBaseline(characterId) {
  hideInventoryBaselineStatus();
  inventoryBaselineRunId = null;
  const latestRun = await window.api.runs.getInventoryBaseline(characterId);
  if (!latestRun) return;
  const nextCargo = latestRun.cargo_after || '';
  const nextDrones = latestRun.drone_after?.trim()
    ? latestRun.drone_after
    : latestRun.drone_before || '';
  if (!nextCargo.trim() && !nextDrones.trim()) return;

  inventoryBaselineRunId = latestRun.id;
  setInventoryText('cargoBeforeText', nextCargo);
  setInventoryText('droneBeforeText', nextDrones);
  updatePasteHint('cargoBeforeText', 'preCargoHint');
  updatePasteHint('droneBeforeText', 'preDroneHint');
  if (nextDrones.trim()) {
    setCollapsibleState('preDroneBody', 'preDroneArrow', true);
  }
  showInventoryBaselineStatus(latestRun.started_at);
}


async function clearInventoryBaseline() {
  const characterId = S.activeCharId;
  const runId = inventoryBaselineRunId;
  if (characterId && runId) {
    const cleared = await window.api.runs.clearInventoryBaseline(characterId, runId);
    if (!cleared) {
      throw new Error('The remembered baseline changed; reload it before clearing');
    }
  }
  inventoryBaselineRunId = null;
  setInventoryText('cargoBeforeText', '');
  setInventoryText('droneBeforeText', '');
  updatePasteHint('cargoBeforeText', 'preCargoHint');
  updatePasteHint('droneBeforeText', 'preDroneHint');
  hideInventoryBaselineStatus();
  clearFilamentInference();
  document.getElementById('loadoutApplyStatus').hidden = true;
}

function parseRunTags(value) {
  const seen = new Set();
  const tags = [];
  for (const rawTag of String(value || '').split(',')) {
    const tag = rawTag.trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}
function syncActiveRunInputs() {
  if (!S.activeRun) return;
  S.activeRun.cargoBefore = document.getElementById('cargoBeforeText').value;
  S.activeRun.cargoAfter = document.getElementById('cargoAfterText').value;
  S.activeRun.droneBefore = document.getElementById('droneBeforeText').value;
  S.activeRun.droneAfter = document.getElementById('droneAfterText').value;
  S.activeRun.notes = document.getElementById('activeRunNotes').value;
  S.activeRun.tags = parseRunTags(document.getElementById('activeRunTags').value);
}

function activeRunSnapshot() {
  if (!S.activeRun) return null;
  const state = S.runState === 'died'
    ? 'died'
    : S.runState === 'in-abyss' ? 'in-abyss' : 'awaiting-cargo';
  const run = S.activeRun;
  return window.AbyssSecurity.validateActiveRunSnapshot({
    version: 3,
    state,
    run: {
      character_id: run.character_id,
      encounter_uid: run.encounter_uid,
      started_at: run.started_at,
      duration: run.duration || 0,
      tier: run.tier,
      weather: run.weather,
      outcome: state === 'in-abyss' ? null : state === 'died' ? 'Died' : 'Survived',
      system_id: run.system_id ?? lastSystemId,
      system_name: run.system_name || lastSystemName,
      cargoBefore: run.cargoBefore || '',
      cargoAfter: run.cargoAfter || '',
      droneBefore: run.droneBefore || '',
      droneAfter: run.droneAfter || '',
      hull_name: run.hull_name || '',
      ship_class: run.ship_class || 'Unknown',
      notes: run.notes || '',
      tags: run.tags || [],
      fitting: run.fitting || [],
      implants: run.implants || [],
      fitCaptured: Boolean(run.fitCaptured),
      killmailItems: run.killmailItems || [],
      killmailIds: run.killmailIds || [],
    },
  });
}

function persistActiveRun() {
  return runSessionController.persist();
}

function scheduleActiveRunCheckpoint() {
  runSessionController.scheduleCheckpoint();
}

async function clearPersistedActiveRun(characterId) {
  await runSessionController.clearPersisted(characterId);
}

async function restoreActiveRun(characterId) {
  const snapshot = await window.api.runs.getActive(characterId);
  if (!snapshot) return null;

  hideInventoryBaselineStatus();
  S.activeRun = snapshot.run;
  lastSystemId = snapshot.run.system_id;
  lastSystemName = snapshot.run.system_name;
  lastShipHullName = snapshot.run.hull_name || null;
  document.getElementById('activeRunNotes').value = snapshot.run.notes || '';
  document.getElementById('activeRunTags').value = (snapshot.run.tags || []).join(', ');
  setInventoryText('cargoBeforeText', snapshot.run.cargoBefore);
  setInventoryText('cargoAfterText', snapshot.run.cargoAfter);
  setInventoryText('droneBeforeText', snapshot.run.droneBefore);
  setInventoryText('droneAfterText', snapshot.run.droneAfter);
  document.getElementById('fitCaptured').style.display =
    snapshot.run.fitCaptured ? 'block' : 'none';
  updateRunInfo();

  const recoveryStatus = document.getElementById('recoveryStatus');
  recoveryStatus.textContent = 'Recovered your unfinished run from the last session.';
  recoveryStatus.style.display = 'block';

  if (snapshot.state === 'in-abyss') {
    document.getElementById('hudRunState').textContent = 'In Abyss';
    setRunState('in-abyss');
    startTimer();
  } else if (snapshot.state === 'died') {
    document.getElementById('timerDisplay').textContent = fmtDuration(snapshot.run.duration);
    document.getElementById('timerDisplay').classList.add('died');
    document.getElementById('hudRunState').textContent = 'Died';
    document.getElementById('infoOutcome').innerHTML = '<span class="badge died">Died</span>';
    setRunState('died');
    void prepareDeathLoss();
  } else {
    document.getElementById('timerDisplay').textContent = fmtDuration(snapshot.run.duration);
    document.getElementById('timerDisplay').classList.add('survived');
    document.getElementById('hudRunState').textContent = 'Survived';
    document.getElementById('infoOutcome').innerHTML = '<span class="badge survived">Survived</span>';
    setRunState('awaiting-cargo');
  }
  return snapshot;
}

function startRun(startedAt = Math.floor(Date.now() / 1000)) {
  if (S.activeRun || S.runState !== 'awaiting' || !S.activeCharId) return;
  const tier = document.getElementById('tierSelect').value;
  const weather = document.getElementById('weatherSelect').value;
  const cargoBefore = document.getElementById('cargoBeforeText').value;
  const droneBefore = document.getElementById('droneBeforeText').value;
  const notes = document.getElementById('activeRunNotes').value;
  const tags = parseRunTags(document.getElementById('activeRunTags').value);
  const shipTypeId = lastShipTypeId;
  const encounterUid = concurrentTrackingController.assignEncounter(lastSystemId, startedAt);

  S.activeRun = {
    character_id: S.activeCharId,
    encounter_uid: encounterUid,
    started_at: startedAt,
    duration: 0,
    tier: tier || 'Unknown',
    weather: weather || 'Unknown',
    hull_name: lastShipHullName || document.getElementById('hudShipVal').textContent || '',
    ship_class: 'Unknown',
    system_id: lastSystemId,
    system_name: lastSystemName,
    notes,
    tags,
    cargoBefore,
    cargoAfter: '',
    droneBefore,
    droneAfter: '',
    outcome: null,
    fitting: [],
    implants: [],
    fitCaptured: false,
    killmailItems: [],
    killmailIds: [],
  };

  void trackerViewController.refreshSession().catch(() => {});

  document.getElementById('recoveryStatus').style.display = 'none';
  setRunState('in-abyss');
  startTimer();
  updateRunInfo();
  renderCharacterTrackingStatus();
  renderActiveEncounterStatus();
  void persistActiveRun().catch(reportActiveRunCheckpointError);
  void captureActiveRunDetails(S.activeRun, shipTypeId);
}

async function captureActiveRunDetails(run, shipTypeId) {
  const characterId = run.character_id;
  try {
    const capabilities = { ...S.capabilities };
    const [fitResult, implantResult] = await Promise.allSettled([
      capabilities.fitting
        ? window.api.esi.getFitting(characterId)
        : Promise.resolve(null),
      capabilities.implants
        ? window.api.esi.getImplants(characterId)
        : Promise.resolve(null),
    ]);
    if (S.activeRun !== run || run.finalizing || run.suspended) return;
    const fitData = fitResult.status === 'fulfilled' ? fitResult.value : null;
    const implantIds = implantResult.status === 'fulfilled' && implantResult.value
      ? implantResult.value
      : [];
    const resolvedShipTypeId = fitData?.ship_type_id || shipTypeId;
    run.ship_class = await classifyShip(resolvedShipTypeId);
    if (S.activeRun !== run || run.finalizing || run.suspended) return;
    renderActiveEncounterStatus();

    const typeIds = [
      ...(fitData
        ? [fitData.ship_type_id, ...fitData.items.map(item => item.type_id)]
        : []),
      ...implantIds,
    ];
    const typeNames = typeIds.length > 0
      ? await window.api.esi.getTypeNames([...new Set(typeIds)])
      : {};
    if (S.activeRun !== run || run.finalizing || run.suspended) return;

    if (fitData) {
      run.hull_name = typeNames[fitData.ship_type_id] || run.hull_name;
      run.fitting = [
        { type_id: fitData.ship_type_id, type_name: typeNames[fitData.ship_type_id] || `Type ${fitData.ship_type_id}`, qty: 1, slot: 'hull' },
        ...fitData.items.map(i => ({
          type_id: i.type_id,
          type_name: typeNames[i.type_id] || `Type ${i.type_id}`,
          qty: i.quantity || 1,
          slot: i.flag || 'unknown'
        }))
      ];
    }
    if (implantResult.status === 'fulfilled' && implantResult.value) {
      run.implants = implantIds.map(id => ({
        type_id: id,
        type_name: typeNames[id] || `Type ${id}`,
      }));
    }

    const capturedFeatures = [];
    if (fitResult.status === 'fulfilled' && fitResult.value) capturedFeatures.push('ship fitting');
    if (implantResult.status === 'fulfilled' && implantResult.value) capturedFeatures.push('implants');
    run.fitCaptured = capturedFeatures.length > 0;
    if (run.fitCaptured) {
      document.getElementById('fitCaptured').textContent =
        `✓ ${capturedFeatures.join(' and ')} captured for loss tracking`;
      document.getElementById('fitCaptured').style.display = 'block';
    }
    const failedFeatures = [];
    if (fitResult.status === 'rejected') {
      failedFeatures.push('the ship fitting');
      console.error('Failed to capture fitting:', fitResult.reason);
    }
    if (implantResult.status === 'rejected') {
      failedFeatures.push('implants');
      console.error('Failed to capture implants:', implantResult.reason);
    }
    if (failedFeatures.length > 0) {
      const firstFailure = fitResult.status === 'rejected'
        ? fitResult.reason
        : implantResult.reason;
      reportUiError(
        `Could not capture ${failedFeatures.join(' or ')} for loss tracking`,
        firstFailure,
        'capture-error'
      );
    }
    if (S.activeRun === run && !run.finalizing && !run.suspended) await persistActiveRun();
  } catch (e) {
    reportUiError('Could not capture loss-tracking details', e, 'capture-error');
  }
}

function manualStart() {
  startRun();
}

function autoStartRun(startedAt) {
  startRun(startedAt);
}

function autoEndSurvived(endedAt) {
  return endRunSurvived(endedAt);
}

function autoEndDied(endedAt) {
  return endRunDied(endedAt);
}

function manualEndSurvived() {
  return endRunSurvived();
}

function manualEndDied() {
  return endRunDied();
}

function endRunSurvived(endedAt = Math.floor(Date.now() / 1000)) {
  if (!S.activeRun || S.runState !== 'in-abyss') return;
  stopTimer();
  S.activeRun.outcome = 'Survived';
  S.activeRun.duration = Math.max(0, endedAt - S.activeRun.started_at);
  document.getElementById('timerDisplay').classList.add('survived');
  document.getElementById('timerDisplay').textContent = fmtDuration(S.activeRun.duration);
  document.getElementById('hudRunState').textContent = 'Survived';
  document.getElementById('infoOutcome').innerHTML = '<span class="badge survived">Survived</span>';
  setRunState('awaiting-cargo');
  void persistActiveRun().catch(reportActiveRunCheckpointError);
}

async function endRunDied(endedAt = Math.floor(Date.now() / 1000)) {
  if (!S.activeRun || S.runState !== 'in-abyss') return;
  stopTimer();
  S.activeRun.outcome = 'Died';
  S.activeRun.duration = Math.max(0, endedAt - S.activeRun.started_at);
  document.getElementById('timerDisplay').classList.add('died');
  document.getElementById('timerDisplay').textContent = fmtDuration(S.activeRun.duration);
  document.getElementById('hudRunState').textContent = 'Died';
  document.getElementById('infoOutcome').innerHTML = '<span class="badge died">Died</span>';
  setRunState('died');
  await persistActiveRun();
  await prepareDeathLoss();
}

async function prepareDeathLoss() {
  if (!S.activeRun || S.activeRun.outcome !== 'Died') return;
  await reconcileKillmailLoss();
  await appraiseLoss();
}

async function reconcileKillmailLoss({ reappraise = false } = {}) {
  const run = S.activeRun;
  if (!run || run.outcome !== 'Died' || !S.capabilities.killmails || run.killmailChecking) {
    return false;
  }

  const status = document.getElementById('killmailStatus');
  const retryButton = document.getElementById('retryKillmailBtn');
  run.killmailChecking = true;
  status.textContent = 'Checking ESI for the Abyssal loss killmail…';
  status.className = 'alert';
  status.style.display = 'block';
  retryButton.style.display = 'none';
  try {
    const loss = await window.api.esi.getRecentAbyssLoss(
      run.character_id,
      run.started_at,
      run.started_at + run.duration
    );
    if (S.activeRun !== run || run.finalizing || run.suspended) return false;
    if (!loss) {
      status.textContent =
        'Killmail is not available yet. ESI may take up to five minutes; the current estimate is still shown.';
      status.className = 'alert warn';
      retryButton.textContent = 'Check Killmail';
      retryButton.style.display = 'inline-flex';
      return false;
    }

    const names = await window.api.esi.getTypeNames(loss.items.map(item => item.type_id));
    if (S.activeRun !== run || run.finalizing || run.suspended) return false;
    run.killmailItems = loss.items.map(item => ({
      type_id: item.type_id,
      type_name: names[item.type_id] || `Type ${item.type_id}`,
      qty: item.quantity,
    }));
    run.killmailIds = loss.killmail_ids;
    run.fitting = [];
    run.implants = [];
    run.fitCaptured = false;
    status.textContent =
      `Verified against ${loss.killmail_ids.length} Abyssal loss killmail${loss.killmail_ids.length === 1 ? '' : 's'}.`;
    status.className = 'alert success';
    retryButton.textContent = 'Refresh Killmail';
    retryButton.style.display = 'inline-flex';
    await persistActiveRun();
    if (reappraise) await appraiseLoss();
    return true;
  } catch (error) {
    if (S.activeRun !== run || run.finalizing || run.suspended) return false;
    status.textContent = `Killmail check failed: ${error.message}`;
    status.className = 'alert warn';
    retryButton.textContent = 'Retry Killmail';
    retryButton.style.display = 'inline-flex';
    return false;
  } finally {
    run.killmailChecking = false;
  }
}

async function retryKillmailLoss() {
  await reconcileKillmailLoss({ reappraise: true });
}

async function appraiseRun() {
  const run = S.activeRun;
  if (!run) return;
  if (!S.hasJaniceKey) {
    document.getElementById('appraise-error').innerHTML = '<div class="alert err">Janice API key not set. Go to Settings to add it.</div>';
    document.getElementById('appraise-error').style.display = 'block';
    return;
  }
  const generation = runSessionController.beginAppraisal(run);
  if (!isCurrentRunAppraisal(run, generation)) return;
  document.getElementById('appraise-error').style.display = 'none';
  document.getElementById('appraiseSpinner').style.display = 'inline-block';

  // Always re-read all paste boxes at appraise time so edits are picked up
  run.cargoBefore = document.getElementById('cargoBeforeText').value;
  run.droneBefore = document.getElementById('droneBeforeText').value;
  const cargoAfter = document.getElementById('cargoAfterText').value;
  const droneAfter = document.getElementById('droneAfterText').value;
  run.cargoAfter = cargoAfter;
  run.droneAfter = droneAfter;

  try {
    await persistActiveRun();
    if (!isCurrentRunAppraisal(run, generation)) return;
    const appraisal = await appraisalHelpers.appraiseSurvivedInventory({
      cargoBefore: run.cargoBefore,
      cargoAfter,
      droneBefore: run.droneBefore || '',
      droneAfter,
      appraise: async (items, pricing) => {
        const result = await window.api.janice.appraise(items, pricing);
        if (!isCurrentRunAppraisal(run, generation)) {
          throw new Error('Appraisal was superseded');
        }
        return result;
      },
    });
    if (!isCurrentRunAppraisal(run, generation)) return;

    run.diff = appraisal.diff;
    run.lootResult = appraisal.lootResult;
    run.consumedResult = appraisal.consumedResult;
    run.loot_value = appraisal.loot_value;
    run.consumed_cost = appraisal.consumed_cost;
    run.net_isk = appraisal.net_isk;
    run.items = appraisal.items;
    run.appraised_at = Math.floor(Date.now() / 1000);

    renderAppraisalResults(
      appraisal.lootResult,
      appraisal.consumedResult,
      appraisal.diff
    );
    setRunState('appraisal');
    void persistActiveRun().catch(reportActiveRunCheckpointError);
  } catch (e) {
    if (isCurrentRunAppraisal(run, generation)) {
      document.getElementById('appraise-error').innerHTML = `<div class="alert err">Appraisal failed: ${esc(e.message)} <button class="btn sm red" data-action="appraise-run">Retry</button></div>`;
      document.getElementById('appraise-error').style.display = 'block';
    }
  } finally {
    if (runSessionController.isLatestAppraisal(generation)) {
      document.getElementById('appraiseSpinner').style.display = 'none';
    }
  }
}

async function appraiseLoss() {
  const run = S.activeRun;
  if (!run) return;
  const generation = runSessionController.beginAppraisal(run);
  if (!isCurrentRunAppraisal(run, generation)) return;
  const cargoItems = parseCargo(run.cargoBefore);
  const droneItems = parseCargo(run.droneBefore || '');
  const manuallyTrackedInventory = mergeDiffItems(cargoItems, droneItems);
  const fittingItems = droneItems.length > 0
    ? run.fitting.filter(item => item.slot !== 'DroneBay')
    : run.fitting;

  try {
    const results = { killmail: null, cargo: null, fitting: null, implants: null };

    if (run.killmailItems?.length > 0) {
      if (S.hasJaniceKey) {
        results.killmail = await window.api.janice.appraise(
          run.killmailItems.map(item => ({
            name: item.type_name,
            qty: item.qty,
          })),
          'sell'
        );
        if (!isCurrentRunAppraisal(run, generation)) return;
      }
    } else {
      if (manuallyTrackedInventory.length > 0 && S.hasJaniceKey) {
        results.cargo = await window.api.janice.appraise(manuallyTrackedInventory, 'sell');
        if (!isCurrentRunAppraisal(run, generation)) return;
      }
      if (fittingItems.length > 0 && S.hasJaniceKey) {
        results.fitting = await window.api.janice.appraise(
          fittingItems.map(f => ({ name: f.type_name, qty: f.qty })), 'sell'
        );
        if (!isCurrentRunAppraisal(run, generation)) return;
      }
      if (run.implants.length > 0 && S.hasJaniceKey) {
        results.implants = await window.api.janice.appraise(
          run.implants.map(i => ({ name: i.type_name, qty: 1 })), 'sell'
        );
        if (!isCurrentRunAppraisal(run, generation)) return;
      }
    }

    if (!isCurrentRunAppraisal(run, generation)) return;
    const killmailLoss = results.killmail ? results.killmail.totalSellPrice : 0;
    const cargoLoss = results.cargo ? results.cargo.totalSellPrice : 0;
    const fittingLoss = results.fitting ? results.fitting.totalSellPrice : 0;
    const implantLoss = results.implants ? results.implants.totalSellPrice : 0;
    run.total_loss = killmailLoss + cargoLoss + fittingLoss + implantLoss;
    run.lossResults = results;
    run.items = run.killmailItems?.length > 0
      ? appraisalHelpers.toCompleteRunItems(
          run.killmailItems.map(item => ({ name: item.type_name, qty: item.qty })),
          results.killmail,
          'lost'
        )
      : [
          ...appraisalHelpers.toCompleteRunItems(manuallyTrackedInventory, results.cargo, 'lost'),
          ...appraisalHelpers.toCompleteRunItems(
            fittingItems.map(item => ({ name: item.type_name, qty: item.qty })),
            results.fitting,
            'lost'
          ),
          ...appraisalHelpers.toCompleteRunItems(
            run.implants.map(item => ({ name: item.type_name, qty: 1 })),
            results.implants,
            'lost'
          ),
        ];
    run.appraised_at = Object.values(results).some(Boolean)
      ? Math.floor(Date.now() / 1000)
      : null;

    renderLossResults(results, cargoLoss, fittingLoss, implantLoss, killmailLoss);
  } catch (e) {
    if (isCurrentRunAppraisal(run, generation)) {
      document.getElementById('loss-loading').textContent = 'Appraisal failed: ' + e.message;
      document.getElementById('loss-actions').style.display = 'flex';
    }
  }
}

function renderAppraisalResults(lootResult, consumedResult, diff) {
  const el = document.getElementById('appraisal-results');
  let html = '';

  if (lootResult && lootResult.items.length > 0) {
    html += `<div class="appraisal-section">
      <div class="appraisal-header">Loot Gained</div>
      <table class="item-table">
        <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Buy</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>`;
    for (const item of lootResult.items) {
      const p = item.effectivePrices;
      const isZero = p.buyPrice === 0;
      html += `<tr>
        <td class="name">${esc(item.itemType.name)}</td>
        <td class="qty">${item.amount.toLocaleString()}</td>
        <td class="price ${isZero ? 'zero' : 'gained'}">${isZero ? 'no orders' : fmtIsk(p.buyPrice)}</td>
        <td class="price ${isZero ? 'zero' : 'gained'}">${isZero ? '<span style=\'font-size:10px\'>no market orders</span>' : fmtIsk(p.buyPriceTotal)}</td>
      </tr>`;
    }
    html += `</tbody><tfoot><tr><td colspan="3" style="color:var(--text-dim)">Total Loot (instant sell)</td><td class="price gained">${fmtIsk(lootResult.totalBuyPrice)}</td></tr></tfoot></table>`;
    if (lootResult.unresolved && lootResult.unresolved.length > 0) {
      html += `<div class="alert warn" style="margin-top:6px">⚠ Janice could not price these items (no market orders or unrecognised): ${lootResult.unresolved.map(esc).join(', ')}</div>`;
    }
    html += `</div>`;
  } else if (diff.gained.length === 0) {
    html += `<div class="alert" style="margin-bottom:10px">No loot gained detected in cargo diff.</div>`;
  }

  if (consumedResult && consumedResult.items.length > 0) {
    html += `<div class="appraisal-section">
      <div class="appraisal-header">Items Consumed / Used</div>
      <table class="item-table">
        <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Sell</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>`;
    for (const item of consumedResult.items) {
      const p = item.effectivePrices;
      const isZero = p.sellPrice === 0;
      html += `<tr>
        <td class="name">${esc(item.itemType.name)}</td>
        <td class="qty">${item.amount.toLocaleString()}</td>
        <td class="price ${isZero ? 'zero' : 'consumed'}">${isZero ? 'no orders' : fmtIsk(p.sellPrice)}</td>
        <td class="price ${isZero ? 'zero' : 'consumed'}">${isZero ? '—' : fmtIsk(p.sellPriceTotal)}</td>
      </tr>`;
    }
    html += `</tbody><tfoot><tr><td colspan="3" style="color:var(--text-dim)">Total Cost (replacement)</td><td class="price consumed">−${fmtIsk(consumedResult.totalSellPrice)}</td></tr></tfoot></table>
    </div>`;
  }

  const net = S.activeRun.net_isk;
  html += `<div class="net-isk-row">
    <div><div class="net-isk-label">Net ISK This Run</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(S.activeRun.tier)} ${esc(S.activeRun.weather)} · ${fmtDuration(S.activeRun.duration)}</div></div>
    <div class="net-isk-value ${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${fmtIsk(net)}</div>
  </div>`;

  el.innerHTML = html;
}

function renderLossResults(results, cargoLoss, fittingLoss, implantLoss, killmailLoss = 0) {
  document.getElementById('loss-loading').style.display = 'none';
  const el = document.getElementById('loss-results');

  let html = '';
  const sections = [
    { label: 'Verified Killmail Loss', result: results.killmail, total: killmailLoss, priceField: 'sellPrice', totalField: 'sellPriceTotal', grandTotal: 'totalSellPrice' },
    { label: 'Cargo & Drones Lost', result: results.cargo, total: cargoLoss, priceField: 'sellPrice', totalField: 'sellPriceTotal', grandTotal: 'totalSellPrice' },
    { label: 'Fitting Lost', result: results.fitting, total: fittingLoss, priceField: 'sellPrice', totalField: 'sellPriceTotal', grandTotal: 'totalSellPrice' },
    { label: 'Implants Lost', result: results.implants, total: implantLoss, priceField: 'sellPrice', totalField: 'sellPriceTotal', grandTotal: 'totalSellPrice' },
  ];

  for (const s of sections) {
    if (!s.result || s.result.items.length === 0) continue;
    html += `<div class="appraisal-section">
      <div class="appraisal-header">${s.label}</div>
      <table class="item-table"><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Sell</th><th style="text-align:right">Total</th></tr></thead><tbody>`;
    for (const item of s.result.items) {
      const p = item.effectivePrices;
      const isZero = p[s.priceField] === 0;
      html += `<tr>
        <td class="name">${esc(item.itemType.name)}</td>
        <td class="qty">${item.amount.toLocaleString()}</td>
        <td class="price ${isZero ? 'zero' : 'consumed'}">${isZero ? 'no orders' : fmtIsk(p[s.priceField])}</td>
        <td class="price ${isZero ? 'zero' : 'consumed'}">${isZero ? '—' : fmtIsk(p[s.totalField])}</td>
      </tr>`;
    }
    html += `</tbody><tfoot><tr><td colspan="3" style="color:var(--text-dim)">Subtotal</td><td class="price consumed">−${fmtIsk(s.result[s.grandTotal])}</td></tr></tfoot></table></div>`;
  }

  const total = killmailLoss + cargoLoss + fittingLoss + implantLoss;
  html += `<div class="net-isk-row">
    <div><div class="net-isk-label">Total Loss</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(S.activeRun.tier)} ${esc(S.activeRun.weather)} · ${fmtDuration(S.activeRun.duration)}</div></div>
    <div class="net-isk-value negative">−${fmtIsk(total)}</div>
  </div>`;

  el.innerHTML = html;
  el.style.display = 'block';
  document.getElementById('loss-actions').style.display = 'flex';
}

async function saveCurrentRun() {
  if (!S.activeRun || S.activeRun.finalizing) return;

  const run = S.activeRun;
  if (!runSessionController.beginFinalization(run)) return;
  syncActiveRunInputs();
  try {
    await persistActiveRun();
  } catch (error) {
    runSessionController.rollbackFinalization(run);
    throw error;
  }
  const items = run.items || [];

  // Build fitting items with pricing
  const fitting = run.fitting.map(f => ({
    ...f,
    unit_price_sell: run.lossResults?.fitting?.items?.find(i => i.itemType.name === f.type_name)?.effectivePrices?.sellPrice || 0
  }));
  const implants = run.implants.map(imp => ({
    ...imp,
    unit_price_sell: run.lossResults?.implants?.items?.find(i => i.itemType.name === imp.type_name)?.effectivePrices?.sellPrice || 0
  }));

  const runData = {
    character_id: run.character_id,
    encounter_uid: run.encounter_uid,
    started_at: run.started_at,
    duration: run.duration || 0,
    tier: run.tier,
    weather: run.weather,
    outcome: run.outcome,
    loot_value: run.loot_value || 0,
    consumed_cost: run.consumed_cost || 0,
    net_isk: run.net_isk || 0,
    total_loss: run.total_loss || 0,
    system_id: run.system_id ?? lastSystemId,
    system_name: run.system_name || lastSystemName,
    notes: run.notes || '',
    tags: run.tags || [],
    killmail_ids: run.killmailIds || [],
    appraised_at: run.appraised_at || null,
    cargo_before: run.cargoBefore || '',
    cargo_after: run.cargoAfter || '',
    drone_before: run.droneBefore || '',
    drone_after: run.droneAfter || '',
    hull_name: run.hull_name || '',
    ship_class: run.ship_class || 'Unknown',
    items,
    fitting,
    implants
  };

  let completedRunId;
  try {
    completedRunId = await window.api.runs.completeActive(runData);
  } catch (error) {
    run.finalizing = false;
    throw error;
  }

  // Promote post-run cargo and drone bay to pre-run for next run
  if (run.outcome === 'Survived') {
    inventoryBaselineRunId = completedRunId;
    setInventoryText('cargoBeforeText', run.cargoAfter);
    // If post-run drone bay was pasted use it, otherwise carry pre-run forward unchanged
    const nextDroneBefore = (run.droneAfter && run.droneAfter.trim())
      ? run.droneAfter
      : run.droneBefore || '';
    setInventoryText('droneBeforeText', nextDroneBefore);
    updatePasteHint('droneBeforeText', 'preDroneHint');
    if (nextDroneBefore.trim()) {
      setCollapsibleState('preDroneBody', 'preDroneArrow', true);
    }
  } else {
    inventoryBaselineRunId = null;
    setInventoryText('cargoBeforeText', '');
    setInventoryText('droneBeforeText', '');
  }

  S.activeRun = null;
  resetRunUI();
  await concurrentTrackingController.refreshCharacter(run.character_id);
  if (run.outcome === 'Survived') {
    clearFilamentInference();
    if (
      document.getElementById('cargoBeforeText').value.trim()
      || document.getElementById('droneBeforeText').value.trim()
    ) {
      showInventoryBaselineStatus(run.started_at);
    }
  } else {
    hideInventoryBaselineStatus();
  }
  await persistTrackingDraft();
  await runUiTask('Run saved, but Tracker summaries could not be refreshed', () => (
    trackerViewController.refresh()
  ));
}

async function saveCurrentRunSafely() {
  try {
    await saveCurrentRun();
  } catch (error) {
    const target = S.runState === 'died'
      ? document.getElementById('loss-loading')
      : document.getElementById('appraise-error');
    const message = `Run could not be saved: ${error.message}`;
    if (S.runState === 'died') {
      target.textContent = message;
    } else {
      target.innerHTML = `<div class="alert err">${esc(message)}</div>`;
    }
    target.style.display = 'block';
  }
}


async function initAboutPage() {
  const version = await window.api.app.getVersion();
  document.getElementById('aboutVersion').textContent = `Version ${version}`;
}

async function checkForUpdates() {
  const btn = document.getElementById('updateBtn');
  const status = document.getElementById('updateStatus');
  btn.disabled = true;
  status.className = 'about-update-status';
  status.textContent = 'Checking for updates…';

  try {
    const result = await window.api.app.checkUpdate();
    if (!result.success) {
      status.classList.add('error');
      status.textContent = 'Could not check for updates. Please try again later.';
      return;
    }
    if (result.noRelease) {
      status.textContent = 'No published release is available yet.';
      return;
    }

    const current = await window.api.app.getVersion();
    const comparison = updateHelpers.compareSemver(result.version, current);

    if (comparison > 0) {
      status.classList.add('success');
      const message = document.createElement('span');
      message.textContent = `Version ${result.version} is available.`;
      const releaseLink = document.createElement('a');
      releaseLink.href = '#';
      releaseLink.className = 'about-release-link';
      releaseLink.dataset.action = 'open-external';
      releaseLink.dataset.url = result.releaseUrl;
      releaseLink.textContent = 'View Release';
      status.replaceChildren(message, releaseLink);
    } else if (comparison === 0) {
      status.classList.add('success');
      status.textContent = 'You are running the latest version.';
    } else {
      status.textContent = 'No newer published version is available.';
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent = 'Could not check for updates. Please try again later.';
    console.error('Update check failed:', error);
  } finally {
    btn.disabled = false;
  }
}

function setCollapsibleState(bodyId, arrowId, isOpen) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  body.classList.toggle('open', isOpen);
  arrow.classList.toggle('open', isOpen);
  const trigger = document.querySelector(`[data-action="toggle-collapsible"][aria-controls="${bodyId}"]`);
  if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
}

function toggleCollapsible(bodyId, arrowId) {
  const body = document.getElementById(bodyId);
  setCollapsibleState(bodyId, arrowId, !body.classList.contains('open'));
}

function updatePasteHint(textareaId, hintId) {
  const val = document.getElementById(textareaId).value.trim();
  const hint = document.getElementById(hintId);
  if (!hint) return;
  if (!val) { hint.textContent = ''; return; }
  const lines = val.split(/\n/).filter(l => l.trim()).length;
  hint.textContent = `${lines} item${lines !== 1 ? 's' : ''} pasted`;
}

async function refreshSavedRunViews() {
  const tasks = [
    runUiTask('Could not refresh run history', () => renderHistory()),
    runUiTask('Could not refresh Tracker summaries', () => trackerViewController.refresh()),
  ];
  if (document.getElementById('page-stats').classList.contains('active')) {
    tasks.push(runUiTask('Could not refresh Statistics', () => renderStats()));
  }
  await Promise.all(tasks);
}


async function cancelRun() {
  if (!S.activeRun || S.activeRun.finalizing) return;
  const run = S.activeRun;
  if (!runSessionController.beginFinalization(run)) return;
  try {
    await clearPersistedActiveRun(run.character_id);
  } catch (error) {
    runSessionController.rollbackFinalization(run);
    throw error;
  }
  if (S.activeRun === run) S.activeRun = null;
  resetRunUI();
  await concurrentTrackingController.refreshCharacter(run.character_id);
}

function backToAppraise() {
  // Re-snapshot pre-run cargo in case user edited it before re-appraising
  if (S.activeRun) {
    S.activeRun.cargoBefore = document.getElementById('cargoBeforeText').value;
    S.activeRun.droneBefore = document.getElementById('droneBeforeText').value;
  }
  setInventoryText('cargoAfterText', S.activeRun ? S.activeRun.cargoAfter : '');
  setInventoryText('droneAfterText', S.activeRun ? (S.activeRun.droneAfter || '') : '');
  setRunState('awaiting-cargo');
  void persistActiveRun().catch(reportActiveRunCheckpointError);
}

function resetRunUI() {
  stopTimer();
  document.getElementById('timerDisplay').textContent = '00:00:00';
  document.getElementById('timerDisplay').className = 'timer';
  document.getElementById('hudRunState').textContent = 'Awaiting';
  document.getElementById('infoTier').textContent = '—';
  document.getElementById('infoWeather').textContent = '—';
  document.getElementById('infoStarted').textContent = '—';
  document.getElementById('infoOutcome').textContent = '—';
  document.getElementById('activeRunNotes').value = '';
  document.getElementById('activeRunTags').value = '';
  setInventoryText('cargoAfterText', '');
  setInventoryText('droneAfterText', '');
  document.getElementById('fitCaptured').style.display = 'none';
  document.getElementById('appraise-error').style.display = 'none';
  document.getElementById('recoveryStatus').style.display = 'none';
  document.getElementById('killmailStatus').style.display = 'none';
  document.getElementById('retryKillmailBtn').style.display = 'none';
  document.getElementById('loadoutApplyStatus').hidden = true;
  setRunState('awaiting');
}

function setRunState(state) {
  S.runState = state;
  const states = ['awaiting', 'in-abyss', 'awaiting-cargo', 'died', 'appraisal'];
  for (const s of states) {
    const el = document.getElementById('state-' + s);
    if (el) el.style.display = s === state ? 'block' : 'none';
  }
  trackerViewController.setState(state);
  if (state === 'in-abyss') {
    setCollapsibleState('preCargoBody', 'preCargoArrow', false);
    setCollapsibleState('preDroneBody', 'preDroneArrow', false);
  }
  // Reset died sub-state
  if (state === 'died') {
    document.getElementById('loss-loading').style.display = 'block';
    document.getElementById('loss-results').style.display = 'none';
    document.getElementById('loss-actions').style.display = 'none';
  }
  updateLoadoutControls();
  renderCharacterTrackingStatus();
  renderActiveEncounterStatus();
}

function updateRunInfo() {
  if (!S.activeRun) return;
  document.getElementById('infoTier').textContent = S.activeRun.tier;
  document.getElementById('infoWeather').textContent = S.activeRun.weather;
  const d = new Date(S.activeRun.started_at * 1000);
  document.getElementById('infoStarted').textContent = d.toLocaleTimeString();
}

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  S.timerInterval = setInterval(() => {
    if (!S.activeRun) return;
    const elapsed = Math.floor(Date.now() / 1000) - S.activeRun.started_at;
    document.getElementById('timerDisplay').textContent = fmtDuration(elapsed);
    trackerViewController.renderSession();
  }, 500);
}

function stopTimer() {
  if (S.timerInterval) { clearInterval(S.timerInterval); S.timerInterval = null; }
}

// ── Cargo Parsing & Diffing ───────────────────────────────────────────────
let lastFilamentInferenceKey = null;

function clearFilamentInference() {
  lastFilamentInferenceKey = null;
  const status = document.getElementById('filamentInferenceStatus');
  status.textContent = '';
  status.style.display = 'none';
}

function updateFilamentInference() {
  const inference = runTracking.inferAbyssalFilament(
    parseCargo(document.getElementById('cargoBeforeText').value)
  );
  const status = document.getElementById('filamentInferenceStatus');
  if (!inference) {
    clearFilamentInference();
    return;
  }
  if (inference.ambiguous) {
    lastFilamentInferenceKey = null;
    status.textContent =
      'Multiple Abyssal filament types were found. Select the tier and weather for this run.';
    status.style.color = 'var(--gold)';
    status.style.display = 'block';
    return;
  }

  const inferenceKey = `${inference.tier}:${inference.weather}`;
  if (lastFilamentInferenceKey !== inferenceKey) {
    document.getElementById('tierSelect').value = inference.tier;
    document.getElementById('weatherSelect').value = inference.weather;
    lastFilamentInferenceKey = inferenceKey;
  }
  status.textContent =
    `Detected ${inference.tier} ${inference.weather} from ${inference.name}. You can change it manually.`;
  status.style.color = 'var(--cyan)';
  status.style.display = 'block';
}

function setInventoryText(id, value, options = {}) {
  return inventoryEditors.setValue(id, value, options);
}

function parseCargo(raw) {
  return runTracking.parseInventoryPaste(raw || '');
}

function mergeDiffItems(a, b) {
  return runTracking.mergeInventoryItems(a, b);
}

function diffCargo(beforeRaw, afterRaw) {
  return runTracking.diffInventoryPastes(beforeRaw || '', afterRaw || '');
}

function diffOptionalDroneBay(beforeRaw, afterRaw) {
  return runTracking.diffOptionalInventoryPastes(beforeRaw || '', afterRaw || '');
}

// ── History ───────────────────────────────────────────────────────────────
const historyView = historyViewHelpers.createHistoryView({
  document,
  api: window.api,
  getActiveCharacterId: () => S.activeCharId,
  formatIsk: fmtIsk,
  formatDuration: fmtDuration,
  escapeHtml: esc,
});
let historySearchTimer = null;

function renderHistory() {
  return historyView.render();
}

function sortHistory(column) {
  return historyView.sort(column);
}

function clearHistoryFilters() {
  return historyView.clearFilters();
}

function exportHistoryCSV() {
  return historyView.exportCsv();
}

function scheduleHistorySearch() {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    void runUiTask('Could not search run history', () => renderHistory());
  }, 250);
}
// ── Stats ─────────────────────────────────────────────────────────────────
const statisticsReportController = statisticsReportControllerHelpers
  .createStatisticsReportController({
    document,
    api: window.api,
    reporting: statisticsReport,
    getActiveCharacterId: () => S.activeCharId,
    formatIsk: fmtIsk,
    formatDuration: fmtDuration,
    escapeHtml: esc,
    onDrillThrough: selection => {
      historyView.applyDrillThrough(selection);
      return showPage('history');
    },
  });
const statsView = statsViewHelpers.createStatsView({
  document,
  api: window.api,
  statistics,
  getActiveCharacterId: () => S.activeCharId,
  formatIsk: fmtIsk,
  formatDuration: fmtDuration,
  escapeHtml: esc,
  reportController: statisticsReportController,
});

function handleStatsRangeChange() {
  return statsView.handleRangeChange();
}

function renderStats() {
  return statsView.render();
}

// ── Utilities ─────────────────────────────────────────────────────────────
function esc(str) {
  return window.AbyssSecurity.escapeHtml(str);
}

function openExternal(url) {
  return window.api.shell.openExternal(url);
}

const modalController = modalHelpers.createModalController({
  document,
  onRequestClose: (id, close) => {
    if (id === 'manualEntryModal') return closeManualEntryModal();
    if (id === 'manualEncounterModal') return closeManualEncounterModal();
    if (id === 'shipSetupModal') return closeShipSetupModal();
    return close(id);
  },
  onDidClose: id => {
    if (id === 'runDetailModal') runDetailsController.clearPendingReappraisal();
    if (id === 'preRunReviewModal') trackerViewController.restorePreRunFields();
  },
});

function openModal(id) {
  return modalController.open(id);
}

function closeModal(id) {
  return modalController.close(id);
}

function requestCloseModal(id) {
  return modalController.requestClose(id);
}
const fitNameController = fitNameHelpers.createFitNameController({
  document,
  api: window.api,
  openModal,
  closeModal,
  onSaved: async (_result, context) => {
    await Promise.all([renderStats(), renderHistory()]);
    if (context?.runId) await showRunDetail(context.runId);
  },
});


// Overlay clicks, Escape, and focus trapping are installed by modalController.

const clickActions = {
  'dismiss-global-error': () => dismissGlobalError(),
  'confirm-encounter-group': () => confirmEncounterGroup(),
  'dismiss-encounter-group': () => dismissEncounterGroup(),
  'show-page': element => showPage(element.dataset.page),
  'switch-manual-entry-mode': element => switchManualEntryMode(element.dataset.manualMode),
  'close-manual-encounter': () => closeManualEncounterModal(),
  'add-manual-encounter-participant': () => addManualEncounterParticipant(),
  'remove-manual-encounter-participant': element => (
    removeManualEncounterParticipant(element.dataset.participantIndex)
  ),
  'submit-manual-encounter': () => submitManualEncounter(),
  'toggle-collapsible': element =>
    toggleCollapsible(element.dataset.body, element.dataset.arrow),
  'manual-start': () => manualStart(),
  'open-manual-entry': () => openManualEntryModal(),
  'manual-end-survived': () => manualEndSurvived(),
  'manual-end-died': () => manualEndDied(),
  'appraise-run': () => appraiseRun(),
  'cancel-run': () => cancelRun(),
  'save-current-run': () => saveCurrentRunSafely(),
  'retry-killmail': () => retryKillmailLoss(),
  'back-to-appraise': () => backToAppraise(),
  'render-history': () => renderHistory(),
  'clear-history-filters': () => clearHistoryFilters(),
  'history-export-csv': () => exportHistoryCSV(),
  'open-add-character': () => openAddCharModal(),
  'toggle-janice-key': element => toggleJaniceKey(element),
  'test-janice-key': () => testJaniceKey(),
  'remove-janice-key': () => removeJaniceKey(),
  'open-external': element => openExternal(element.dataset.url),
  'check-for-updates': () => checkForUpdates(),
  'save-settings': () => saveSettings(),
  'import-csv': () => importCSV(),
  'create-full-backup': () => createFullBackup(),
  'restore-full-backup': () => restoreFullBackup(),
  'open-backup-folder': () => openBackupFolder(),
  'open-diagnostics-folder': () => openDiagnosticsFolder(),
  'copy-diagnostics': () => copyDiagnostics(),
  'clear-inventory-baseline': () => clearInventoryBaseline(),
  'manage-loadouts': () => openLoadoutManager(),
  'apply-loadout': () => applyLoadoutPreset(),
  'new-loadout': () => startNewLoadoutPreset(),
  'save-loadout': () => saveLoadoutPreset(),
  'delete-loadout': () => deleteLoadoutPreset(),
  'close-modal': element => closeModal(element.dataset.modal),
  'start-sso': () => startSSO(),
  'close-manual-entry': () => closeManualEntryModal(),
  'submit-manual-entry': element => submitManualEntry(element.dataset.appraise === 'true'),
  'sort-history': element => sortHistory(element.dataset.sortColumn),
  'run-statistics-report': () => statisticsReportController.run(),
  'reset-statistics-report': () => statisticsReportController.reset(),
  'stats-report-sort': element => statisticsReportController.sort(element),
  'stats-report-drill-through': element => statisticsReportController.openHistory(element),
  'review-pre-run': () => trackerViewController.openPreRunReview(),
  'show-run-detail': element => showRunDetail(Number(element.dataset.runId)),
  'show-ship-setup': element => showShipSetup(
    Number(element.dataset.runId),
    element.dataset.returnModal === 'none' ? '' : 'runDetailModal'
  ),
  'edit-fit-name': element => fitNameController.open(element),
  'save-fit-name': () => fitNameController.save(),
  'clear-fit-name': () => fitNameController.clear(),
  'copy-run-fitting': element => copyRunFitting(Number(element.dataset.runId)),
  'close-ship-setup': () => closeShipSetupModal(),
  'reappraise-run': element => reappraiseRun(Number(element.dataset.runId)),
  'edit-run': element => openEditRunModal(Number(element.dataset.runId)),
  'delete-run': element => deleteRun(Number(element.dataset.runId)),
  'reauth-character': element => reauthCharacter(Number(element.dataset.characterId)),
  'save-reappraisal': element => saveHistoricalReappraisal(Number(element.dataset.runId)),
  'discard-reappraisal': element => discardHistoricalReappraisal(Number(element.dataset.runId)),
  'remove-character': element => removeCharacter(Number(element.dataset.characterId)),
};

const actionFailureContexts = Object.freeze({
  'show-page': 'Could not open the requested page',
  'manual-start': 'Could not start the run',
  'open-manual-entry': 'Could not open manual run entry',
  'switch-manual-entry-mode': 'Could not switch the manual entry type',
  'submit-manual-encounter': 'Could not save the manual group encounter',
  'manual-end-survived': 'Could not complete the run',
  'manual-end-died': 'Could not record the ship loss',
  'appraise-run': 'Could not appraise the run',
  'cancel-run': 'Could not cancel the run',
  'save-current-run': 'Could not save the run',
  'retry-killmail': 'Could not check for the killmail',
  'back-to-appraise': 'Could not return to the appraisal',
  'render-history': 'Could not refresh run history',
  'clear-history-filters': 'Could not clear run history filters',
  'history-export-csv': 'Could not export run history',
  'open-add-character': 'Could not open character sign-in',
  'test-janice-key': 'Could not test the Janice API key',
  'remove-janice-key': 'Could not remove the Janice API key',
  'open-external': 'Could not open the external link',
  'check-for-updates': 'Could not check for updates',
  'save-settings': 'Could not save settings',
  'import-csv': 'Could not import run history',
  'create-full-backup': 'Could not create a backup',
  'restore-full-backup': 'Could not restore a backup',
  'open-backup-folder': 'Could not open the backup folder',
  'open-diagnostics-folder': 'Could not open the diagnostics folder',
  'copy-diagnostics': 'Could not copy diagnostics',
  'clear-inventory-baseline': 'Could not clear the inventory baseline',
  'manage-loadouts': 'Could not open loadout presets',
  'apply-loadout': 'Could not apply the loadout preset',
  'new-loadout': 'Could not start a new loadout preset',
  'save-loadout': 'Could not save the loadout preset',
  'delete-loadout': 'Could not delete the loadout preset',
  'confirm-encounter-group': 'Could not group the character runs',
  'start-sso': 'Could not start EVE sign-in',
  'submit-manual-entry': 'Could not save the manual run',
  'sort-history': 'Could not sort run history',
  'run-statistics-report': 'Could not build the statistics report',
  'reset-statistics-report': 'Could not reset the statistics report',
  'stats-report-sort': 'Could not sort the statistics report',
  'stats-report-drill-through': 'Could not open filtered run history',
  'show-run-detail': 'Could not open the run details',
  'show-ship-setup': 'Could not open the captured ship setup',
  'copy-run-fitting': 'Could not copy the fitting',
  'edit-fit-name': 'Could not open fit name editor',
  'save-fit-name': 'Could not save fit name',
  'clear-fit-name': 'Could not clear fit name',
  'reappraise-run': 'Could not re-appraise the run',
  'edit-run': 'Could not edit the run',
  'delete-run': 'Could not delete the run',
  'reauth-character': 'Could not change character permissions',
  'save-reappraisal': 'Could not save the re-appraisal',
  'discard-reappraisal': 'Could not discard the re-appraisal',
  'remove-character': 'Could not remove the character',
});

document.addEventListener('click', event => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  const action = element.dataset.action;
  const handler = clickActions[action];
  if (!handler) return;
  event.preventDefault();
  const context = actionFailureContexts[action] || 'AbyssLog could not complete the action';
  void runUiTask(context, () => handler(element));
});

document.addEventListener('change', event => {
  const element = event.target;
  invalidateManualEditAppraisalPreview(element);
  invalidateHistoricalReappraisalPreview(element);
  if ([
    'permissionTracking',
    'permissionFitting',
    'permissionImplants',
    'permissionKillmails',
  ].includes(element.id)) {
    void runUiTask('Could not update the permission selection', () => updatePermissionSummary());
  } else if (element.dataset.changeAction === 'switch-character') {
    void runUiTask(
      'Could not switch characters',
      () => switchCharacter(element.value),
      () => { element.value = S.activeCharId || ''; }
    );
  } else if (element.dataset.changeAction === 'render-history') {
    void runUiTask('Could not refresh run history', () => renderHistory());
  } else if (element.dataset.changeAction === 'loadout-selection') {
    updateLoadoutControls();
    document.getElementById('loadoutApplyStatus').hidden = true;
  } else if (element.dataset.changeAction === 'loadout-editor-selection') {
    handleLoadoutEditorSelection();
  } else if (element.dataset.changeAction === 'stats-range') {
    void runUiTask('Could not change the Statistics date range', () => handleStatsRangeChange());
  } else if (element.dataset.changeAction === 'render-stats') {
    void runUiTask('Could not refresh Statistics', () => renderStats());
  } else if (element.dataset.changeAction === 'stats-report-preset') {
    void runUiTask('Could not apply the report preset', () => (
      statisticsReportController.handlePreset(element.value)
    ));
  } else if (element.dataset.changeAction === 'stats-report-mode') {
    void runUiTask('Could not change the report type', () => (
      statisticsReportController.handleMode(element.value)
    ));
  } else if (element.dataset.changeAction === 'stats-report-definition') {
    statisticsReportController.handleDefinitionChange(element);
  } else if (element.dataset.changeAction === 'manual-outcome') {
    void runUiTask('Could not update the manual run form', () => updateManualOutcomeUI());
  } else if (element.dataset.changeAction === 'manual-encounter-definition') {
    handleManualEncounterDefinitionChange(element);
  }
  if (['tierSelect', 'weatherSelect'].includes(element.id)) scheduleTrackingDraftSave();
});

document.addEventListener('input', event => {
  const element = event.target;
  if (element.dataset.inventoryFallback === 'unchanged') {
    delete element.dataset.inventoryFallback;
    element.labels?.[0]?.querySelector('.inventory-unchanged-badge')?.remove();
  }
  invalidateManualEditAppraisalPreview(element);
  invalidateHistoricalReappraisalPreview(element);
  if (element.dataset.inputAction === 'paste-hint') {
    updatePasteHint(element.id, element.dataset.hint);
  } else if (element.dataset.inputAction === 'history-search') {
    scheduleHistorySearch();
  }
  if ([
    'cargoBeforeText',
    'cargoAfterText',
    'droneBeforeText',
    'droneAfterText',
    'activeRunNotes',
    'activeRunTags',
  ].includes(element.id)) {
    if (S.activeRun) {
      syncActiveRunInputs();
      scheduleActiveRunCheckpoint();
    } else {
      scheduleTrackingDraftSave();
    }
  }
  if (['cargoBeforeText', 'droneBeforeText'].includes(element.id)) {
    document.getElementById('loadoutApplyStatus').hidden = true;
  }
  if (element.id === 'cargoBeforeText') {
    hideInventoryBaselineStatus();
    updateFilamentInference();
  } else if (element.id === 'droneBeforeText') {
    hideInventoryBaselineStatus();
  }
});

document.addEventListener('error', event => {
  const element = event.target;
  if (element instanceof HTMLElement && element.hasAttribute('data-hide-on-error')) {
    element.style.display = 'none';
  }
}, true);

window.addEventListener('unhandledrejection', event => {
  event.preventDefault();
  reportUiError(
    'An unexpected background operation failed',
    event.reason,
    'unhandled-rejection'
  );
});

window.addEventListener('error', event => {
  if (!event.error) return;
  event.preventDefault();
  reportUiError('An unexpected application error occurred', event.error, 'window-error');
});

// Start
void runUiTask('AbyssLog could not finish starting', () => init());
