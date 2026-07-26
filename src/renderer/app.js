// ── State ─────────────────────────────────────────────────────────────────
const runTracking = window.AbyssRunTracking;

const S = {
  characters: [],
  activeCharId: null,
  hasAuth: false,
  capabilities: { tracking: false, fitting: false, implants: false },
  characterCapabilities: {},
  hasJaniceKey: false,
  secureStorage: { available: false, backend: 'unknown' },
  dataStatus: null,
  settings: {},
  runState: 'awaiting', // awaiting | in-abyss | awaiting-cargo | appraising | appraisal | died | loss
  activeRun: null,
  timerInterval: null,
  pollTimeout: null,
  pollGeneration: 0,
  pollFailureCount: 0,
  sortCol: 'started_at',
  sortDir: 'desc',
};

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  window.api.auth.onComplete(handleAuthComplete);
  window.api.auth.onError(handleAuthError);

  [S.settings, S.characters, S.secureStorage, S.hasJaniceKey, S.dataStatus] = await Promise.all([
    window.api.settings.getAll(),
    window.api.auth.getCharacters(),
    window.api.secrets.status(),
    window.api.secrets.hasJaniceKey(),
    window.api.data.getStatus(),
  ]);
  await refreshCharacterCapabilities();

  loadSettingsPage();
  await populateCharSelect();

  const savedCharId = S.settings.active_character;
  if (savedCharId && S.characters.find(c => String(c.id) === String(savedCharId))) {
    await switchCharacter(savedCharId, false);
  } else if (S.characters.length > 0) {
    await switchCharacter(S.characters[0].id, false);
  } else {
    showNoCharPrompt();
  }

}

// ── Navigation ────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.textContent.toLowerCase().includes(name.toLowerCase())) b.classList.add('active');
  });
  if (name === 'history') renderHistory();
  if (name === 'stats') renderStats();
}

// ── Character Management ──────────────────────────────────────────────────
function normalizeCapabilities(value) {
  return {
    tracking: value?.tracking === true,
    fitting: value?.fitting === true,
    implants: value?.implants === true,
  };
}

async function refreshCharacterCapabilities() {
  const entries = await Promise.all(S.characters.map(async character => {
    try {
      const capabilities = await window.api.auth.getCapabilities(character.id);
      return [character.id, normalizeCapabilities(capabilities)];
    } catch {
      return [character.id, normalizeCapabilities(null)];
    }
  }));
  S.characterCapabilities = Object.fromEntries(entries);
}

async function populateCharSelect() {
  const sel = document.getElementById('charSelect');
  sel.innerHTML = '<option value="">No character</option>';
  for (const c of S.characters) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  if (S.activeCharId) sel.value = S.activeCharId;
}

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
  stopESIPoll();
  if (S.activeRun) {
    const run = S.activeRun;
    run.suspended = true;
    syncActiveRunInputs();
    try {
      await persistActiveRun();
    } catch (error) {
      run.suspended = false;
      if (S.capabilities.tracking) startESIPoll();
      throw error;
    }
  }
  S.activeRun = null;
  resetRunUI();
  clearTrackerInputs();
  lastShipTypeId = null;
  lastSystemId = null;

  const normalizedCharacterId = charId ? Number(charId) : null;
  S.activeCharId = normalizedCharacterId;
  document.getElementById('charSelect').value = normalizedCharacterId || '';

  if (!normalizedCharacterId) {
    S.hasAuth = false;
    S.capabilities = normalizeCapabilities(null);
    showNoCharPrompt();
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
  updateRecentRuns();
  const restored = await restoreActiveRun(normalizedCharacterId);
  resetTransitionTracker(restored?.state === 'in-abyss' ? 'inside' : 'outside');

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
}

function showNoCharPrompt() {
  document.getElementById('no-char-prompt').style.display = 'block';
  document.getElementById('tracker-ui').style.display = 'none';
}

function loadDefaultSelects() {
  if (S.settings.default_tier) document.getElementById('tierSelect').value = S.settings.default_tier;
  if (S.settings.default_weather) document.getElementById('weatherSelect').value = S.settings.default_weather;
}

// ── SSO Auth ──────────────────────────────────────────────────────────────
async function startSSO() {
  try {
    document.getElementById('ssoStatus').textContent = 'Browser opened — waiting for authorisation...';
    document.getElementById('ssoSpinner').style.display = 'inline-block';
    await window.api.auth.startSso(getSelectedCapabilities());
  } catch (error) {
    document.getElementById('ssoStatus').textContent = 'Error: ' + error.message;
    document.getElementById('ssoSpinner').style.display = 'none';
  }
}

async function handleAuthComplete(character) {
  S.characters = await window.api.auth.getCharacters();
  await refreshCharacterCapabilities();
  await populateCharSelect();
  await switchCharacter(character.id);
  document.getElementById('ssoStatus').textContent = `✓ Logged in as ${character.name}`;
  document.getElementById('ssoSpinner').style.display = 'none';
  setTimeout(() => closeModal('addCharModal'), 1500);
  renderCharList();
}

function handleAuthError(message) {
  document.getElementById('ssoStatus').textContent = 'Error: ' + message;
  document.getElementById('ssoSpinner').style.display = 'none';
}

// ── ESI Polling ───────────────────────────────────────────────────────────
const ABYSSAL_MIN = 32000000;
const CAPSULE_IDS = [670, 33328];
let lastShipTypeId = null;
let lastSystemId = null;
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
    const inAbyss = sysId >= ABYSSAL_MIN;
    const isCapsule = CAPSULE_IDS.includes(shipTypeId);

    // Update HUD
    if (inAbyss) {
      document.getElementById('hudLocationVal').textContent = `Abyssal #${sysId}`;
      document.getElementById('hudLocation').classList.add('active');
    } else {
      document.getElementById('hudLocation').classList.remove('active');
      if (sysId !== lastSystemId) {
        window.api.esi.getSystemName(sysId).then(name => {
          if (isCurrentPoll(generation, characterId) && lastSystemId === sysId) {
            document.getElementById('hudLocationVal').textContent = name;
          }
        }).catch(() => {});
      }
    }
    document.getElementById('hudShipVal').textContent = ship.ship_name || `Ship ${shipTypeId}`;
    document.getElementById('hudEsiVal').textContent = inAbyss ? '⚡ IN ABYSS' : 'Active';
    document.getElementById('hudEsiVal').title = '';
    document.getElementById('statusDot').className = inAbyss ? 'status-dot abyss' : 'status-dot online';

    lastSystemId = sysId;
    lastShipTypeId = shipTypeId;

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
    const authError = /authorization|token|\bHTTP (?:401|403)\b/i.test(e.message || '');
    document.getElementById('hudEsiVal').textContent = authError ? 'Auth Error' : 'Reconnecting…';
    document.getElementById('hudEsiVal').title = authError
      ? 'Go to Settings → Re-authenticate to fix this'
      : 'ESI is temporarily unavailable; AbyssLog will retry automatically';
    document.getElementById('statusDot').className = 'status-dot';
    return { success: false, authError };
  }
}

async function runESIPollLoop(generation, characterId, interval) {
  const result = await pollESI(generation, characterId);
  if (!isCurrentPoll(generation, characterId)) return;
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
// EVE ship group IDs by class (not exhaustive but covers all abyssal-legal hulls)
const FRIGATE_GROUPS  = new Set([25,324,831,1283,830,893,1527,237,834,893,543,1305,1534,1535]);
const DESTROYER_GROUPS = new Set([420,541,1305,1534,1535]);
const CRUISER_GROUPS  = new Set([26,906,833,358,963,894,832,540,209,27,900,1337]);

function classifyShipByGroup(groupId) {
  if (!groupId) return 'Unknown';
  if (FRIGATE_GROUPS.has(groupId))   return 'Frigate';
  if (DESTROYER_GROUPS.has(groupId)) return 'Destroyer';
  if (CRUISER_GROUPS.has(groupId))   return 'Cruiser';
  return 'Unknown';
}

async function classifyShip(typeId) {
  if (!typeId) return 'Unknown';
  try {
    const info = await window.api.esi.getTypeInfo(typeId);
    return classifyShipByGroup(info.group_id);
  } catch (e) {
    return 'Unknown';
  }
}

let activeCheckpointTimer = null;
let activeCheckpointChain = Promise.resolve();

function clearTrackerInputs() {
  for (const id of [
    'cargoBeforeText',
    'cargoAfterText',
    'droneBeforeText',
    'droneAfterText',
  ]) {
    document.getElementById(id).value = '';
  }
}

function syncActiveRunInputs() {
  if (!S.activeRun) return;
  S.activeRun.cargoBefore = document.getElementById('cargoBeforeText').value;
  S.activeRun.cargoAfter = document.getElementById('cargoAfterText').value;
  S.activeRun.droneBefore = document.getElementById('droneBeforeText').value;
  S.activeRun.droneAfter = document.getElementById('droneAfterText').value;
}

function activeRunSnapshot() {
  if (!S.activeRun) return null;
  const state = S.runState === 'died'
    ? 'died'
    : S.runState === 'in-abyss' ? 'in-abyss' : 'awaiting-cargo';
  const run = S.activeRun;
  return window.AbyssSecurity.validateActiveRunSnapshot({
    version: 1,
    state,
    run: {
      character_id: run.character_id,
      started_at: run.started_at,
      duration: run.duration || 0,
      tier: run.tier,
      weather: run.weather,
      outcome: state === 'in-abyss' ? null : state === 'died' ? 'Died' : 'Survived',
      system_id: run.system_id ?? lastSystemId,
      cargoBefore: run.cargoBefore || '',
      cargoAfter: run.cargoAfter || '',
      droneBefore: run.droneBefore || '',
      droneAfter: run.droneAfter || '',
      ship_name: run.ship_name || '',
      ship_class: run.ship_class || 'Unknown',
      fitting: run.fitting || [],
      implants: run.implants || [],
      fitCaptured: Boolean(run.fitCaptured),
    },
  });
}

function persistActiveRun() {
  const snapshot = activeRunSnapshot();
  if (!snapshot) return activeCheckpointChain;
  activeCheckpointChain = activeCheckpointChain
    .catch(() => {})
    .then(() => window.api.runs.saveActive(snapshot));
  return activeCheckpointChain;
}

function scheduleActiveRunCheckpoint() {
  if (!S.activeRun || S.activeRun.finalizing || S.activeRun.suspended) return;
  if (activeCheckpointTimer) clearTimeout(activeCheckpointTimer);
  activeCheckpointTimer = setTimeout(() => {
    activeCheckpointTimer = null;
    syncActiveRunInputs();
    void persistActiveRun().catch(error => {
      console.error('Failed to checkpoint active run:', error);
    });
  }, 250);
}

async function clearPersistedActiveRun(characterId) {
  if (activeCheckpointTimer) {
    clearTimeout(activeCheckpointTimer);
    activeCheckpointTimer = null;
  }
  activeCheckpointChain = activeCheckpointChain
    .catch(() => {})
    .then(() => window.api.runs.clearActive(characterId));
  await activeCheckpointChain;
}

async function restoreActiveRun(characterId) {
  const snapshot = await window.api.runs.getActive(characterId);
  if (!snapshot) return null;

  S.activeRun = snapshot.run;
  lastSystemId = snapshot.run.system_id;
  document.getElementById('cargoBeforeText').value = snapshot.run.cargoBefore;
  document.getElementById('cargoAfterText').value = snapshot.run.cargoAfter;
  document.getElementById('droneBeforeText').value = snapshot.run.droneBefore;
  document.getElementById('droneAfterText').value = snapshot.run.droneAfter;
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
    void appraiseLoss();
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
  const shipTypeId = lastShipTypeId;

  S.activeRun = {
    character_id: S.activeCharId,
    started_at: startedAt,
    duration: 0,
    tier: tier || 'Unknown',
    weather: weather || 'Unknown',
    ship_name: document.getElementById('hudShipVal').textContent || '',
    ship_class: 'Unknown',
    system_id: lastSystemId,
    cargoBefore,
    cargoAfter: '',
    droneBefore,
    droneAfter: '',
    outcome: null,
    fitting: [],
    implants: [],
    fitCaptured: false
  };

  document.getElementById('recoveryStatus').style.display = 'none';
  setRunState('in-abyss');
  startTimer();
  updateRunInfo();
  void persistActiveRun().catch(error => {
    console.error('Failed to checkpoint active run:', error);
  });
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
      run.ship_name = typeNames[fitData.ship_type_id] || run.ship_name;
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
    if (fitResult.status === 'rejected') {
      console.error('Failed to capture fitting:', fitResult.reason);
    }
    if (implantResult.status === 'rejected') {
      console.error('Failed to capture implants:', implantResult.reason);
    }
    if (S.activeRun === run && !run.finalizing && !run.suspended) await persistActiveRun();
  } catch (e) {
    console.error('Failed to capture fitting/implants:', e);
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
  void persistActiveRun().catch(error => {
    console.error('Failed to checkpoint completed run:', error);
  });
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
  await appraiseLoss();
}

async function appraiseRun() {
  if (!S.hasJaniceKey) {
    document.getElementById('appraise-error').innerHTML = '<div class="alert err">Janice API key not set. Go to Settings to add it.</div>';
    document.getElementById('appraise-error').style.display = 'block';
    return;
  }
  document.getElementById('appraise-error').style.display = 'none';
  document.getElementById('appraiseSpinner').style.display = 'inline-block';

  // Always re-read all paste boxes at appraise time so edits are picked up
  S.activeRun.cargoBefore = document.getElementById('cargoBeforeText').value;
  S.activeRun.droneBefore = document.getElementById('droneBeforeText').value;
  const cargoAfter = document.getElementById('cargoAfterText').value;
  const droneAfter = document.getElementById('droneAfterText').value;
  S.activeRun.cargoAfter = cargoAfter;
  S.activeRun.droneAfter = droneAfter;

  // Merge cargo and drone bay diffs
  const cargoDiff = diffCargo(S.activeRun.cargoBefore, cargoAfter);
  const droneDiff = diffCargo(S.activeRun.droneBefore || '', droneAfter);
  const diff = {
    gained: mergeDiffItems(cargoDiff.gained, droneDiff.gained),
    consumed: mergeDiffItems(cargoDiff.consumed, droneDiff.consumed)
  };

  try {
    await persistActiveRun();
    let lootResult = null, consumedResult = null;

    if (diff.gained.length > 0) {
      lootResult = await window.api.janice.appraise(diff.gained, 'buy');
    }
    if (diff.consumed.length > 0) {
      consumedResult = await window.api.janice.appraise(diff.consumed, 'sell');
    }

    S.activeRun.diff = diff;
    S.activeRun.lootResult = lootResult;
    S.activeRun.consumedResult = consumedResult;

    const lootVal = lootResult ? lootResult.totalBuyPrice : 0;
    const consumedCost = consumedResult ? consumedResult.totalSellPrice : 0;
    S.activeRun.loot_value = lootVal;
    S.activeRun.consumed_cost = consumedCost;
    S.activeRun.net_isk = lootVal - consumedCost;

    renderAppraisalResults(lootResult, consumedResult, diff);
    setRunState('appraisal');
    void persistActiveRun().catch(error => {
      console.error('Failed to checkpoint appraised run:', error);
    });
  } catch (e) {
    document.getElementById('appraise-error').innerHTML = `<div class="alert err">Appraisal failed: ${esc(e.message)} <button class="btn sm red" data-action="appraise-run">Retry</button></div>`;
    document.getElementById('appraise-error').style.display = 'block';
  }
  document.getElementById('appraiseSpinner').style.display = 'none';
}

async function appraiseLoss() {
  const cargoItems = parseCargo(S.activeRun.cargoBefore);

  try {
    const results = { cargo: null, fitting: null, implants: null };

    if (cargoItems.length > 0 && S.hasJaniceKey) {
      results.cargo = await window.api.janice.appraise(cargoItems, 'sell');
    }
    if (S.activeRun.fitting.length > 0 && S.hasJaniceKey) {
      results.fitting = await window.api.janice.appraise(
        S.activeRun.fitting.map(f => ({ name: f.type_name, qty: f.qty })), 'sell'
      );
    }
    if (S.activeRun.implants.length > 0 && S.hasJaniceKey) {
      results.implants = await window.api.janice.appraise(
        S.activeRun.implants.map(i => ({ name: i.type_name, qty: 1 })), 'sell'
      );
    }

    const cargoLoss = results.cargo ? results.cargo.totalSellPrice : 0;
    const fittingLoss = results.fitting ? results.fitting.totalSellPrice : 0;
    const implantLoss = results.implants ? results.implants.totalSellPrice : 0;
    S.activeRun.total_loss = cargoLoss + fittingLoss + implantLoss;
    S.activeRun.lossResults = results;

    renderLossResults(results, cargoLoss, fittingLoss, implantLoss);
  } catch (e) {
    document.getElementById('loss-loading').textContent = 'Appraisal failed: ' + e.message;
    document.getElementById('loss-actions').style.display = 'flex';
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

function renderLossResults(results, cargoLoss, fittingLoss, implantLoss) {
  document.getElementById('loss-loading').style.display = 'none';
  const el = document.getElementById('loss-results');

  let html = '';
  const sections = [
    { label: 'Cargo Lost', result: results.cargo, total: cargoLoss, priceField: 'sellPrice', totalField: 'sellPriceTotal', grandTotal: 'totalSellPrice' },
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

  const total = cargoLoss + fittingLoss + implantLoss;
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
  run.finalizing = true;
  if (activeCheckpointTimer) {
    clearTimeout(activeCheckpointTimer);
    activeCheckpointTimer = null;
  }
  syncActiveRunInputs();
  try {
    await persistActiveRun();
  } catch (error) {
    run.finalizing = false;
    throw error;
  }
  const items = [];

  if (run.outcome === 'Survived') {
    // Build items from appraisal results
    if (run.lootResult) {
      for (const item of run.lootResult.items) {
        const p = item.effectivePrices;
        items.push({ item_name: item.itemType.name, qty: item.amount, type: 'gained', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
      }
    }
    if (run.consumedResult) {
      for (const item of run.consumedResult.items) {
        const p = item.effectivePrices;
        items.push({ item_name: item.itemType.name, qty: item.amount, type: 'consumed', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
      }
    }
  } else {
    // Build loss items from loss results
    if (run.lossResults) {
      for (const [, result] of Object.entries(run.lossResults)) {
        if (!result) continue;
        for (const item of result.items) {
          const p = item.effectivePrices;
          items.push({ item_name: item.itemType.name, qty: item.amount, type: 'lost', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
        }
      }
    }
  }

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
    started_at: run.started_at,
    duration: run.duration || 0,
    tier: run.tier,
    weather: run.weather,
    outcome: run.outcome,
    loot_value: run.loot_value || 0,
    consumed_cost: run.consumed_cost || 0,
    net_isk: run.net_isk || 0,
    total_loss: run.total_loss || 0,
    system_id: lastSystemId,
    cargo_before: run.cargoBefore || '',
    cargo_after: run.cargoAfter || '',
    drone_before: run.droneBefore || '',
    drone_after: run.droneAfter || '',
    ship_name: run.ship_name || '',
    ship_class: run.ship_class || 'Unknown',
    items,
    fitting,
    implants
  };

  try {
    await window.api.runs.completeActive(runData);
  } catch (error) {
    run.finalizing = false;
    throw error;
  }

  // Promote post-run cargo and drone bay to pre-run for next run
  if (run.outcome === 'Survived') {
    document.getElementById('cargoBeforeText').value = run.cargoAfter;
    // If post-run drone bay was pasted use it, otherwise carry pre-run forward unchanged
    const nextDroneBefore = (run.droneAfter && run.droneAfter.trim())
      ? run.droneAfter
      : run.droneBefore || '';
    document.getElementById('droneBeforeText').value = nextDroneBefore;
    updatePasteHint('droneBeforeText', 'preDroneHint');
    if (nextDroneBefore.trim()) {
      document.getElementById('preDroneBody').classList.add('open');
      document.getElementById('preDroneArrow').classList.add('open');
    }
  } else {
    document.getElementById('cargoBeforeText').value = '';
    document.getElementById('droneBeforeText').value = '';
  }

  S.activeRun = null;
  resetRunUI();
  updateRecentRuns();
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


// ── Manual Entry & Run Editing ────────────────────────────────────────────

let manualEditRunId = null; // null = new entry, number = editing existing

function openManualEntryModal(runToEdit = null) {
  manualEditRunId = null;
  document.getElementById('manualEntryTitle').textContent = 'Enter Run Manually';
  document.getElementById('manualSubmitLabel').textContent = 'Appraise & Save';
  document.getElementById('saveWithoutAppraiseBtn').style.display = 'none';
  document.getElementById('manualTier').value = S.settings.default_tier || '';
  document.getElementById('manualWeather').value = S.settings.default_weather || '';
  document.getElementById('manualOutcome').value = 'Survived';
  document.getElementById('manualDuration').value = '';
  document.getElementById('manualCargoBefore').value = '';
  document.getElementById('manualDroneBefore').value = '';
  document.getElementById('manualCargoAfter').value = '';
  document.getElementById('manualDroneAfter').value = '';
  document.getElementById('manualEntryStatus').innerHTML = '';
  // Default date to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('manualDate').value = now.toISOString().slice(0, 16);
  updateManualOutcomeUI();
  openModal('manualEntryModal');
}

async function openEditRunModal(runId) {
  const run = await window.api.runs.getById(runId);
  if (!run) return;
  manualEditRunId = runId;
  document.getElementById('manualEntryTitle').textContent = 'Edit Run';
  document.getElementById('manualSubmitLabel').textContent = 'Re-Appraise & Save';
  document.getElementById('saveWithoutAppraiseBtn').style.display = 'inline-flex';
  document.getElementById('manualTier').value = run.tier || '';
  document.getElementById('manualWeather').value = run.weather || '';
  document.getElementById('manualOutcome').value = run.outcome || 'Survived';
  // Duration: convert seconds to mm:ss
  const dur = run.duration || 0;
  const mm = Math.floor(dur / 60).toString().padStart(2, '0');
  const ss = (dur % 60).toString().padStart(2, '0');
  document.getElementById('manualDuration').value = `${mm}:${ss}`;
  // Date
  const d = new Date(run.started_at * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  document.getElementById('manualDate').value = d.toISOString().slice(0, 16);
  document.getElementById('manualShipClass').value = run.ship_class || 'Unknown';
  document.getElementById('manualCargoBefore').value = run.cargo_before || '';
  document.getElementById('manualDroneBefore').value = run.drone_before || '';
  document.getElementById('manualDroneAfter').value = run.drone_after || '';
  document.getElementById('manualCargoAfter').value = run.cargo_after || '';
  document.getElementById('manualEntryStatus').innerHTML = '';
  updateManualOutcomeUI();
  closeModal('runDetailModal');
  openModal('manualEntryModal');
}

function updateManualOutcomeUI() {
  const outcome = document.getElementById('manualOutcome').value;
  const afterCol = document.getElementById('manualCargoAfterCol');
  if (outcome === 'Died') {
    afterCol.style.display = 'none';
  } else {
    afterCol.style.display = 'block';
  }
}

function closeManualEntryModal() {
  closeModal('manualEntryModal');
  manualEditRunId = null;
}

async function initAboutPage() {
  try {
    const version = await window.api.app.getVersion();
    document.getElementById('aboutVersion').textContent = 'v' + version;
  } catch(e) {}
}

function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkForUpdates() {
  const btn = document.getElementById('updateBtn');
  const status = document.getElementById('updateStatus');
  btn.disabled = true;
  status.style.color = 'var(--text-muted)';
  status.textContent = 'Checking...';

  try {
    const result = await window.api.app.checkUpdate();
    if (!result.success) {
      status.style.color = 'var(--red)';
      status.textContent = 'Could not reach update server.';
      btn.disabled = false;
      return;
    }

    const current = await window.api.app.getVersion();
    const isNewer = compareSemver(result.version, current) > 0;

    if (isNewer) {
      status.innerHTML = `<span style="color:var(--green)">v${esc(result.version)} available</span>
        ${result.releaseNotes ? '<span style="color:var(--text-muted);margin-left:6px">' + esc(result.releaseNotes) + '</span>' : ''}
        &nbsp;<a href="#" data-action="open-external" data-url="${esc(result.releaseUrl || '')}"
          style="color:var(--cyan);font-size:11px">Download →</a>`;
    } else {
      status.style.color = 'var(--text-muted)';
      status.textContent = 'You are on the latest version.';
    }
  } catch(e) {
    status.style.color = 'var(--red)';
    status.textContent = 'Update check failed.';
  }
  btn.disabled = false;
}

function toggleCollapsible(bodyId, arrowId, hintId) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  arrow.classList.toggle('open', !isOpen);
}

function updatePasteHint(textareaId, hintId) {
  const val = document.getElementById(textareaId).value.trim();
  const hint = document.getElementById(hintId);
  if (!hint) return;
  if (!val) { hint.textContent = ''; return; }
  const lines = val.split(/\n/).filter(l => l.trim()).length;
  hint.textContent = `${lines} item${lines !== 1 ? 's' : ''} pasted`;
}

function parseDuration(str) {
  if (!str || !str.trim()) return 0;
  const parts = str.trim().split(':');
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  return parseInt(str) || 0;
}

async function submitManualEntry(doAppraise = true) {
  const tier = document.getElementById('manualTier').value;
  const weather = document.getElementById('manualWeather').value;
  const outcome = document.getElementById('manualOutcome').value;
  const duration = parseDuration(document.getElementById('manualDuration').value);
  const shipClass = document.getElementById('manualShipClass').value;
  const dateVal = document.getElementById('manualDate').value;
  const cargoBefore = document.getElementById('manualCargoBefore').value;
  const cargoAfter = document.getElementById('manualCargoAfter').value;
  const droneBefore = document.getElementById('manualDroneBefore')?.value || '';
  const droneAfter = document.getElementById('manualDroneAfter')?.value || '';
  const statusEl = document.getElementById('manualEntryStatus');

  if (!tier || !weather) {
    statusEl.innerHTML = '<div class="alert err">Please select a tier and weather type.</div>';
    return;
  }
  if (doAppraise && !S.hasJaniceKey) {
    statusEl.innerHTML = '<div class="alert err">Janice API key not set — go to Settings.</div>';
    return;
  }

  const started_at = dateVal ? Math.floor(new Date(dateVal).getTime() / 1000) : Math.floor(Date.now() / 1000);
  document.getElementById('manualSpinner').style.display = 'inline-block';
  statusEl.innerHTML = '';

  try {
    let loot_value = 0, consumed_cost = 0, net_isk = 0, total_loss = 0;
    let items = [];

    if (!doAppraise && manualEditRunId) {
      // Save metadata only — preserve existing appraisal values
      await window.api.runs.updateMeta(manualEditRunId, { tier, weather, outcome, duration, started_at, total_loss: 0, ship_class: shipClass });
      // Update cargo text only (so future re-appraise uses corrected pastes)
      await window.api.runs.updateCargoOnly(manualEditRunId, { cargo_before: cargoBefore, cargo_after: cargoAfter, drone_before: droneBefore, drone_after: droneAfter });
      closeManualEntryModal();
      renderHistory();
      updateRecentRuns();
      if (document.getElementById('page-stats').classList.contains('active')) renderStats();
      document.getElementById('manualSpinner').style.display = 'none';
      return;
    }

    if (outcome === 'Survived') {
      const _cd = diffCargo(cargoBefore, cargoAfter);
      const _dd = diffCargo(droneBefore, droneAfter);
      const diff = { gained: mergeDiffItems(_cd.gained, _dd.gained), consumed: mergeDiffItems(_cd.consumed, _dd.consumed) };
      let lootResult = null, consumedResult = null;

      if (diff.gained.length > 0) {
        lootResult = await window.api.janice.appraise(diff.gained, 'buy');
      }
      if (diff.consumed.length > 0) {
        consumedResult = await window.api.janice.appraise(diff.consumed, 'sell');
      }

      loot_value = lootResult ? lootResult.totalBuyPrice : 0;
      consumed_cost = consumedResult ? consumedResult.totalSellPrice : 0;
      net_isk = loot_value - consumed_cost;

      if (lootResult) {
        for (const item of lootResult.items) {
          const p = item.effectivePrices;
          items.push({ item_name: item.itemType.name, qty: item.amount, type: 'gained', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
        }
      }
      if (consumedResult) {
        for (const item of consumedResult.items) {
          const p = item.effectivePrices;
          items.push({ item_name: item.itemType.name, qty: item.amount, type: 'consumed', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
        }
      }
    } else {
      // Died — appraise pre-run cargo as loss
      const cargoItems = parseCargo(cargoBefore);
      if (cargoItems.length > 0) {
        const lossResult = await window.api.janice.appraise(cargoItems, 'sell');
        total_loss = lossResult ? lossResult.totalSellPrice : 0;
        if (lossResult) {
          for (const item of lossResult.items) {
            const p = item.effectivePrices;
            items.push({ item_name: item.itemType.name, qty: item.amount, type: 'lost', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
          }
        }
      }
    }

    const runData = {
      character_id: S.activeCharId,
      started_at,
      duration,
      tier,
      weather,
      outcome,
      loot_value,
      consumed_cost,
      net_isk,
      total_loss,
      cargo_before: cargoBefore,
      cargo_after: cargoAfter,
      drone_before: droneBefore,
      drone_after: droneAfter,
      ship_name: '',
      ship_class: shipClass,
      items,
      fitting: [],
      implants: []
    };

    if (manualEditRunId) {
      // Update existing run
      await window.api.runs.updateAppraisal(manualEditRunId, {
        loot_value,
        consumed_cost,
        net_isk,
        cargo_before: cargoBefore,
        cargo_after: cargoAfter,
        items
      });
      // Also update metadata (tier, weather, outcome, duration, date)
      await window.api.runs.updateMeta(manualEditRunId, { tier, weather, outcome, duration, started_at, total_loss, ship_class: shipClass });
    } else {
      await window.api.runs.save(runData);
    }

    closeManualEntryModal();
    renderHistory();
    updateRecentRuns();
    if (document.getElementById('page-stats').classList.contains('active')) renderStats();

    statusEl.innerHTML = '';
  } catch (e) {
    statusEl.innerHTML = `<div class="alert err">Failed: ${esc(e.message)}</div>`;
  }
  document.getElementById('manualSpinner').style.display = 'none';
}

async function cancelRun() {
  if (!S.activeRun || S.activeRun.finalizing) return;
  const run = S.activeRun;
  run.finalizing = true;
  try {
    await clearPersistedActiveRun(run.character_id);
  } catch (error) {
    run.finalizing = false;
    throw error;
  }
  if (S.activeRun === run) S.activeRun = null;
  resetRunUI();
}

function backToAppraise() {
  // Re-snapshot pre-run cargo in case user edited it before re-appraising
  if (S.activeRun) {
    S.activeRun.cargoBefore = document.getElementById('cargoBeforeText').value;
    S.activeRun.droneBefore = document.getElementById('droneBeforeText').value;
  }
  document.getElementById('cargoAfterText').value = S.activeRun ? S.activeRun.cargoAfter : '';
  document.getElementById('droneAfterText').value = S.activeRun ? (S.activeRun.droneAfter || '') : '';
  setRunState('awaiting-cargo');
  void persistActiveRun().catch(error => {
    console.error('Failed to checkpoint active run:', error);
  });
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
  document.getElementById('cargoAfterText').value = '';
  document.getElementById('droneAfterText').value = '';
  document.getElementById('fitCaptured').style.display = 'none';
  document.getElementById('appraise-error').style.display = 'none';
  document.getElementById('recoveryStatus').style.display = 'none';
  setRunState('awaiting');
}

function setRunState(state) {
  S.runState = state;
  const states = ['awaiting', 'in-abyss', 'awaiting-cargo', 'died', 'appraisal'];
  for (const s of states) {
    const el = document.getElementById('state-' + s);
    if (el) el.style.display = s === state ? 'block' : 'none';
  }
  // Reset died sub-state
  if (state === 'died') {
    document.getElementById('loss-loading').style.display = 'block';
    document.getElementById('loss-results').style.display = 'none';
    document.getElementById('loss-actions').style.display = 'none';
  }
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
  }, 500);
}

function stopTimer() {
  if (S.timerInterval) { clearInterval(S.timerInterval); S.timerInterval = null; }
}

// ── Cargo Parsing & Diffing ───────────────────────────────────────────────
function parseCargo(raw) {
  if (!raw || !raw.trim()) return [];
  const items = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // EVE multi-column paste: Name \t Qty \t Category \t Volume \t ISK
    // The second column is the quantity when it parses as a positive integer.
    // If it doesn't (e.g. second col is a category name like "Exotic Plasma Charge Blueprint"),
    // treat the item as qty 1 — EVE omits the qty column for single-item stacks.
    const cols = trimmed.split(/\t/);
    if (cols.length >= 2) {
      const name = cols[0].trim();
      const qtyRaw = cols[1].trim().replace(/^x/i, '').replace(/,/g, '').replace(/\s.*$/, '');
      const qty = parseInt(qtyRaw);
      if (name && !isNaN(qty) && qty > 0) {
        items[name] = (items[name] || 0) + qty;
        continue;
      }
      // Second col wasn't a number — single item, qty 1 (e.g. blueprint with category as col 2)
      if (name && name.length > 2) {
        items[name] = (items[name] || 0) + 1;
        continue;
      }
    }

    // Single column line: plain item name, qty 1
    if (cols.length === 1) {
      // Try "Item Name x 100" format first
      const m = trimmed.match(/^(.+?)\s+x\s*([0-9,]+)\s*$/i);
      if (m) {
        const name = m[1].trim();
        const qty = parseInt(m[2].replace(/,/g, ''));
        if (name && qty > 0) { items[name] = (items[name] || 0) + qty; continue; }
      }
      // Plain name, qty 1
      if (trimmed.length > 2) items[trimmed] = (items[trimmed] || 0) + 1;
    }
  }
  return Object.entries(items).map(([name, qty]) => ({ name, qty }));
}

function mergeDiffItems(a, b) {
  const map = {};
  for (const item of [...a, ...b]) {
    map[item.name] = (map[item.name] || 0) + item.qty;
  }
  return Object.entries(map).map(([name, qty]) => ({ name, qty }));
}

function diffCargo(beforeRaw, afterRaw) {
  const before = {};
  for (const { name, qty } of parseCargo(beforeRaw)) before[name] = qty;
  const after = {};
  for (const { name, qty } of parseCargo(afterRaw)) after[name] = qty;

  const gained = [];
  const consumed = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const b = before[key] || 0;
    const a = after[key] || 0;
    if (a > b) gained.push({ name: key, qty: a - b });
    else if (b > a) consumed.push({ name: key, qty: b - a });
    // equal = carry-over, excluded
  }
  return { gained, consumed };
}

// ── History ───────────────────────────────────────────────────────────────
async function renderHistory() {
  const el = document.getElementById('historyContent');
  const filters = {
    character_id: S.activeCharId || undefined,
    tier: document.getElementById('filterTier').value || undefined,
    weather: document.getElementById('filterWeather').value || undefined,
    outcome: document.getElementById('filterOutcome').value || undefined,
  };

  const runs = await window.api.runs.getAll(filters);
  if (!runs.length) {
    el.innerHTML = '<div class="empty-state">No runs logged yet</div>';
    return;
  }

  // Sort
  runs.sort((a, b) => {
    let av = a[S.sortCol], bv = b[S.sortCol];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return S.sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const cols = [
    { key: 'started_at', label: 'Date' },
    { key: 'tier', label: 'Tier' },
    { key: 'weather', label: 'Weather' },
    { key: 'ship_class', label: 'Ship' },
    { key: 'duration', label: 'Duration' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'net_isk', label: 'Net ISK' },
    { key: 'total_loss', label: 'Total Loss' },
    { key: '_detail', label: '' },
  ];

  let html = `<table class="data-table"><thead><tr>`;
  for (const col of cols) {
    if (col.key === '_detail') { html += `<th></th>`; continue; }
    const cls = S.sortCol === col.key ? (S.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    html += `<th class="${cls}" data-action="sort-history" data-sort-column="${esc(col.key)}">${esc(col.label)}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const run of runs) {
    const d = new Date(run.started_at * 1000);
    html += `<tr>
      <td class="mono">${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
      <td><span class="badge tier">${esc(run.tier || '—')}</span></td>
      <td><span class="badge weather">${esc(run.weather || '—')}</span></td>
      <td style="color:var(--dim);font-size:11px">${esc(run.ship_class || '—')}</td>
      <td class="mono">${fmtDuration(run.duration)}</td>
      <td><span class="badge ${run.outcome === 'Survived' ? 'survived' : 'died'}">${esc(run.outcome)}</span></td>
      <td class="${run.outcome === 'Survived' ? (run.net_isk >= 0 ? 'positive' : 'negative') : ''}">${run.outcome === 'Survived' ? (run.net_isk >= 0 ? '+' : '') + fmtIsk(run.net_isk) : '—'}</td>
      <td class="${run.outcome === 'Died' ? 'negative' : 'mono'}">${run.outcome === 'Died' ? '−' + fmtIsk(run.total_loss) : '—'}</td>
      <td><button class="btn sm ghost" data-action="show-run-detail" data-run-id="${esc(run.id)}">Detail</button></td>
    </tr>`;
  }
  html += `</tbody></table>`;
  el.innerHTML = html;
}

function sortHistory(col) {
  if (S.sortCol === col) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
  else { S.sortCol = col; S.sortDir = 'desc'; }
  renderHistory();
}

async function showRunDetail(runId) {
  const run = await window.api.runs.getById(runId);
  if (!run) return;

  const d = new Date(run.started_at * 1000);
  document.getElementById('runDetailTitle').textContent = `${run.tier} ${run.weather} — ${d.toLocaleDateString()}`;

  const gained = run.items.filter(i => i.type === 'gained');
  const consumed = run.items.filter(i => i.type === 'consumed');
  const lost = run.items.filter(i => i.type === 'lost');

  let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
    <div><div class="field-label">Date</div><div class="mono" style="font-size:12px">${d.toLocaleString()}</div></div>
    <div><div class="field-label">Duration</div><div class="mono" style="font-size:12px">${fmtDuration(run.duration)}</div></div>
    <div><div class="field-label">Outcome</div><div><span class="badge ${run.outcome === 'Survived' ? 'survived' : 'died'}">${esc(run.outcome)}</span></div></div>
    <div><div class="field-label">Ship Class</div><div>${run.ship_class ? '<span class="badge tier">' + esc(run.ship_class) + '</span>' : '<span style="color:var(--muted)">—</span>'}</div></div>
    <div><div class="field-label">${run.outcome === 'Survived' ? 'Net ISK' : 'Total Loss'}</div>
    <div class="mono" style="font-size:14px;color:${run.outcome === 'Survived' ? (run.net_isk >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--red)'}">
      ${run.outcome === 'Survived' ? (run.net_isk >= 0 ? '+' : '') + fmtIsk(run.net_isk) : '−' + fmtIsk(run.total_loss)}
    </div></div>
  </div>`;

  if (gained.length) {
    html += itemTableHtml('Loot Gained', gained, 'gained', 'unit_price_buy');
  }
  if (consumed.length) {
    html += itemTableHtml('Items Consumed', consumed, 'consumed', 'unit_price_sell');
  }
  if (lost.length) {
    html += itemTableHtml('Items Lost', lost, 'consumed', 'unit_price_sell');
  }
  if (run.fitting.length) {
    html += fittingTableHtml('Ship Fitting (at run start)', run.fitting);
  }
  if (run.implants.length) {
    html += implantTableHtml('Implants (at run start)', run.implants);
  }

  // Cargo paste section — always shown, editable for re-appraisal
  const hasCargo = run.cargo_before || run.cargo_after;
  html += `<div class="section-title" style="margin-top:18px">Cargo Pastes</div>`;

  if (run.outcome === 'Survived') {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="field-label">Pre-Run Cargo</div>
        <textarea class="field-textarea" id="detailCargoBefore" style="min-height:80px;font-size:11px">${esc(run.cargo_before || '')}</textarea>
        <div class="field-label" style="margin-top:8px">Pre-Run Drone Bay</div>
        <textarea class="field-textarea" id="detailDroneBefore" style="min-height:60px;font-size:11px">${esc(run.drone_before || '')}</textarea>
      </div>
      <div>
        <div class="field-label">Post-Run Cargo</div>
        <textarea class="field-textarea" id="detailCargoAfter" style="min-height:80px;font-size:11px">${esc(run.cargo_after || '')}</textarea>
        <div class="field-label" style="margin-top:8px">Post-Run Drone Bay</div>
        <textarea class="field-textarea" id="detailDroneAfter" style="min-height:60px;font-size:11px">${esc(run.drone_after || '')}</textarea>
      </div>
    </div>
    <div id="reappraise-status-${run.id}" style="margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button class="btn gold sm" data-action="reappraise-run" data-run-id="${esc(run.id)}"><span id="reappraise-spinner-${esc(run.id)}" style="display:none" class="spinner"></span> Re-Appraise Loot</button>
      <button class="btn sm ghost" data-action="edit-run" data-run-id="${esc(run.id)}">✎ Edit Run</button>
      <button class="btn sm red" data-action="delete-run" data-run-id="${esc(run.id)}">Delete Run</button>
    </div>`;
  } else {
    // Died — only pre-run cargo, no post-run
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div class="field-label">Pre-Run Cargo (at time of death)</div>
        <textarea class="field-textarea" id="detailCargoBefore" style="min-height:90px;font-size:11px" readonly>${esc(run.cargo_before || '')}</textarea>
      </div>
      <div>
        <div class="field-label">Pre-Run Drone Bay (at time of death)</div>
        <textarea class="field-textarea" id="detailDroneBefore" style="min-height:90px;font-size:11px" readonly>${esc(run.drone_before || '')}</textarea>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button class="btn sm ghost" data-action="edit-run" data-run-id="${esc(run.id)}">✎ Edit Run</button>
      <button class="btn sm red" data-action="delete-run" data-run-id="${esc(run.id)}">Delete Run</button>
    </div>`;
  }

  document.getElementById('runDetailContent').innerHTML = html;
  openModal('runDetailModal');
}

async function reappraiseRun(runId) {
  if (!S.hasJaniceKey) {
    document.getElementById(`reappraise-status-${runId}`).innerHTML = '<div class="alert err">Janice API key not set. Go to Settings.</div>';
    return;
  }

  const cargoBefore = document.getElementById('detailCargoBefore').value;
  const cargoAfter = document.getElementById('detailCargoAfter').value;
  const droneBefore = document.getElementById('detailDroneBefore')?.value || '';
  const droneAfter = document.getElementById('detailDroneAfter')?.value || '';

  if (!cargoAfter.trim()) {
    document.getElementById(`reappraise-status-${runId}`).innerHTML = '<div class="alert warn">Post-run cargo is empty — paste it first.</div>';
    return;
  }

  const spinner = document.getElementById(`reappraise-spinner-${runId}`);
  const statusEl = document.getElementById(`reappraise-status-${runId}`);
  spinner.style.display = 'inline-block';
  statusEl.innerHTML = '';

  const diff = diffCargo(cargoBefore, cargoAfter);

  try {
    let lootResult = null, consumedResult = null;
    if (diff.gained.length > 0) {
      lootResult = await window.api.janice.appraise(diff.gained, 'buy');
    }
    if (diff.consumed.length > 0) {
      consumedResult = await window.api.janice.appraise(diff.consumed, 'sell');
    }

    const lootValue = lootResult ? lootResult.totalBuyPrice : 0;
    const consumedCost = consumedResult ? consumedResult.totalSellPrice : 0;
    const netIsk = lootValue - consumedCost;

    // Build updated items list
    const items = [];
    if (lootResult) {
      for (const item of lootResult.items) {
        const p = item.effectivePrices;
        items.push({ item_name: item.itemType.name, qty: item.amount, type: 'gained', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
      }
    }
    if (consumedResult) {
      for (const item of consumedResult.items) {
        const p = item.effectivePrices;
        items.push({ item_name: item.itemType.name, qty: item.amount, type: 'consumed', unit_price_buy: p.buyPrice, unit_price_sell: p.sellPrice });
      }
    }

    // Save updated run
    await window.api.runs.updateAppraisal(runId, {
      loot_value: lootValue,
      consumed_cost: consumedCost,
      net_isk: netIsk,
      cargo_before: cargoBefore,
      cargo_after: cargoAfter,
      drone_before: droneBefore,
      drone_after: droneAfter,
      items
    });

    renderHistory();
    updateRecentRuns();
    updateIskPerHour();
    // Re-render the modal in place so updated items are immediately visible
    await showRunDetail(runId);
    // Re-show success status after modal re-renders
    document.getElementById(`reappraise-status-${runId}`).innerHTML = `<div class="alert success">Re-appraised — Net ISK updated to ${fmtIsk(netIsk)}</div>`;
  } catch (e) {
    statusEl.innerHTML = `<div class="alert err">Re-appraisal failed: ${esc(e.message)}</div>`;
  }
  spinner.style.display = 'none';
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

function fittingTableHtml(title, fitting) {
  let html = `<div class="appraisal-section"><div class="appraisal-header">${title}</div>
    <table class="item-table"><thead><tr><th>Module</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Sell</th><th style="text-align:right">Total</th></tr></thead><tbody>`;
  for (const item of fitting) {
    const total = (item.unit_price_sell || 0) * item.qty;
    html += `<tr>
      <td class="name">${esc(item.type_name)}</td>
      <td class="qty">${item.qty}</td>
      <td class="price consumed">${fmtIsk(item.unit_price_sell || 0)}</td>
      <td class="price consumed">${fmtIsk(total)}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function implantTableHtml(title, implants) {
  let html = `<div class="appraisal-section"><div class="appraisal-header">${title}</div>
    <table class="item-table"><thead><tr><th>Implant</th><th style="text-align:right">Unit Sell</th></tr></thead><tbody>`;
  for (const imp of implants) {
    html += `<tr>
      <td class="name">${esc(imp.type_name)}</td>
      <td class="price consumed">${fmtIsk(imp.unit_price_sell || 0)}</td>
    </tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

async function deleteRun(runId) {
  if (!confirm('Delete this run? This cannot be undone.')) return;
  await window.api.runs.delete(runId);
  closeModal('runDetailModal');
  renderHistory();
  updateRecentRuns();
}

// ── Stats ─────────────────────────────────────────────────────────────────
async function renderStats() {
  const el = document.getElementById('statsContent');
  const [stats, daily] = await Promise.all([
    window.api.runs.getStats(S.activeCharId),
    window.api.runs.getDailyStats(S.activeCharId)
  ]);
  const o = stats.overall;

  if (!o || o.total_runs === 0) {
    el.innerHTML = '<div class="empty-state">No runs logged yet</div>';
    return;
  }

  const survRate = o.total_runs > 0 ? Math.round(o.survived / o.total_runs * 100) : 0;

  let html = `<div class="stat-grid">
    <div class="stat-card"><div class="stat-card-label">Total Runs</div><div class="stat-card-value cyan">${o.total_runs}</div></div>
    <div class="stat-card"><div class="stat-card-label">Survival Rate</div><div class="stat-card-value green">${survRate}%</div></div>
    <div class="stat-card"><div class="stat-card-label">Avg Duration</div><div class="stat-card-value">${fmtDuration(Math.round(o.avg_duration_survived || 0))}</div></div>
    <div class="stat-card"><div class="stat-card-label">ISK / Hour</div><div class="stat-card-value gold">${fmtIsk(stats.iskPerHour)}</div></div>
    <div class="stat-card"><div class="stat-card-label">Total Net ISK</div><div class="stat-card-value ${o.total_net_isk >= 0 ? 'green' : 'red'}">${fmtIsk(o.total_net_isk || 0)}</div></div>
    <div class="stat-card"><div class="stat-card-label">Avg Net ISK / Run</div><div class="stat-card-value ${(o.avg_net_isk || 0) >= 0 ? 'green' : 'red'}">${fmtIsk(o.avg_net_isk || 0)}</div></div>
    <div class="stat-card"><div class="stat-card-label">Avg Loss on Death</div><div class="stat-card-value red">${fmtIsk(o.avg_loss || 0)}</div></div>
    <div class="stat-card"><div class="stat-card-label">Total Losses</div><div class="stat-card-value red">${fmtIsk(o.total_loss || 0)}</div></div>
  </div>`;

  // Daily chart — always shown
  html += `<div class="section-title">Daily Activity</div>
    <div id="dailyChart" style="background:var(--panel);border:1px solid var(--border);padding:16px;margin-bottom:16px"></div>`;

  if (stats.byTier.length) {
    html += `<div class="section-title">By Tier</div>
    <table class="data-table" style="margin-bottom:16px"><thead><tr>
      <th>Tier</th><th>Runs</th><th>Survived</th><th>Died</th><th>Survival %</th><th>Avg Duration</th><th>Avg Net ISK</th>
    </tr></thead><tbody>`;
    for (const t of stats.byTier) {
      const sr = t.total_runs > 0 ? Math.round(t.survived / t.total_runs * 100) : 0;
      html += `<tr>
        <td><span class="badge tier">${esc(t.tier || '—')}</span></td>
        <td>${t.total_runs}</td>
        <td style="color:var(--green)">${t.survived}</td>
        <td style="color:var(--red)">${t.total_runs - t.survived}</td>
        <td>${sr}%</td>
        <td class="mono">${fmtDuration(Math.round(t.avg_duration || 0))}</td>
        <td class="${(t.avg_net_isk || 0) >= 0 ? 'positive' : 'negative'}">${fmtIsk(t.avg_net_isk || 0)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  if (stats.byWeather.length) {
    html += `<div class="section-title">By Weather</div>
    <table class="data-table"><thead><tr>
      <th>Weather</th><th>Runs</th><th>Survived</th><th>Died</th><th>Survival %</th><th>Avg Net ISK</th>
    </tr></thead><tbody>`;
    for (const w of stats.byWeather) {
      const sr = w.total_runs > 0 ? Math.round(w.survived / w.total_runs * 100) : 0;
      html += `<tr>
        <td><span class="badge weather">${esc(w.weather || '—')}</span></td>
        <td>${w.total_runs}</td>
        <td style="color:var(--green)">${w.survived}</td>
        <td style="color:var(--red)">${w.total_runs - w.survived}</td>
        <td>${sr}%</td>
        <td class="${(w.avg_net_isk || 0) >= 0 ? 'positive' : 'negative'}">${fmtIsk(w.avg_net_isk || 0)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  el.innerHTML = html;

  // Render chart after DOM is set
  renderDailyChart(daily);
}

function renderDailyChart(daily) {
  const container = document.getElementById('dailyChart');
  if (!container) return;
  if (!daily || daily.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:11px;letter-spacing:2px;text-transform:uppercase">No data yet</div>';
    return;
  }
  if (daily.length === 1) {
    // Pad with a zero day before so the single point renders as a bar rather than a flat line
    daily = [{ day: '', total_runs: 0, net_isk: 0, total_loss: 0, survived: 0 }, ...daily];
  }

  const W = container.clientWidth - 32;
  const H = 200;
  const PAD = { top: 10, right: 16, bottom: 36, left: 64 };
  const cw = W - PAD.left - PAD.right;
  const ch = H - PAD.top - PAD.bottom;

  // Data ranges
  const maxRuns = Math.max(...daily.map(d => d.total_runs), 1);
  const maxIsk = Math.max(...daily.map(d => Math.abs(d.net_isk)), 1);

  const n = daily.length;
  const barW = Math.max(2, Math.floor(cw / n) - 2);

  // Build SVG
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
    <defs>
      <linearGradient id="iskGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#66bb6a" stop-opacity="0.8"/>
        <stop offset="100%" stop-color="#66bb6a" stop-opacity="0.1"/>
      </linearGradient>
      <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ef5350" stop-opacity="0.1"/>
        <stop offset="100%" stop-color="#ef5350" stop-opacity="0.8"/>
      </linearGradient>
    </defs>
    <g transform="translate(${PAD.left},${PAD.top})">`;

  // Y axis gridlines (ISK) — 4 lines
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(ch * (1 - i / 4));
    const val = (maxIsk * i / 4);
    const label = fmtIsk(val);
    svg += `<line x1="0" y1="${y}" x2="${cw}" y2="${y}" stroke="#1e2d3d" stroke-width="1"/>`;
    svg += `<text x="-6" y="${y + 4}" fill="#2a4a6a" font-size="10" text-anchor="end" font-family="Consolas,monospace">${label}</text>`;
  }

  // Zero line
  const zeroY = ch;
  svg += `<line x1="0" y1="${zeroY}" x2="${cw}" y2="${zeroY}" stroke="#2a4060" stroke-width="1"/>`;

  // ISK area path + loss area path
  let iskPoints = '', lossPoints = '';
  let iskPath = '', lossPath = '';

  daily.forEach((d, i) => {
    const x = Math.round((i + 0.5) * cw / n);
    const iskY = d.net_isk >= 0
      ? Math.round(ch - (d.net_isk / maxIsk) * ch)
      : ch;
    const lossY = d.net_isk < 0
      ? Math.round(ch - (Math.abs(d.net_isk) / maxIsk) * ch)
      : ch;

    if (i === 0) {
      iskPath = `M${x},${iskY}`;
      lossPath = `M${x},${lossY}`;
    } else {
      iskPath += ` L${x},${iskY}`;
      lossPath += ` L${x},${lossY}`;
    }
  });

  // Close paths for fill
  const lastX = Math.round((daily.length - 0.5) * cw / n);
  const firstX = Math.round(0.5 * cw / n);
  svg += `<path d="${iskPath} L${lastX},${ch} L${firstX},${ch} Z" fill="url(#iskGrad)" opacity="0.7"/>`;
  svg += `<path d="${iskPath}" fill="none" stroke="#66bb6a" stroke-width="1.5"/>`;
  if (daily.some(d => d.net_isk < 0)) {
    svg += `<path d="${lossPath} L${lastX},${ch} L${firstX},${ch} Z" fill="url(#lossGrad)" opacity="0.7"/>`;
    svg += `<path d="${lossPath}" fill="none" stroke="#ef5350" stroke-width="1.5"/>`;
  }

  // Run count bars (subtle, behind ISK line)
  daily.forEach((d, i) => {
    const x = Math.round(i * cw / n + (cw / n - barW) / 2);
    const barH = Math.round((d.total_runs / maxRuns) * (ch * 0.25));
    const y = ch - barH;
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#4fc3f7" opacity="0.25" rx="1"/>`;
  });

  // X axis labels — show every N days to avoid crowding
  const labelEvery = daily.length <= 14 ? 1 : daily.length <= 30 ? 3 : 7;
  daily.forEach((d, i) => {
    if (i % labelEvery !== 0 && i !== daily.length - 1) return;
    const x = Math.round((i + 0.5) * cw / n);
    const dateStr = d.day.slice(5); // MM-DD
    svg += `<text x="${x}" y="${ch + 20}" fill="#2a4a6a" font-size="10" text-anchor="middle" font-family="Consolas,monospace">${dateStr}</text>`;
  });

  // Tooltip hit areas (title tag for native hover)
  daily.forEach((d, i) => {
    const x = Math.round(i * cw / n);
    const w = Math.round(cw / n);
    const iskStr = d.net_isk >= 0 ? '+' + fmtIsk(d.net_isk) : '-' + fmtIsk(Math.abs(d.net_isk));
    const title = `${d.day}  |  ${d.total_runs} runs  |  Net ISK: ${iskStr}`;
    svg += `<rect x="${x}" y="0" width="${w}" height="${ch}" fill="transparent"><title>${title}</title></rect>`;
  });

  // Legend
  svg += `<circle cx="${cw - 120}" cy="-4" r="4" fill="#66bb6a"/>
    <text x="${cw - 112}" y="0" fill="#5a7a9a" font-size="10" font-family="Consolas,monospace">Net ISK</text>
    <rect x="${cw - 54}" y="-8" width="8" height="8" fill="#4fc3f7" opacity="0.4" rx="1"/>
    <text x="${cw - 42}" y="0" fill="#5a7a9a" font-size="10" font-family="Consolas,monospace">Runs</text>`;

  svg += `</g></svg>`;
  container.innerHTML = svg;
}

// ── Settings ──────────────────────────────────────────────────────────────
function loadSettingsPage() {
  const keyInput = document.getElementById('janiceKeyInput');
  keyInput.value = '';
  keyInput.disabled = !S.secureStorage.available;
  keyInput.placeholder = S.hasJaniceKey
    ? 'Saved securely — enter a replacement'
    : 'Your Janice API key...';
  document.getElementById('removeJaniceKeyBtn').style.display = S.hasJaniceKey ? 'inline-flex' : 'none';

  const storageStatus = document.getElementById('secureStorageStatus');
  storageStatus.textContent = S.secureStorage.available
    ? `Credentials are protected by the operating system (${S.secureStorage.backend}).`
    : 'Secure credential storage is unavailable. Sign-in and API-key storage are disabled.';
  storageStatus.style.color = S.secureStorage.available ? 'var(--text-dim)' : 'var(--red)';

  if (S.settings.esi_poll_interval) document.getElementById('pollIntervalInput').value = S.settings.esi_poll_interval;
  if (S.settings.default_tier) document.getElementById('defaultTierInput').value = S.settings.default_tier;
  if (S.settings.default_weather) document.getElementById('defaultWeatherInput').value = S.settings.default_weather;
  renderCharList();
  renderDataStatus();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderDataStatus() {
  if (!S.dataStatus) return;
  const summary = document.getElementById('backupSummary');
  const location = document.getElementById('backupLocation');
  const createButton = document.getElementById('createBackupBtn');

  if (!S.dataStatus.automaticBackupsEnabled) {
    summary.textContent = 'Automatic backups are paused until secure credential storage is available.';
  } else if (S.dataStatus.latestBackup) {
    const backupDate = new Date(S.dataStatus.latestBackup.createdAt);
    summary.textContent = `Latest full backup: ${backupDate.toLocaleString()} (${formatBytes(S.dataStatus.latestBackup.size)}).`;
  } else {
    summary.textContent = 'No full database backup has been created yet.';
  }
  location.textContent = `Backup folder: ${S.dataStatus.backupDirectory}`;
  createButton.disabled = !S.dataStatus.automaticBackupsEnabled;
}

async function createFullBackup() {
  const status = document.getElementById('backupActionStatus');
  status.textContent = 'Creating backup...';
  status.className = 'alert';
  status.style.display = 'block';
  try {
    await window.api.data.createBackup();
    S.dataStatus = await window.api.data.getStatus();
    renderDataStatus();
    status.textContent = 'Full database backup created successfully.';
    status.className = 'alert success';
  } catch (error) {
    status.textContent = `Backup failed: ${error.message}`;
    status.className = 'alert err';
  }
}

async function openBackupFolder() {
  const status = document.getElementById('backupActionStatus');
  try {
    await window.api.data.openBackupFolder();
  } catch (error) {
    status.textContent = `Could not open backup folder: ${error.message}`;
    status.className = 'alert err';
    status.style.display = 'block';
  }
}

async function testJaniceKey() {
  const apiKey = document.getElementById('janiceKeyInput').value.trim();
  const resultEl = document.getElementById('janiceTestResult');
  if (!apiKey && !S.hasJaniceKey) {
    resultEl.textContent = 'Enter an API key first.';
    resultEl.className = 'alert err';
    resultEl.style.display = 'block';
    return;
  }
  resultEl.textContent = 'Testing...';
  resultEl.className = 'alert';
  resultEl.style.display = 'block';
  try {
    const result = apiKey
      ? await window.api.janice.testKey(apiKey)
      : await window.api.janice.appraise([{ name: 'Tritanium', qty: 1 }], 'buy');
    if (result && result.items && result.items.length > 0) {
      const price = result.items[0].effectivePrices.buyPrice;
      resultEl.textContent = `✓ API key valid — Tritanium buy price: ${fmtIsk(price)} ISK`;
      resultEl.className = 'alert success';
    } else {
      resultEl.textContent = 'Key accepted but no price data returned.';
      resultEl.className = 'alert warn';
    }
  } catch(e) {
    resultEl.textContent = `✗ Test failed: ${e.message}`;
    resultEl.className = 'alert err';
  }
}

function toggleJaniceKey(btn) {
  const input = document.getElementById('janiceKeyInput');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
}

async function removeJaniceKey() {
  if (!confirm('Remove the saved Janice API key?')) return;
  await window.api.secrets.deleteJaniceKey();
  S.hasJaniceKey = false;
  loadSettingsPage();
  const resultEl = document.getElementById('janiceTestResult');
  resultEl.textContent = 'Saved API key removed.';
  resultEl.className = 'alert success';
  resultEl.style.display = 'block';
}

async function exportCSV() {
  const result = await window.api.runs.exportCSV(S.activeCharId || null);
  const el = document.getElementById('csvStatus');
  if (result.success) {
    el.innerHTML = `<div class="alert success">Exported to ${esc(result.filePath)}</div>`;
  } else {
    el.innerHTML = '';
  }
  el.style.display = 'block';
}

async function importCSV() {
  const result = await window.api.runs.importCSV(S.activeCharId || null);
  const el = document.getElementById('csvStatus');
  if (!result.success) { el.style.display = 'none'; return; }
  let msg = `<div class="alert success">Imported ${result.imported} run${result.imported !== 1 ? 's' : ''}`;
  if (result.skipped) msg += `, ${result.skipped} skipped (duplicates)`;
  msg += '.</div>';
  if (result.errors && result.errors.length) {
    msg += `<div class="alert warn" style="margin-top:6px">${result.errors.slice(0,3).map(esc).join('<br>')}</div>`;
  }
  el.innerHTML = msg;
  el.style.display = 'block';
  renderHistory();
  updateRecentRuns();
  if (document.getElementById('page-stats').classList.contains('active')) renderStats();
}

async function saveSettings() {
  const apiKey = document.getElementById('janiceKeyInput').value.trim();
  const updates = {
    esi_poll_interval: document.getElementById('pollIntervalInput').value,
    default_tier: document.getElementById('defaultTierInput').value,
    default_weather: document.getElementById('defaultWeatherInput').value,
  };
  if (apiKey) {
    await window.api.secrets.setJaniceKey(apiKey);
    S.hasJaniceKey = true;
  }
  for (const [key, value] of Object.entries(updates)) {
    await window.api.settings.set(key, value);
  }
  S.settings = { ...S.settings, ...updates };
  loadSettingsPage();
  const msg = document.getElementById('settingsSaved');
  msg.style.display = 'block';
  setTimeout(() => msg.style.display = 'none', 2500);
}

function renderCharList() {
  const el = document.getElementById('charList');
  if (!S.characters.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No characters added yet.</div>';
    return;
  }
  el.innerHTML = S.characters.map(c => {
    const capabilities = normalizeCapabilities(S.characterCapabilities[c.id]);
    const badges = [
      ['tracking', 'Tracking'],
      ['fitting', 'Fitting'],
      ['implants', 'Implants'],
    ].filter(([capability]) => capabilities[capability])
      .map(([, label]) => `<span class="capability-badge enabled">${label}</span>`)
      .join('');
    return `
      <div class="char-item">
        <img class="char-portrait" src="${esc(characterPortraitUrl(c.portrait_url))}" alt="" data-hide-on-error>
        <div class="char-info">
          <div class="char-name">${esc(c.name)}</div>
          <div class="char-id">${esc(c.id)}</div>
          <div class="capability-list">${badges || '<span class="capability-badge">Manual only</span>'}</div>
        </div>
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="btn sm ghost" data-action="reauth-character" data-character-id="${esc(c.id)}">Permissions</button>
          <button class="btn sm red" data-action="remove-character" data-character-id="${esc(c.id)}">Remove</button>
        </div>
      </div>`;
  }).join('');
}

function characterPortraitUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'images.evetech.net' ? url.href : '';
  } catch {
    return '';
  }
}

async function reauthCharacter(charId) {
  // Existing run data is preserved; only the authorization is replaced.
  await switchCharacter(charId);
  document.getElementById('addCharModalTitle').textContent = 'Character Permissions';
  setSelectedCapabilities(S.characterCapabilities[charId]);
  document.getElementById('ssoSpinner').style.display = 'none';
  document.getElementById('ssoStatus').textContent =
    'Adjust the features, then continue to EVE SSO to replace this character authorization.';
  openModal('addCharModal');
}

async function removeCharacter(charId) {
  if (!confirm('Remove this character? Their run history will be deleted.')) return;
  if (String(S.activeCharId) === String(charId)) {
    stopESIPoll();
    S.activeRun = null;
    await clearPersistedActiveRun(charId);
    resetRunUI();
  }
  await window.api.auth.deleteCharacter(charId);
  S.characters = await window.api.auth.getCharacters();
  await refreshCharacterCapabilities();
  await populateCharSelect();
  renderCharList();
  if (String(S.activeCharId) === String(charId)) {
    S.activeCharId = null;
    if (S.characters.length) await switchCharacter(S.characters[0].id);
    else showNoCharPrompt();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────
async function updateRecentRuns() {
  if (!S.activeCharId) return;
  const runs = await window.api.runs.getAll({ character_id: S.activeCharId, limit: 5 });
  const el = document.getElementById('recentRunsList');
  if (!runs.length) { el.textContent = 'No runs yet'; return; }
  el.innerHTML = runs.map(r => {
    const d = new Date(r.started_at * 1000);
    const col = r.outcome === 'Survived' ? 'var(--green)' : 'var(--red)';
    const val = r.outcome === 'Survived' ? fmtIsk(r.net_isk) : '−' + fmtIsk(r.total_loss);
    return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span>${esc(r.tier)} ${esc(r.weather)} <span class="badge ${r.outcome === 'Survived' ? 'survived' : 'died'}" style="font-size:9px">${r.outcome === 'Survived' ? '✓' : '✗'}</span></span>
      <span style="color:${col};font-family:var(--font-mono)">${val}</span>
    </div>`;
  }).join('');
}

async function updateIskPerHour() {
  if (!S.activeCharId) return;
  const stats = await window.api.runs.getStats(S.activeCharId);
  const el = document.getElementById('iskPerHourDisplay');
  if (stats.iskPerHour > 0) {
    el.innerHTML = `<span style="color:var(--text-muted)">ISK/hr (recent 20):</span> <span style="color:var(--gold);font-family:var(--font-mono)">${fmtIsk(stats.iskPerHour)}</span>`;
  } else {
    el.textContent = '';
  }
}

function fmtIsk(n) {
  if (n == null || isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

function fmtDuration(secs) {
  if (!secs) return '00:00:00';
  const h = Math.floor(secs / 3600).toString().padStart(2, '0');
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function esc(str) {
  return window.AbyssSecurity.escapeHtml(str);
}

function openExternal(url) {
  window.api.shell.openExternal(url);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function getSelectedCapabilities() {
  return [
    ['tracking', 'permissionTracking'],
    ['fitting', 'permissionFitting'],
    ['implants', 'permissionImplants'],
  ].filter(([, id]) => document.getElementById(id).checked)
    .map(([capability]) => capability);
}

function setSelectedCapabilities(capabilities) {
  const selected = normalizeCapabilities(capabilities);
  document.getElementById('permissionTracking').checked = selected.tracking;
  document.getElementById('permissionFitting').checked = selected.fitting;
  document.getElementById('permissionImplants').checked = selected.implants;
  updatePermissionSummary();
}

function updatePermissionSummary() {
  const selected = getSelectedCapabilities();
  const summary = document.getElementById('permissionSummary');
  summary.textContent = selected.length === 0
    ? 'No ESI data permissions will be requested. This character can use manual run entry only.'
    : `${selected.length} optional feature${selected.length === 1 ? '' : 's'} selected. EVE SSO requires approval for every corresponding permission.`;
}

function openAddCharModal() {
  document.getElementById('addCharModalTitle').textContent = 'Add Character';
  document.getElementById('ssoStatus').textContent = '';
  document.getElementById('ssoSpinner').style.display = 'none';
  setSelectedCapabilities({ tracking: true, fitting: false, implants: false });
  openModal('addCharModal');
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

const clickActions = {
  'show-page': element => showPage(element.dataset.page),
  'toggle-collapsible': element =>
    toggleCollapsible(element.dataset.body, element.dataset.arrow, element.dataset.hint),
  'manual-start': () => manualStart(),
  'open-manual-entry': () => openManualEntryModal(),
  'manual-end-survived': () => manualEndSurvived(),
  'manual-end-died': () => manualEndDied(),
  'appraise-run': () => appraiseRun(),
  'cancel-run': () => cancelRun(),
  'save-current-run': () => saveCurrentRunSafely(),
  'back-to-appraise': () => backToAppraise(),
  'render-history': () => renderHistory(),
  'open-add-character': () => openAddCharModal(),
  'toggle-janice-key': element => toggleJaniceKey(element),
  'test-janice-key': () => testJaniceKey(),
  'remove-janice-key': () => removeJaniceKey(),
  'open-external': element => openExternal(element.dataset.url),
  'save-settings': () => saveSettings(),
  'export-csv': () => exportCSV(),
  'import-csv': () => importCSV(),
  'create-full-backup': () => createFullBackup(),
  'open-backup-folder': () => openBackupFolder(),
  'close-modal': element => closeModal(element.dataset.modal),
  'start-sso': () => startSSO(),
  'close-manual-entry': () => closeManualEntryModal(),
  'submit-manual-entry': element => submitManualEntry(element.dataset.appraise === 'true'),
  'sort-history': element => sortHistory(element.dataset.sortColumn),
  'show-run-detail': element => showRunDetail(Number(element.dataset.runId)),
  'reappraise-run': element => reappraiseRun(Number(element.dataset.runId)),
  'edit-run': element => openEditRunModal(Number(element.dataset.runId)),
  'delete-run': element => deleteRun(Number(element.dataset.runId)),
  'reauth-character': element => reauthCharacter(Number(element.dataset.characterId)),
  'remove-character': element => removeCharacter(Number(element.dataset.characterId)),
};

document.addEventListener('click', event => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  const handler = clickActions[element.dataset.action];
  if (!handler) return;
  event.preventDefault();
  Promise.resolve(handler(element)).catch(error => console.error('Action failed:', error));
});

document.addEventListener('change', event => {
  const element = event.target;
  if (['permissionTracking', 'permissionFitting', 'permissionImplants'].includes(element.id)) {
    updatePermissionSummary();
  } else if (element.dataset.changeAction === 'switch-character') {
    void switchCharacter(element.value).catch(error => {
      console.error('Character switch failed:', error);
    });
  } else if (element.dataset.changeAction === 'render-history') {
    void renderHistory();
  } else if (element.dataset.changeAction === 'manual-outcome') {
    updateManualOutcomeUI();
  }
});

document.addEventListener('input', event => {
  const element = event.target;
  if (element.dataset.inputAction === 'paste-hint') {
    updatePasteHint(element.id, element.dataset.hint);
  }
  if ([
    'cargoBeforeText',
    'cargoAfterText',
    'droneBeforeText',
    'droneAfterText',
  ].includes(element.id)) {
    scheduleActiveRunCheckpoint();
  }
});

document.addEventListener('error', event => {
  const element = event.target;
  if (element instanceof HTMLElement && element.hasAttribute('data-hide-on-error')) {
    element.style.display = 'none';
  }
}, true);

// Start
init().catch(error => console.error('Initialization failed:', error));
