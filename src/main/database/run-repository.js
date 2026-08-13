const { createFitRepository } = require('./fit-repository');
const { runInTransaction } = require('./transaction');
function createRunRepository(getDb) {
  const fitRepository = createFitRepository(getDb);
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

  function escapeLike(value) {
    return '%' + String(value).replace(/[\\%_]/g, '\\$&') + '%';
  }

  function attachRunMetadata(runs, filters = {}) {
    if (runs.length === 0) return runs;
    const connection = database();
    const runMap = new Map(runs.map(run => {
      run.tags = [];
      run.matching_items = [];
      return [Number(run.id), run];
    }));
    const placeholders = runs.map(() => '?').join(',');
    const runIds = runs.map(run => run.id);

    const tagRows = connection.prepare(
      'SELECT run_id, tag FROM run_tags WHERE run_id IN (' + placeholders + ') '
      + 'ORDER BY tag COLLATE NOCASE'
    ).all(...runIds);
    for (const row of tagRows) runMap.get(Number(row.run_id))?.tags.push(row.tag);

    if (filters.search) {
      let query = 'SELECT DISTINCT run_id, item_name, type FROM run_items '
        + 'WHERE run_id IN (' + placeholders + ') '
        + "AND item_name LIKE ? ESCAPE '\\' COLLATE NOCASE";
      const params = [...runIds, escapeLike(filters.search)];
      query += ' ORDER BY type, item_name COLLATE NOCASE';
      for (const row of connection.prepare(query).all(...params)) {
        runMap.get(Number(row.run_id))?.matching_items.push({
          item_name: row.item_name,
          type: row.type,
        });
      }
    }

    return runs;
  }

  function saveRun(runData) {
    const connection = database();
    const {
      character_id, started_at, duration, tier, weather, outcome,
      loot_value, consumed_cost, net_isk, total_loss, system_id, system_name,
      cargo_before, cargo_after, drone_before, drone_after, hull_name, ship_class, notes,
      tags = [], killmail_ids = [], appraised_at = null,
      items = [], fitting = [], implants = []
    } = runData;

    const insertRun = connection.prepare(
      'INSERT INTO runs (character_id, started_at, duration, tier, weather, outcome, '
      + 'loot_value, consumed_cost, net_isk, total_loss, system_id, system_name, '
      + 'cargo_before, cargo_after, drone_before, drone_after, hull_name, ship_class, '
      + 'fit_identity_id, notes, appraised_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertItem = connection.prepare(
      'INSERT INTO run_items '
      + '(run_id, item_name, qty, type, unit_price_buy, unit_price_sell) '
      + 'VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertFitting = connection.prepare(
      'INSERT INTO run_fitting '
      + '(run_id, type_id, type_name, qty, slot, unit_price_sell) '
      + 'VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertImplant = connection.prepare(
      'INSERT INTO run_implants '
      + '(run_id, type_id, type_name, slot, unit_price_sell) '
      + 'VALUES (?, ?, ?, ?, ?)'
    );

    return runInTransaction(connection, () => {
      const fitIdentity = fitRepository.ensureIdentity(fitting, implants);
      const info = insertRun.run(
        character_id, started_at, duration, tier, weather, outcome,
        loot_value || 0, consumed_cost || 0, net_isk || 0, total_loss || 0,
        system_id, system_name || null,
        cargo_before || null, cargo_after || null,
        drone_before || null, drone_after || null,
        hull_name || null, ship_class || null, fitIdentity?.id || null,
        notes || null, appraised_at
      );
      const runId = info.lastInsertRowid;

      for (const item of items) {
        insertItem.run(
          runId,
          item.item_name,
          item.qty,
          item.type,
          item.unit_price_buy || 0,
          item.unit_price_sell || 0
        );
      }
      for (const fittedItem of fitting) {
        insertFitting.run(
          runId,
          fittedItem.type_id,
          fittedItem.type_name,
          fittedItem.qty || 1,
          fittedItem.slot || null,
          fittedItem.unit_price_sell || 0
        );
      }
      for (const implant of implants) {
        insertImplant.run(
          runId,
          implant.type_id,
          implant.type_name,
          implant.slot || null,
          implant.unit_price_sell || 0
        );
      }
      replaceRunTags(runId, tags);
      replaceRunKillmails(runId, killmail_ids);
      return runId;
    });


  }
  function saveActiveRun(snapshot) {
    database().prepare(
      'INSERT INTO active_run_state (character_id, snapshot, updated_at) '
      + "VALUES (?, ?, strftime('%s','now')) "
      + 'ON CONFLICT(character_id) DO UPDATE SET '
      + 'snapshot = excluded.snapshot, updated_at = excluded.updated_at'
    ).run(snapshot.run.character_id, JSON.stringify(snapshot));
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

  function clearActiveRun(characterId) {
    database().prepare('DELETE FROM active_run_state WHERE character_id = ?').run(characterId);
    return true;
  }

  function completeActiveRun(runData) {
    const connection = database();
    return runInTransaction(connection, () => {
      const existing = connection.prepare(
        'SELECT id FROM runs WHERE character_id = ? AND started_at = ? LIMIT 1'
      ).get(runData.character_id, runData.started_at);
      const runId = existing ? existing.id : saveRun(runData);
      clearActiveRun(runData.character_id);
      return runId;
    });
  }

  function getRuns(filters = {}) {
    let query = 'SELECT r.*, c.name AS character_name, '
      + 'fi.signature_hash AS fit_key, fi.display_name AS fit_display_name '
      + 'FROM runs r JOIN characters c ON r.character_id = c.id '
      + 'LEFT JOIN fit_identities fi ON fi.id = r.fit_identity_id WHERE 1=1';
    const params = [];

    if (filters.character_id) {
      query += ' AND r.character_id = ?';
      params.push(filters.character_id);
    }
    if (filters.tier) {
      query += ' AND r.tier = ?';
      params.push(filters.tier);
    }
    if (filters.weather) {
      query += ' AND r.weather = ?';
      params.push(filters.weather);
    }
    if (filters.outcome) {
      query += ' AND r.outcome = ?';
      params.push(filters.outcome);
    }
    if (filters.date_from != null) {
      query += ' AND r.started_at >= ?';
      params.push(filters.date_from);
    }
    if (filters.date_to != null) {
      query += ' AND r.started_at < ?';
      params.push(filters.date_to);
    }
    if (filters.hull) {
      const hullLike = escapeLike(filters.hull);
      query += " AND (r.hull_name LIKE ? ESCAPE '\\' COLLATE NOCASE "
        + "OR r.ship_class LIKE ? ESCAPE '\\' COLLATE NOCASE)";
      params.push(hullLike, hullLike);
    }
    if (filters.hull_name) {
      query += ' AND r.hull_name = ? COLLATE NOCASE';
      params.push(filters.hull_name);
    }
    if (filters.ship_class) {
      query += ' AND r.ship_class = ?';
      params.push(filters.ship_class);
    }
    if (filters.fit_identity_id != null) {
      query += ' AND r.fit_identity_id = ?';
      params.push(filters.fit_identity_id);
    }
    if (filters.tag) {
      query += ' AND EXISTS (SELECT 1 FROM run_tags selected_tag '
        + 'WHERE selected_tag.run_id = r.id AND selected_tag.tag = ? COLLATE NOCASE)';
      params.push(filters.tag);
    }
    if (filters.search) {
      const searchLike = escapeLike(filters.search);
      const searchClauses = [
        "COALESCE(r.notes, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(r.hull_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(r.ship_class, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(r.system_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(fi.display_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "c.name LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "CAST(COALESCE(r.system_id, '') AS TEXT) LIKE ? ESCAPE '\\'",
        'EXISTS (SELECT 1 FROM run_tags search_tag WHERE search_tag.run_id = r.id '
          + "AND search_tag.tag LIKE ? ESCAPE '\\' COLLATE NOCASE)",
        'EXISTS (SELECT 1 FROM run_items search_item WHERE search_item.run_id = r.id '
          + "AND search_item.item_name LIKE ? ESCAPE '\\' COLLATE NOCASE)",
        'EXISTS (SELECT 1 FROM run_killmails search_killmail '
          + 'WHERE search_killmail.run_id = r.id '
          + "AND CAST(search_killmail.killmail_id AS TEXT) LIKE ? ESCAPE '\\')",
      ];
      query += ' AND (' + searchClauses.join(' OR ') + ')';
      params.push(
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike,
        searchLike
      );
    }

    query += ' ORDER BY r.started_at DESC, r.id DESC';
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const runs = database().prepare(query).all(...params);
    return attachRunMetadata(runs, filters);
  }

  function getRunById(runId) {
    const connection = database();
    const run = connection.prepare(
      'SELECT r.*, c.name AS character_name, '
      + 'fi.signature_hash AS fit_key, fi.display_name AS fit_display_name '
      + 'FROM runs r JOIN characters c ON r.character_id = c.id '
      + 'LEFT JOIN fit_identities fi ON fi.id = r.fit_identity_id WHERE r.id = ?'
    ).get(runId);
    if (!run) return null;

    run.items = connection.prepare(
      'SELECT * FROM run_items WHERE run_id = ? ORDER BY type, item_name'
    ).all(runId);
    run.fitting = connection.prepare(
      'SELECT * FROM run_fitting WHERE run_id = ? ORDER BY slot, type_name'
    ).all(runId);
    run.implants = connection.prepare(
      'SELECT * FROM run_implants WHERE run_id = ? ORDER BY slot'
    ).all(runId);
    run.tags = connection.prepare(
      'SELECT tag FROM run_tags WHERE run_id = ? ORDER BY tag COLLATE NOCASE'
    ).all(runId).map(row => row.tag);
    run.killmail_ids = connection.prepare(
      'SELECT killmail_id FROM run_killmails WHERE run_id = ? ORDER BY killmail_id'
    ).all(runId).map(row => row.killmail_id);

    return run;
  }

  function deleteRun(runId) {
    database().prepare('DELETE FROM runs WHERE id = ?').run(runId);
    return true;
  }

  function setFitDisplayName(fitIdentityId, displayName) {
    return fitRepository.setDisplayName(fitIdentityId, displayName);
  }

  function requireUpdatedRun(result) {
    if (result.changes !== 1) throw new Error('Run not found');
  }

  function applyCargoUpdate(runId, {
    cargo_before,
    cargo_after,
    drone_before,
    drone_after,
  }) {
    const result = database().prepare(
      'UPDATE runs SET cargo_before = ?, cargo_after = ?, '
      + 'drone_before = ?, drone_after = ? WHERE id = ?'
    ).run(
      cargo_before || null,
      cargo_after || null,
      drone_before || null,
      drone_after || null,
      runId
    );
    requireUpdatedRun(result);
  }

  function applyMetaUpdate(runId, {
    tier,
    weather,
    outcome,
    duration,
    started_at,
    total_loss,
    hull_name,
    ship_class,
    system_id,
    system_name,
    notes,
    tags,
  }) {
    const result = database().prepare(
      'UPDATE runs SET tier = ?, weather = ?, outcome = ?, duration = ?, '
      + 'started_at = ?, total_loss = ?, '
      + 'hull_name = COALESCE(?, hull_name), ship_class = COALESCE(?, ship_class), '
      + 'system_id = COALESCE(?, system_id), system_name = COALESCE(?, system_name), '
      + 'notes = COALESCE(?, notes) WHERE id = ?'
    ).run(
      tier,
      weather,
      outcome,
      duration,
      started_at,
      total_loss || 0,
      hull_name,
      ship_class,
      system_id,
      system_name,
      notes,
      runId
    );
    requireUpdatedRun(result);
    if (tags !== null && tags !== undefined) replaceRunTags(runId, tags);
  }

  function applyAppraisalUpdate(runId, {
    loot_value,
    consumed_cost,
    net_isk,
    cargo_before,
    cargo_after,
    drone_before,
    drone_after,
    items,
    appraised_at,
  }) {
    const connection = database();
    const result = connection.prepare(
      'UPDATE runs SET loot_value = ?, consumed_cost = ?, net_isk = ?, '
      + 'cargo_before = ?, cargo_after = ?, '
      + 'drone_before = COALESCE(?, drone_before), '
      + 'drone_after = COALESCE(?, drone_after), '
      + "appraised_at = COALESCE(?, strftime('%s','now')) WHERE id = ?"
    ).run(
      loot_value,
      consumed_cost,
      net_isk,
      cargo_before,
      cargo_after,
      drone_before,
      drone_after,
      appraised_at,
      runId
    );
    requireUpdatedRun(result);

    connection.prepare('DELETE FROM run_items WHERE run_id = ?').run(runId);
    const insertItem = connection.prepare(
      'INSERT INTO run_items '
      + '(run_id, item_name, qty, type, unit_price_buy, unit_price_sell) '
      + 'VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const item of items) {
      insertItem.run(
        runId,
        item.item_name,
        item.qty,
        item.type,
        item.unit_price_buy || 0,
        item.unit_price_sell || 0
      );
    }
  }

  function updateAppraisal(runId, appraisal) {
    const connection = database();
    runInTransaction(connection, () => applyAppraisalUpdate(runId, appraisal));
    return true;
  }

  function updateRun(runId, { meta, cargo, appraisal }) {
    const hasCargo = cargo !== null && cargo !== undefined;
    const hasAppraisal = appraisal !== null && appraisal !== undefined;
    if (hasCargo === hasAppraisal) {
      throw new TypeError('Run update requires exactly one cargo or appraisal update');
    }
    const connection = database();
    runInTransaction(connection, () => {
      applyMetaUpdate(runId, meta);
      if (hasAppraisal) applyAppraisalUpdate(runId, appraisal);
      else applyCargoUpdate(runId, cargo);
    });
    return true;
  }

  return {
    clearActiveRun,
    completeActiveRun,
    deleteRun,
    getActiveRun,
    getRunById,
    getRuns,
    saveActiveRun,
    saveRun,
    setFitDisplayName,
    updateAppraisal,
    updateRun,
  };
}

module.exports = { createRunRepository };
