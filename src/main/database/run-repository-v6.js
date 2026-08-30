const {
  createAppraisalRecord,
  createInventorySnapshot,
} = require('../../shared/data-model-v6');
const { createFitRepository } = require('./fit-repository-v6');
const { createEncounterRepository } = require('./encounter-repository');
const { createRunQueryRepository } = require('./run-query-repository-v6');
const { runInTransaction } = require('./transaction');
const { createNewRunUid } = require('./v6-identities');

const INVENTORY_FIELDS = Object.freeze([
  Object.freeze({ field: 'cargo_before', phase: 'before', location: 'cargo' }),
  Object.freeze({ field: 'cargo_after', phase: 'after', location: 'cargo' }),
  Object.freeze({ field: 'drone_before', phase: 'before', location: 'drone' }),
  Object.freeze({ field: 'drone_after', phase: 'after', location: 'drone' }),
]);

function createRunRepository(getDb) {
  const fitRepository = createFitRepository(getDb);
  const encounters = createEncounterRepository(getDb);
  const queries = createRunQueryRepository(getDb);

  function database() {
    const connection = getDb();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function replaceRunTags(runId, tags) {
    const connection = database();
    connection.prepare('DELETE FROM run_tags WHERE run_id = ?').run(runId);
    const insert = connection.prepare('INSERT INTO run_tags (run_id, tag) VALUES (?, ?)');
    for (const tag of tags) insert.run(runId, tag);
  }

  function replaceRunKillmails(runId, killmailIds) {
    const connection = database();
    connection.prepare('DELETE FROM run_killmails WHERE run_id = ?').run(runId);
    const insert = connection.prepare(
      'INSERT INTO run_killmails (run_id, killmail_id) VALUES (?, ?)'
    );
    for (const killmailId of killmailIds) insert.run(runId, killmailId);
  }

  function upsertInventorySnapshot(runId, definition, rawText, capturedAt = null) {
    if (rawText === undefined || rawText === null) return;
    const connection = database();
    const snapshot = createInventorySnapshot({
      rawText,
      phase: definition.phase,
      location: definition.location,
      capturedAt,
    });
    const existing = connection.prepare(`
      SELECT id FROM inventory_snapshots
      WHERE run_id = ? AND phase = ? AND location = ?
    `).get(runId, definition.phase, definition.location);
    let snapshotId;
    if (existing) {
      snapshotId = existing.id;
      connection.prepare(`
        UPDATE inventory_snapshots SET
          format_version = ?, raw_text = ?, captured_at = ?, parse_status = ?,
          parse_error_code = ?, created_at = strftime('%s','now')
        WHERE id = ?
      `).run(
        snapshot.format_version,
        snapshot.raw_text,
        snapshot.captured_at,
        snapshot.parse_status,
        snapshot.parse_error_code,
        snapshotId
      );
      connection.prepare(
        'DELETE FROM inventory_snapshot_items WHERE snapshot_id = ?'
      ).run(snapshotId);
    } else {
      snapshotId = connection.prepare(`
        INSERT INTO inventory_snapshots
          (run_id, format_version, phase, location, raw_text, captured_at,
           parse_status, parse_error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        snapshot.format_version,
        snapshot.phase,
        snapshot.location,
        snapshot.raw_text,
        snapshot.captured_at,
        snapshot.parse_status,
        snapshot.parse_error_code
      ).lastInsertRowid;
    }
    const insertItem = connection.prepare(`
      INSERT INTO inventory_snapshot_items (snapshot_id, type_id, item_name, qty)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of snapshot.items) {
      insertItem.run(snapshotId, item.type_id, item.item_name, item.qty);
    }
  }

  function applyInventoryFields(runId, values, capturedAt = null) {
    for (const definition of INVENTORY_FIELDS) {
      upsertInventorySnapshot(runId, definition, values[definition.field], capturedAt);
    }
  }

  function fittingReferenceLines(fitting, implants) {
    return [
      ...fitting.map(item => ({
        type_id: item.type_id,
        item_name: item.type_name,
        qty: item.qty || 1,
        type: 'fitted',
        unit_price_buy: 0,
        unit_price_sell: item.unit_price_sell || 0,
      })),
      ...implants.map(item => ({
        type_id: item.type_id,
        item_name: item.type_name,
        qty: item.qty || 1,
        type: 'implant',
        unit_price_buy: 0,
        unit_price_sell: item.unit_price_sell || 0,
      })),
    ];
  }

  function inferAppraisalOrigin(run, explicitSource, explicitProvider) {
    if (explicitSource || explicitProvider) {
      return {
        source: explicitSource || 'manual',
        provider: explicitProvider || 'manual',
      };
    }
    if (run.outcome === 'Died' && (run.killmail_ids || []).length > 0) {
      return { source: 'killmail', provider: 'esi' };
    }
    if (run.appraised_at != null) return { source: 'janice', provider: 'janice' };
    return { source: 'manual', provider: 'manual' };
  }

  function insertAppraisal(runId, run, items, {
    source,
    provider,
    appraisedAt = run.appraised_at ?? null,
    createdAt = null,
  } = {}) {
    const connection = database();
    const origin = inferAppraisalOrigin(run, source, provider);
    const appraisal = createAppraisalRecord({
      run,
      items,
      source: origin.source,
      provider: origin.provider,
      appraisedAt,
    });
    connection.prepare('UPDATE appraisals SET is_current = 0 WHERE run_id = ?').run(runId);
    const appraisalId = connection.prepare(`
      INSERT INTO appraisals
        (run_id, format_version, kind, source, provider, appraised_at,
         resolution_status, loot_value, consumed_cost, net_isk, total_loss,
         is_current, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE(?, strftime('%s','now')))
    `).run(
      runId,
      appraisal.format_version,
      appraisal.kind,
      appraisal.source,
      appraisal.provider,
      appraisal.appraised_at,
      appraisal.resolution_status,
      appraisal.loot_value,
      appraisal.consumed_cost,
      appraisal.net_isk,
      appraisal.total_loss,
      createdAt
    ).lastInsertRowid;
    const insertLine = connection.prepare(`
      INSERT INTO appraisal_lines
        (appraisal_id, type_id, item_name, qty, disposition,
         unit_price_buy, unit_price_sell)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of appraisal.lines) {
      insertLine.run(
        appraisalId,
        line.type_id,
        line.item_name,
        line.qty,
        line.disposition,
        line.unit_price_buy,
        line.unit_price_sell
      );
    }
    return appraisalId;
  }

  function saveRun(runData, { runUid = null, createdAt = null } = {}) {
    const connection = database();
    const {
      character_id, started_at, duration, tier, weather, outcome,
      system_id, system_name, hull_name, ship_class, notes,
      tags = [], killmail_ids = [], items = [], fitting = [], implants = [],
    } = runData;

    return runInTransaction(connection, () => {
      const encounter = encounters.ensure(runData, runData.encounter_uid, createdAt);
      encounters.assertParticipantAllowed(encounter.id, ship_class);
      const fitSnapshot = fitRepository.ensureSnapshot(fitting, implants, hull_name);
      const info = connection.prepare(`
        INSERT INTO runs
          (run_uid, character_id, started_at, duration, tier, weather, outcome,
           system_id, system_name, hull_name, ship_class, fit_snapshot_id, notes,
           created_at, encounter_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          COALESCE(?, strftime('%s','now')), ?)
      `).run(
        runUid || createNewRunUid(),
        character_id,
        started_at,
        duration,
        tier,
        weather,
        outcome,
        system_id,
        system_name || null,
        hull_name || null,
        ship_class || null,
        fitSnapshot?.id || null,
        notes || null,
        createdAt,
        encounter.id
      );
      const runId = info.lastInsertRowid;
      applyInventoryFields(runId, runData, runData.appraised_at ?? null);
      insertAppraisal(
        runId,
        runData,
        [...items, ...fittingReferenceLines(fitting, implants)],
        {
          source: runData.appraisal_source,
          provider: runData.appraisal_provider,
          createdAt,
        }
      );
      replaceRunTags(runId, tags);
      replaceRunKillmails(runId, killmail_ids);
      return runId;
    });
  }

  function saveActiveRun(snapshot) {
    database().prepare(`
      INSERT INTO active_run_state (character_id, snapshot, updated_at)
      VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(character_id) DO UPDATE SET
        snapshot = excluded.snapshot, updated_at = excluded.updated_at
    `).run(snapshot.run.character_id, JSON.stringify(snapshot));
    return true;
  }

  function getActiveRun(characterId) {
    const row = database().prepare(
      'SELECT snapshot FROM active_run_state WHERE character_id = ?'
    ).get(characterId);
    if (!row) return null;
    try {
      return JSON.parse(row.snapshot);
    } catch {
      clearActiveRun(characterId);
      return null;
    }
  }

  function saveEncounter(participants) {
    const connection = database();
    const encounterUid = createNewRunUid();
    return runInTransaction(connection, () => participants.map(participant => (
      saveRun({ ...participant, encounter_uid: encounterUid })
    )));
  }

  function clearActiveRun(characterId) {
    database().prepare('DELETE FROM active_run_state WHERE character_id = ?').run(characterId);
    return true;
  }

  function completeActiveRun(runData) {
    const connection = database();
    return runInTransaction(connection, () => {
      const existing = connection.prepare(`
        SELECT id FROM runs WHERE character_id = ? AND started_at = ? LIMIT 1
      `).get(runData.character_id, runData.started_at);
      const runId = existing ? existing.id : saveRun(runData);
      clearActiveRun(runData.character_id);
      return runId;
    });
  }

  function deleteRun(runId) {
    const connection = database();
    return runInTransaction(connection, () => {
      const run = connection.prepare('SELECT encounter_id FROM runs WHERE id = ?').get(runId);
      if (!run) return true;
      connection.prepare('DELETE FROM runs WHERE id = ?').run(runId);
      encounters.deleteIfEmpty(run.encounter_id);
      return true;
    });
  }

  function setFitDisplayName(fitIdentityId, displayName) {
    return fitRepository.setDisplayName(fitIdentityId, displayName);
  }

  function requireUpdatedRun(result) {
    if (result.changes !== 1) throw new Error('Run not found');
  }

  function applyCargoUpdate(runId, cargo) {
    if (!database().prepare('SELECT 1 FROM runs WHERE id = ?').get(runId)) {
      throw new Error('Run not found');
    }
    applyInventoryFields(runId, cargo);
  }

  function cloneCurrentAppraisal(runId, { outcome, totalLoss }) {
    const connection = database();
    const current = connection.prepare(`
      SELECT * FROM appraisals WHERE run_id = ? AND is_current = 1
    `).get(runId);
    if (!current) throw new Error('Run has no current appraisal');
    const nextKind = outcome === 'Died' ? 'loss' : 'survived';
    const nextLoss = Number(totalLoss || 0);
    if (current.kind === nextKind && current.total_loss === nextLoss) return;
    const lines = connection.prepare(`
      SELECT type_id, item_name, qty, disposition AS type,
        unit_price_buy, unit_price_sell
      FROM appraisal_lines WHERE appraisal_id = ? ORDER BY id
    `).all(current.id);
    insertAppraisal(runId, {
      outcome,
      loot_value: current.loot_value,
      consumed_cost: current.consumed_cost,
      net_isk: current.net_isk,
      total_loss: nextLoss,
      appraised_at: current.appraised_at,
    }, lines, {
      source: current.source,
      provider: current.provider,
      appraisedAt: current.appraised_at,
    });
  }

  function applyMetaUpdate(runId, meta, { cloneAppraisal = true } = {}) {
    const encounter = database().prepare(
      'SELECT encounter_id FROM runs WHERE id = ?'
    ).get(runId);
    if (encounter) {
      encounters.assertParticipantAllowed(encounter.encounter_id, meta.ship_class, {
        excludeRunId: runId,
      });
    }
    const result = database().prepare(`
      UPDATE runs SET tier = ?, weather = ?, outcome = ?, duration = ?,
        started_at = ?, hull_name = COALESCE(?, hull_name),
        ship_class = COALESCE(?, ship_class), system_id = COALESCE(?, system_id),
        system_name = COALESCE(?, system_name), notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(
      meta.tier,
      meta.weather,
      meta.outcome,
      meta.duration,
      meta.started_at,
      meta.hull_name,
      meta.ship_class,
      meta.system_id,
      meta.system_name,
      meta.notes,
      runId
    );
    requireUpdatedRun(result);
    encounters.refresh(encounter.encounter_id);
    if (meta.tags !== null && meta.tags !== undefined) replaceRunTags(runId, meta.tags);
    if (cloneAppraisal) {
      cloneCurrentAppraisal(runId, { outcome: meta.outcome, totalLoss: meta.total_loss });
    }
  }

  function currentFitReferenceLines(runId) {
    return database().prepare(`
      SELECT al.type_id, al.item_name, al.qty, al.disposition AS type,
        al.unit_price_buy, al.unit_price_sell
      FROM appraisal_lines al
      JOIN appraisals a ON a.id = al.appraisal_id
      WHERE a.run_id = ? AND a.is_current = 1
        AND al.disposition IN ('fitted', 'implant')
      ORDER BY al.id
    `).all(runId);
  }

  function applyAppraisalUpdate(runId, appraisal) {
    const connection = database();
    const current = connection.prepare(`
      SELECT r.outcome, a.total_loss
      FROM runs r JOIN appraisals a ON a.run_id = r.id AND a.is_current = 1
      WHERE r.id = ?
    `).get(runId);
    if (!current) throw new Error('Run not found');
    const referenceLines = currentFitReferenceLines(runId);
    applyInventoryFields(runId, appraisal, appraisal.appraised_at ?? null);
    insertAppraisal(runId, {
      outcome: current.outcome,
      loot_value: appraisal.loot_value,
      consumed_cost: appraisal.consumed_cost,
      net_isk: appraisal.net_isk,
      total_loss: appraisal.total_loss ?? current.total_loss,
      appraised_at: appraisal.appraised_at ?? Math.floor(Date.now() / 1000),
    }, [...appraisal.items, ...referenceLines], {
      source: appraisal.appraisal_source || 'janice',
      provider: appraisal.appraisal_provider || 'janice',
      appraisedAt: appraisal.appraised_at ?? Math.floor(Date.now() / 1000),
    });
  }

  function updateAppraisal(runId, appraisal) {
    runInTransaction(database(), () => applyAppraisalUpdate(runId, appraisal));
    return true;
  }

  function updateRun(runId, { meta, cargo, appraisal }) {
    const hasCargo = cargo !== null && cargo !== undefined;
    const hasAppraisal = appraisal !== null && appraisal !== undefined;
    if (hasCargo === hasAppraisal) {
      throw new TypeError('Run update requires exactly one cargo or appraisal update');
    }
    runInTransaction(database(), () => {
      applyMetaUpdate(runId, meta, { cloneAppraisal: !hasAppraisal });
      if (hasAppraisal) {
        applyAppraisalUpdate(runId, { ...appraisal, total_loss: meta.total_loss });
      } else {
        applyCargoUpdate(runId, cargo);
      }
    });
    return true;
  }

  return Object.freeze({
    clearActiveRun,
    completeActiveRun,
    deleteRun,
    getActiveRun,
    getAppraisalHistory: queries.getAppraisalHistory,
    getRunById: queries.getRunById,
    getRuns: queries.getRuns,
    saveActiveRun,
    saveEncounter,
    saveRun,
    setFitDisplayName,
    updateAppraisal,
    updateRun,
  });
}

module.exports = { createRunRepository };
