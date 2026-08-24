const INVENTORY_FIELDS = Object.freeze([
  Object.freeze({ field: 'cargo_before', phase: 'before', location: 'cargo' }),
  Object.freeze({ field: 'cargo_after', phase: 'after', location: 'cargo' }),
  Object.freeze({ field: 'drone_before', phase: 'before', location: 'drone' }),
  Object.freeze({ field: 'drone_after', phase: 'after', location: 'drone' }),
]);

function createRunQueryRepository(getDb) {
  function database() {
    const connection = getDb();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function escapeLike(value) {
    return '%' + String(value).replace(/[\\%_]/g, '\\$&') + '%';
  }

  function baseRunSelect() {
    return `
      SELECT r.*, c.name AS character_name,
        fs.fit_identity_id,
        fi.signature_hash AS fit_key,
        fi.display_name AS fit_display_name,
        a.id AS appraisal_id,
        a.source AS appraisal_source,
        a.provider AS appraisal_provider,
        a.resolution_status AS appraisal_resolution_status,
        a.loot_value, a.consumed_cost, a.net_isk, a.total_loss, a.appraised_at
      FROM runs r
      JOIN characters c ON r.character_id = c.id
      JOIN appraisals a ON a.run_id = r.id AND a.is_current = 1
      LEFT JOIN fit_snapshots fs ON fs.id = r.fit_snapshot_id
      LEFT JOIN fit_identities fi ON fi.id = fs.fit_identity_id
    `;
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
    for (const row of connection.prepare(
      `SELECT run_id, tag FROM run_tags WHERE run_id IN (${placeholders})
       ORDER BY tag COLLATE NOCASE`
    ).all(...runIds)) {
      runMap.get(Number(row.run_id))?.tags.push(row.tag);
    }
    if (filters.drop_item_name) {
      for (const run of runs) {
        run.matching_items.push({ item_name: filters.drop_item_name, type: 'gained' });
      }
    }
    if (filters.search) {
      const rows = connection.prepare(`
        SELECT DISTINCT a.run_id, al.item_name, al.disposition AS type
        FROM appraisal_lines al
        JOIN appraisals a ON a.id = al.appraisal_id AND a.is_current = 1
        WHERE a.run_id IN (${placeholders})
          AND al.item_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        ORDER BY type, item_name COLLATE NOCASE
      `).all(...runIds, escapeLike(filters.search));
      for (const row of rows) {
        runMap.get(Number(row.run_id))?.matching_items.push({
          item_name: row.item_name,
          type: row.type,
        });
      }
    }
    return runs;
  }

  function getRuns(filters = {}) {
    let query = baseRunSelect() + ' WHERE 1=1';
    const params = [];
    const equalityFilters = [
      ['character_id', 'r.character_id'],
      ['tier', 'r.tier'],
      ['weather', 'r.weather'],
      ['outcome', 'r.outcome'],
      ['hull_name', 'r.hull_name'],
      ['ship_class', 'r.ship_class'],
      ['fit_identity_id', 'fs.fit_identity_id'],
    ];
    for (const [filter, column] of equalityFilters) {
      if (filters[filter] !== undefined && filters[filter] !== null && filters[filter] !== '') {
        query += ` AND ${column} = ?${filter === 'hull_name' ? ' COLLATE NOCASE' : ''}`;
        params.push(filters[filter]);
      }
    }
    if (filters.date_from != null) {
      query += ' AND r.started_at >= ?';
      params.push(filters.date_from);
    }
    if (filters.date_to != null) {
      query += ' AND r.started_at < ?';
      params.push(filters.date_to);
    }
    const hullFilter = filters.hull || filters.ship;
    if (hullFilter) {
      const hullLike = escapeLike(hullFilter);
      query += " AND (r.hull_name LIKE ? ESCAPE '\\' COLLATE NOCASE "
        + "OR r.ship_class LIKE ? ESCAPE '\\' COLLATE NOCASE)";
      params.push(hullLike, hullLike);
    }
    if (filters.tag) {
      query += ` AND EXISTS (
        SELECT 1 FROM run_tags selected_tag
        WHERE selected_tag.run_id = r.id AND selected_tag.tag = ? COLLATE NOCASE
      )`;
      params.push(filters.tag);
    }
    if (filters.drop_item_name) {
      query += ` AND r.outcome = 'Survived'
        AND EXISTS (
          SELECT 1 FROM inventory_snapshots observed_before
          WHERE observed_before.run_id = r.id
            AND observed_before.phase = 'before'
            AND observed_before.location = 'cargo'
            AND observed_before.parse_status = 'complete'
        )
        AND EXISTS (
          SELECT 1 FROM inventory_snapshots observed_after
          WHERE observed_after.run_id = r.id
            AND observed_after.phase = 'after'
            AND observed_after.location = 'cargo'
            AND observed_after.parse_status = 'complete'
        )
        AND COALESCE((
          SELECT SUM(after_item.qty)
          FROM inventory_snapshots after_snapshot
          JOIN inventory_snapshot_items after_item
            ON after_item.snapshot_id = after_snapshot.id
          WHERE after_snapshot.run_id = r.id
            AND after_snapshot.phase = 'after'
            AND after_snapshot.location = 'cargo'
            AND after_snapshot.parse_status = 'complete'
            AND after_item.item_name = ? COLLATE NOCASE
        ), 0) > COALESCE((
          SELECT SUM(before_item.qty)
          FROM inventory_snapshots before_snapshot
          JOIN inventory_snapshot_items before_item
            ON before_item.snapshot_id = before_snapshot.id
          WHERE before_snapshot.run_id = r.id
            AND before_snapshot.phase = 'before'
            AND before_snapshot.location = 'cargo'
            AND before_snapshot.parse_status = 'complete'
            AND before_item.item_name = ? COLLATE NOCASE
        ), 0)`;
      params.push(filters.drop_item_name, filters.drop_item_name);
    }
    if (filters.search) {
      const searchLike = escapeLike(filters.search);
      const clauses = [
        "COALESCE(r.notes, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(r.hull_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(r.ship_class, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(r.system_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "COALESCE(fi.display_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "c.name LIKE ? ESCAPE '\\' COLLATE NOCASE",
        "CAST(COALESCE(r.system_id, '') AS TEXT) LIKE ? ESCAPE '\\'",
        `EXISTS (SELECT 1 FROM run_tags search_tag WHERE search_tag.run_id = r.id
          AND search_tag.tag LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
        `EXISTS (SELECT 1 FROM appraisal_lines search_line
          WHERE search_line.appraisal_id = a.id
          AND search_line.item_name LIKE ? ESCAPE '\\' COLLATE NOCASE)`,
        `EXISTS (SELECT 1 FROM run_killmails search_killmail
          WHERE search_killmail.run_id = r.id
          AND CAST(search_killmail.killmail_id AS TEXT) LIKE ? ESCAPE '\\')`,
      ];
      query += ' AND (' + clauses.join(' OR ') + ')';
      params.push(...Array(clauses.length).fill(searchLike));
    }
    query += ' ORDER BY r.started_at DESC, r.id DESC';
    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }
    return attachRunMetadata(database().prepare(query).all(...params), filters);
  }

  function inventoryValues(connection, runId) {
    const values = Object.fromEntries(INVENTORY_FIELDS.map(({ field }) => [field, null]));
    const definitions = new Map(
      INVENTORY_FIELDS.map(definition => [`${definition.phase}:${definition.location}`, definition.field])
    );
    for (const row of connection.prepare(`
      SELECT phase, location, raw_text FROM inventory_snapshots WHERE run_id = ?
    `).all(runId)) {
      const field = definitions.get(`${row.phase}:${row.location}`);
      if (field) values[field] = row.raw_text;
    }
    return values;
  }

  function referencePriceSql(disposition) {
    return `COALESCE((
      SELECT MAX(al.unit_price_sell) FROM appraisal_lines al
      WHERE al.appraisal_id = ? AND al.disposition = '${disposition}'
        AND ((al.type_id IS NOT NULL AND al.type_id = snapshot_item.type_id)
          OR (al.type_id IS NULL AND al.item_name = snapshot_item.type_name COLLATE NOCASE))
    ), 0)`;
  }

  function getRunById(runId) {
    const connection = database();
    const run = connection.prepare(baseRunSelect() + ' WHERE r.id = ?').get(runId);
    if (!run) return null;
    Object.assign(run, inventoryValues(connection, runId));
    run.items = connection.prepare(`
      SELECT al.id, al.item_name, al.qty, al.disposition AS type,
        al.unit_price_buy, al.unit_price_sell
      FROM appraisal_lines al
      WHERE al.appraisal_id = ? AND al.disposition IN ('gained', 'consumed', 'lost')
      ORDER BY al.disposition, al.item_name
    `).all(run.appraisal_id);
    run.fitting = connection.prepare(`
      SELECT snapshot_item.id, snapshot_item.type_id, snapshot_item.type_name,
        snapshot_item.qty, NULLIF(snapshot_item.slot, '') AS slot,
        ${referencePriceSql('fitted')} AS unit_price_sell
      FROM fit_snapshot_items snapshot_item
      WHERE snapshot_item.snapshot_id = ?
      ORDER BY snapshot_item.slot, snapshot_item.type_name
    `).all(run.appraisal_id, run.fit_snapshot_id);
    run.implants = connection.prepare(`
      SELECT snapshot_item.id, snapshot_item.type_id, snapshot_item.type_name,
        NULLIF(snapshot_item.slot, '') AS slot,
        ${referencePriceSql('implant')} AS unit_price_sell
      FROM fit_snapshot_implants snapshot_item
      WHERE snapshot_item.snapshot_id = ?
      ORDER BY CAST(snapshot_item.slot AS INTEGER), snapshot_item.type_name
    `).all(run.appraisal_id, run.fit_snapshot_id);
    run.tags = connection.prepare(`
      SELECT tag FROM run_tags WHERE run_id = ? ORDER BY tag COLLATE NOCASE
    `).all(runId).map(row => row.tag);
    run.killmail_ids = connection.prepare(`
      SELECT killmail_id FROM run_killmails WHERE run_id = ? ORDER BY killmail_id
    `).all(runId).map(row => row.killmail_id);
    return run;
  }

  function getAppraisalHistory(runId) {
    const connection = database();
    if (!connection.prepare('SELECT 1 FROM runs WHERE id = ?').get(runId)) {
      throw new Error('Run not found');
    }
    return connection.prepare(`
      SELECT id, format_version, kind, source, provider, appraised_at,
        resolution_status, loot_value, consumed_cost, net_isk, total_loss,
        is_current, created_at,
        (SELECT COUNT(*) FROM appraisal_lines line WHERE line.appraisal_id = appraisals.id)
          AS line_count
      FROM appraisals WHERE run_id = ?
      ORDER BY COALESCE(appraised_at, created_at) DESC, id DESC
    `).all(runId);
  }

  return Object.freeze({ getAppraisalHistory, getRunById, getRuns });
}

module.exports = { createRunQueryRepository };
