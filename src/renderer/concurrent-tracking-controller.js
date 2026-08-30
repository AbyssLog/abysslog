(function initConcurrentTrackingController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssConcurrentTracking = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  const ABYSSAL_SYSTEM_MIN = 32_000_000;
  const CAPSULE_IDS = new Set([670, 33328]);
  const GROUP_ENTRY_WINDOW_SECONDS = 180;

  function createConcurrentTrackingController({
    api,
    runTracking,
    getCharacters,
    getCapabilities,
    getSelectedCharacterId,
    getForegroundRun,
    getSettings,
    classifyShip,
    onStatusChange,
    createUuid = () => globalThis.crypto.randomUUID(),
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    for (const dependency of [
      getCharacters, getCapabilities, getSelectedCharacterId, getForegroundRun,
      getSettings, classifyShip, onStatusChange, createUuid, now, setTimer, clearTimer,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Concurrent tracking dependencies must be functions');
      }
    }
    if (!api?.esi || !api?.runs || !runTracking?.createTransitionTracker) {
      throw new TypeError('Concurrent tracking requires ESI, run APIs, and tracking helpers');
    }

    const sessions = new Map();
    const dismissedCandidates = new Set();
    let timer = null;
    let running = false;
    let generation = 0;

    function characterName(characterId) {
      return getCharacters().find(character => Number(character.id) === Number(characterId))?.name
        || String(characterId);
    }

    function normalizeDraft(characterId, draft, baseline = null) {
      const settings = getSettings();
      return draft || {
        version: 1,
        character_id: Number(characterId),
        tier: settings.default_tier || 'Unknown',
        weather: settings.default_weather || 'Unknown',
        cargo_before: baseline?.cargo_after || '',
        drone_before: baseline?.drone_after?.trim()
          ? baseline.drone_after
          : baseline?.drone_before || '',
        notes: '',
        tags: [],
      };
    }

    function createSession(characterId) {
      return {
        characterId: Number(characterId),
        draft: null,
        snapshot: null,
        transition: runTracking.createTransitionTracker(),
        lastShipTypeId: null,
        lastHullName: null,
        lastSystemId: null,
        lastSystemName: null,
        nextPollAt: 0,
        failureCount: 0,
        inFlight: false,
        captureInFlight: false,
        captureAttempted: false,
        status: 'Monitoring',
      };
    }

    function emitStatus(session) {
      onStatusChange(session.characterId, session.status);
    }

    function setStatus(session, status) {
      if (session.status === status) return;
      session.status = status;
      emitStatus(session);
    }

    function snapshotStatus(snapshot) {
      if (!snapshot) return 'Monitoring';
      if (snapshot.state === 'in-abyss') return 'In Abyss';
      if (snapshot.state === 'died') return 'Died';
      return 'Needs Cargo';
    }

    async function loadSession(characterId, { force = false } = {}) {
      const id = Number(characterId);
      let session = sessions.get(id);
      if (!session) {
        session = createSession(id);
        sessions.set(id, session);
      } else if (!force) {
        return session;
      }
      const [snapshot, storedDraft, baseline] = await Promise.all([
        api.runs.getActive(id),
        api.runs.getTrackingDraft(id),
        api.runs.getInventoryBaseline(id),
      ]);
      session.snapshot = snapshot;
      session.draft = normalizeDraft(id, storedDraft, baseline);
      session.transition = runTracking.createTransitionTracker({
        initialPhase: snapshot?.state === 'in-abyss' ? 'inside' : 'outside',
      });
      session.lastSystemId = snapshot?.run?.system_id ?? null;
      session.lastSystemName = snapshot?.run?.system_name ?? null;
      session.lastHullName = snapshot?.run?.hull_name || null;
      session.nextPollAt = 0;
      session.failureCount = 0;
      setStatus(session, snapshotStatus(snapshot));
      return session;
    }

    function activeRuns() {
      const foreground = getForegroundRun();
      return [
        ...(foreground ? [foreground] : []),
        ...[...sessions.values()].map(session => session.snapshot?.run).filter(Boolean),
      ];
    }

    function assignEncounter(systemId, startedAt) {
      return createUuid().toLowerCase();
    }

    function candidateRuns(run) {
      if (!run || !Number.isSafeInteger(run.system_id) || run.system_id < ABYSSAL_SYSTEM_MIN) {
        return [];
      }
      const candidates = activeRuns().filter(candidate => (
        candidate.system_id === run.system_id
        && Math.abs(Number(candidate.started_at) - Number(run.started_at))
          <= GROUP_ENTRY_WINDOW_SECONDS
      ));
      const unique = [...new Map(candidates.map(candidate => [
        Number(candidate.character_id),
        candidate,
      ])).values()];
      if (unique.length < 2) return [];
      const shipClass = unique[0].ship_class;
      const validComposition = (
        shipClass === 'Frigate'
        && unique.length <= 3
        && unique.every(candidate => candidate.ship_class === 'Frigate')
      ) || (
        shipClass === 'Destroyer'
        && unique.length <= 2
        && unique.every(candidate => candidate.ship_class === 'Destroyer')
      );
      if (!validComposition) return [];
      const fingerprint = unique.map(candidate => candidate.encounter_uid).sort().join('|');
      return dismissedCandidates.has(fingerprint) ? [] : unique;
    }

    function candidateGroupForRun(run) {
      return candidateRuns(run).map(candidate => ({
        character_id: candidate.character_id,
        character_name: characterName(candidate.character_id),
      }));
    }

    function dismissGroupCandidate(run) {
      const candidates = candidateRuns(run);
      if (candidates.length < 2) return false;
      dismissedCandidates.add(candidates.map(candidate => candidate.encounter_uid).sort().join('|'));
      return true;
    }

    async function confirmGroupCandidate(run) {
      const candidates = candidateRuns(run);
      if (candidates.length < 2) return [];
      const encounterUid = run.encounter_uid;
      const participantIds = new Set(candidates.map(candidate => Number(candidate.character_id)));
      for (const candidate of candidates) candidate.encounter_uid = encounterUid;
      const saves = [];
      for (const session of sessions.values()) {
        if (!participantIds.has(session.characterId) || !session.snapshot) continue;
        session.snapshot.run.encounter_uid = encounterUid;
        if (session.characterId !== Number(getSelectedCharacterId())) {
          saves.push(api.runs.saveActive(session.snapshot));
        }
      }
      await Promise.all(saves);
      return [...participantIds];
    }

    function groupForRun(run) {
      if (!run?.encounter_uid) return [];
      const seen = new Set();
      return activeRuns().filter(candidate => {
        if (candidate.encounter_uid !== run.encounter_uid) return false;
        if (seen.has(candidate.character_id)) return false;
        seen.add(candidate.character_id);
        return true;
      }).map(candidate => ({
        character_id: candidate.character_id,
        character_name: characterName(candidate.character_id),
        outcome: candidate.outcome,
      }));
    }

    async function captureRunDetails(session, shipTypeId, snapshot) {
      const capabilities = getCapabilities(session.characterId);
      const [fitResult, implantResult] = await Promise.allSettled([
        capabilities.fitting
          ? api.esi.getFitting(session.characterId)
          : Promise.resolve(null),
        capabilities.implants
          ? api.esi.getImplants(session.characterId)
          : Promise.resolve(null),
      ]);
      if (session.snapshot !== snapshot || snapshot.state !== 'in-abyss') return;
      const fit = fitResult.status === 'fulfilled' ? fitResult.value : null;
      const implants = implantResult.status === 'fulfilled' && Array.isArray(implantResult.value)
        ? implantResult.value
        : [];
      const typeIds = [
        ...(fit ? [fit.ship_type_id, ...fit.items.map(item => item.type_id)] : []),
        ...implants,
      ];
      const names = typeIds.length ? await api.esi.getTypeNames([...new Set(typeIds)]) : {};
      if (session.snapshot !== snapshot || snapshot.state !== 'in-abyss') return;
      const resolvedShipTypeId = fit?.ship_type_id || shipTypeId;
      snapshot.run.ship_class = await classifyShip(resolvedShipTypeId);
      if (fit) {
        snapshot.run.hull_name = names[fit.ship_type_id] || snapshot.run.hull_name;
        snapshot.run.fitting = [
          {
            type_id: fit.ship_type_id,
            type_name: names[fit.ship_type_id] || `Type ${fit.ship_type_id}`,
            qty: 1,
            slot: 'hull',
          },
          ...fit.items.map(item => ({
            type_id: item.type_id,
            type_name: names[item.type_id] || `Type ${item.type_id}`,
            qty: item.quantity || 1,
            slot: item.flag || 'unknown',
          })),
        ];
      }
      snapshot.run.implants = implants.map(typeId => ({
        type_id: typeId,
        type_name: names[typeId] || `Type ${typeId}`,
      }));
      snapshot.run.fitCaptured = Boolean(fit || implants.length);
      await api.runs.saveActive(snapshot);
    }

    async function beginBackgroundRun(session, observedAt, systemId, systemName, shipTypeId, hullName) {
      if (session.snapshot) return;
      const draft = session.draft || normalizeDraft(session.characterId, null);
      const encounterUid = assignEncounter(systemId, observedAt);
      const snapshot = {
        version: 3,
        state: 'in-abyss',
        run: {
          character_id: session.characterId,
          encounter_uid: encounterUid,
          started_at: observedAt,
          duration: 0,
          tier: draft.tier,
          weather: draft.weather,
          outcome: null,
          system_id: systemId,
          system_name: systemName,
          cargoBefore: draft.cargo_before,
          cargoAfter: '',
          droneBefore: draft.drone_before,
          droneAfter: '',
          hull_name: hullName,
          ship_class: 'Unknown',
          notes: draft.notes,
          tags: draft.tags,
          fitting: [],
          implants: [],
          fitCaptured: false,
          killmailItems: [],
          killmailIds: [],
        },
      };
      session.snapshot = snapshot;
      setStatus(session, 'In Abyss');
      await api.runs.saveActive(snapshot);
      session.captureAttempted = true;
      session.captureInFlight = true;
      void captureRunDetails(session, shipTypeId, snapshot)
        .then(() => emitStatus(session))
        .catch(() => {})
        .finally(() => { session.captureInFlight = false; });
    }

    async function finishBackgroundRun(session, transition) {
      const snapshot = session.snapshot;
      if (!snapshot || snapshot.state !== 'in-abyss') return;
      snapshot.run.duration = Math.max(0, transition.observedAt - snapshot.run.started_at);
      snapshot.run.outcome = transition.outcome;
      snapshot.state = transition.outcome === 'Died' ? 'died' : 'awaiting-cargo';
      setStatus(session, transition.outcome === 'Died' ? 'Died' : 'Needs Cargo');
      await api.runs.saveActive(snapshot);
    }

    async function pollSession(session, currentGeneration) {
      if (
        currentGeneration !== generation
        || Number(getSelectedCharacterId()) === session.characterId
        || !getCapabilities(session.characterId).tracking
        || session.inFlight
        || now() < session.nextPollAt
      ) return;
      session.inFlight = true;
      const interval = Math.max(3, Number.parseInt(getSettings().esi_poll_interval, 10) || 5) * 1000;
      try {
        const [location, ship] = await Promise.all([
          api.esi.getLocation(session.characterId),
          api.esi.getShip(session.characterId),
        ]);
        if (currentGeneration !== generation || Number(getSelectedCharacterId()) === session.characterId) {
          return;
        }
        const systemId = Number(location.solar_system_id);
        const shipTypeId = Number(ship.ship_type_id);
        let hullName = session.lastHullName;
        if (!hullName || shipTypeId !== session.lastShipTypeId) {
          const names = await api.esi.getTypeNames([shipTypeId]);
          hullName = names[shipTypeId] || `Ship ${shipTypeId}`;
        }
        let systemName = session.lastSystemName;
        const inAbyss = systemId >= ABYSSAL_SYSTEM_MIN;
        if (inAbyss) systemName = `Abyssal #${systemId}`;
        else if (!systemName || systemId !== session.lastSystemId) {
          systemName = await api.esi.getSystemName(systemId);
        }
        session.lastShipTypeId = shipTypeId;
        session.lastHullName = hullName;
        session.lastSystemId = systemId;
        session.lastSystemName = systemName;
        if (
          session.snapshot?.state === 'in-abyss'
          && !session.snapshot.run.fitCaptured
          && !session.captureInFlight
          && !session.captureAttempted
        ) {
          session.captureAttempted = true;
          session.captureInFlight = true;
          void captureRunDetails(session, shipTypeId, session.snapshot)
            .then(() => emitStatus(session))
            .catch(() => {})
            .finally(() => { session.captureInFlight = false; });
        }
        const transition = session.transition.observe({
          inAbyss,
          isCapsule: CAPSULE_IDS.has(shipTypeId),
          observedAt: Math.floor(now() / 1000),
        });
        if (transition?.type === 'entered') {
          await beginBackgroundRun(
            session,
            transition.observedAt,
            systemId,
            systemName,
            shipTypeId,
            hullName
          );
        } else if (transition?.type === 'exited') {
          await finishBackgroundRun(session, transition);
        } else if (!session.snapshot) {
          setStatus(session, 'Monitoring');
        }
        session.failureCount = 0;
        session.nextPollAt = now() + interval;
      } catch {
        session.failureCount++;
        setStatus(session, 'Reconnecting');
        session.nextPollAt = now() + runTracking.calculateBackoffDelay(
          interval,
          session.failureCount
        );
      } finally {
        session.inFlight = false;
      }
    }

    async function tick(currentGeneration) {
      if (!running || currentGeneration !== generation) return;
      await Promise.all([...sessions.values()].map(session => (
        pollSession(session, currentGeneration)
      )));
      if (!running || currentGeneration !== generation) return;
      timer = setTimer(() => { void tick(currentGeneration); }, 1000);
    }

    async function refresh({ force = false } = {}) {
      const validIds = new Set(getCharacters().map(character => Number(character.id)));
      for (const id of sessions.keys()) {
        if (!validIds.has(id)) sessions.delete(id);
      }
      await Promise.all([...validIds].map(id => loadSession(id, { force })));
      return true;
    }

    async function refreshCharacter(characterId) {
      return loadSession(characterId, { force: true });
    }

    function updateDraft(draft) {
      const session = sessions.get(Number(draft.character_id)) || createSession(draft.character_id);
      session.draft = { ...draft, tags: [...draft.tags] };
      sessions.set(session.characterId, session);
    }

    async function start() {
      generation++;
      const currentGeneration = generation;
      running = true;
      await refresh({ force: true });
      await tick(currentGeneration);
    }

    function stop() {
      running = false;
      generation++;
      if (timer !== null) clearTimer(timer);
      timer = null;
    }

    function statusFor(characterId) {
      return sessions.get(Number(characterId))?.status || 'Monitoring';
    }

    function pollNow() {
      return Promise.all([...sessions.values()].map(session => pollSession(session, generation)));
    }

    return Object.freeze({
      assignEncounter,
      candidateGroupForRun,
      confirmGroupCandidate,
      dismissGroupCandidate,
      groupForRun,
      pollNow,
      refresh,
      refreshCharacter,
      start,
      statusFor,
      stop,
      updateDraft,
    });
  }

  return Object.freeze({ createConcurrentTrackingController });
});
