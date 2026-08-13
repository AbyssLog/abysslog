
function createStatisticsRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Statistics repository requires a connection provider');
  }

  function buildStatsWhere(filters = {}, alias = '') {
    const column = name => alias + name;
    const clauses = [];
    const params = [];
    if (filters.character_id != null) {
      clauses.push(column('character_id') + ' = ?');
      params.push(filters.character_id);
    }
    if (filters.range_start != null) {
      clauses.push(column('started_at') + ' >= ?');
      params.push(filters.range_start);
    }
    if (filters.range_end != null) {
      clauses.push(column('started_at') + ' < ?');
      params.push(filters.range_end);
    }
    return {
      where: clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '',
      params,
    };
  }

  function getFitStats(db, filters) {
    const { where, params } = buildStatsWhere(filters, 'r.');
    return db.prepare([
      'SELECT fi.id AS fit_identity_id, fi.signature_hash AS fit_key,',
      '  MAX(r.id) AS representative_run_id, fi.hull_name, fi.display_name,',
      "  COALESCE(NULLIF(MAX(r.ship_class), ''), 'Unknown') AS ship_class,",
      '  COUNT(*) AS total_runs,',
      "  SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN r.net_isk ELSE -r.total_loss END)",
      '    AS avg_net_isk',
      'FROM runs r',
      'JOIN fit_identities fi ON fi.id = r.fit_identity_id',
      where,
      'GROUP BY fi.id, fi.signature_hash, fi.hull_name, fi.display_name',
      'ORDER BY total_runs DESC, avg_net_isk DESC',
      'LIMIT 20',
    ].filter(Boolean).join('\n')).all(...params);
  }

  function getLatestSession(db, filters) {
    const { where, params } = buildStatsWhere(filters);
    const rows = db.prepare([
      'SELECT id, started_at, duration, outcome, net_isk, total_loss',
      'FROM runs',
      where,
      'ORDER BY started_at DESC, id DESC',
      'LIMIT 100',
    ].filter(Boolean).join('\n')).all(...params);
    if (rows.length === 0) return null;

    const sessionRuns = [rows[0]];
    for (const row of rows.slice(1)) {
      const newer = sessionRuns[sessionRuns.length - 1];
      const gap = newer.started_at - (row.started_at + (row.duration || 0));
      if (gap > 3600) break;
      sessionRuns.push(row);
    }

    const summary = {
      started_at: Math.min(...sessionRuns.map(run => run.started_at)),
      ended_at: Math.max(...sessionRuns.map(run => run.started_at + (run.duration || 0))),
      total_runs: sessionRuns.length,
      survived: 0,
      died: 0,
      total_duration: 0,
      total_net_isk: 0,
      gap_seconds: 3600,
    };
    for (const run of sessionRuns) {
      if (run.outcome === 'Survived') summary.survived++;
      else summary.died++;
      summary.total_duration += run.duration || 0;
      summary.total_net_isk += run.outcome === 'Survived'
        ? run.net_isk || 0
        : -(run.total_loss || 0);
    }
    return summary;
  }
  function getStats(filters = {}) {
    const db = getConnection();
    const { where, params } = buildStatsWhere(filters);

    const overall = db.prepare(`
      SELECT
        COUNT(*) as total_runs,
        SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
        SUM(CASE WHEN outcome = 'Died' THEN 1 ELSE 0 END) as died,
        AVG(CASE WHEN outcome = 'Survived' THEN duration END) as avg_duration_survived,
        AVG(CASE WHEN outcome = 'Survived' THEN net_isk ELSE -total_loss END) as avg_net_isk,
        SUM(CASE WHEN outcome = 'Survived' THEN net_isk ELSE -total_loss END) as total_net_isk,
        AVG(CASE WHEN outcome = 'Died' THEN total_loss END) as avg_loss,
        SUM(CASE WHEN outcome = 'Died' THEN total_loss ELSE 0 END) as total_loss,
        MIN(started_at) as first_run,
        MAX(started_at) as last_run
      FROM runs ${where}
    `).get(...params);

    const byTier = db.prepare(`
      SELECT tier,
        COUNT(*) as total_runs,
        SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
        AVG(CASE WHEN outcome = 'Survived' THEN duration END) as avg_duration,
        AVG(CASE WHEN outcome = 'Survived' THEN net_isk ELSE -total_loss END) as avg_net_isk
      FROM runs ${where}
      GROUP BY tier ORDER BY tier
    `).all(...params);

    const byWeather = db.prepare(`
      SELECT weather,
        COUNT(*) as total_runs,
        SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
        AVG(CASE WHEN outcome = 'Survived' THEN duration END) as avg_duration,
        AVG(CASE WHEN outcome = 'Survived' THEN net_isk ELSE -total_loss END) as avg_net_isk
      FROM runs ${where}
      GROUP BY weather ORDER BY weather
    `).all(...params);

    const hourly = db.prepare(`
      SELECT
        SUM(CASE WHEN outcome = 'Survived' THEN net_isk ELSE -total_loss END) as profit,
        SUM(duration) as duration
      FROM runs
      ${where ? where + ' AND' : 'WHERE'} duration > 0
    `).get(...params);
    const iskPerHour = hourly?.duration > 0 ? hourly.profit / (hourly.duration / 3600) : 0;
    const { where: runWhere, params: runParams } = buildStatsWhere(filters, 'r.');

    const byHull = db.prepare([
      "SELECT COALESCE(NULLIF(r.hull_name, ''), 'Unknown ship') AS hull_name,",
      "  COALESCE(NULLIF(r.ship_class, ''), 'Unknown') AS ship_class,",
      '  COUNT(*) AS total_runs,',
      "  SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN r.net_isk ELSE -r.total_loss END) AS avg_net_isk",
      'FROM runs r',
      runWhere,
      "GROUP BY COALESCE(NULLIF(r.hull_name, ''), 'Unknown ship'),",
      "  COALESCE(NULLIF(r.ship_class, ''), 'Unknown')",
      'ORDER BY total_runs DESC, avg_net_isk DESC',
      'LIMIT 20',
    ].filter(Boolean).join('\n')).all(...runParams);

    const itemRows = db.prepare([
      'SELECT ri.type, ri.item_name,',
      '  COUNT(DISTINCT ri.run_id) AS runs_containing,',
      '  SUM(ri.qty) AS total_qty,',
      "  SUM(ri.qty * CASE WHEN ri.type = 'gained'",
      '    THEN ri.unit_price_buy ELSE ri.unit_price_sell END) AS total_value',
      'FROM run_items ri',
      'JOIN runs r ON r.id = ri.run_id',
      runWhere,
      'GROUP BY ri.type, ri.item_name',
      'ORDER BY total_value DESC, total_qty DESC, ri.item_name COLLATE NOCASE',
    ].filter(Boolean).join('\n')).all(...runParams);
    const items = { gained: [], consumed: [], lost: [] };
    for (const item of itemRows) {
      if (items[item.type].length < 15) items[item.type].push(item);
    }

    return {
      overall,
      byTier,
      byWeather,
      byHull,
      byFit: getFitStats(db, filters),
      items,
      latestSession: getLatestSession(db, filters),
      iskPerHour,
    };
  }

  function getDailyStats(filters = {}) {
    const db = getConnection();
    const { where, params } = buildStatsWhere(filters);
    return db.prepare(`
      SELECT
        date(started_at, 'unixepoch', 'localtime') as day,
        COUNT(*) as total_runs,
        SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
        SUM(CASE WHEN outcome = 'Survived' THEN net_isk ELSE -total_loss END) as net_isk,
        SUM(CASE WHEN outcome = 'Died' THEN total_loss ELSE 0 END) as total_loss
      FROM runs ${where}
      GROUP BY day
      ORDER BY day ASC
    `).all(...params);
  }
  return Object.freeze({ getStats, getDailyStats });
}

module.exports = { createStatisticsRepository };
