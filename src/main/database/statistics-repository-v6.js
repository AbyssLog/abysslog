function createStatisticsRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Statistics repository requires a connection provider');
  }

  function buildStatsWhere(filters = {}, alias = 'r.') {
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

  function runAppraisalFrom() {
    return `FROM runs r
      JOIN appraisals a ON a.run_id = r.id AND a.is_current = 1`;
  }

  function getFitStats(db, filters) {
    const { where, params } = buildStatsWhere(filters);
    return db.prepare([
      'SELECT fi.id AS fit_identity_id, fi.signature_hash AS fit_key,',
      '  MAX(r.id) AS representative_run_id, fi.hull_name, fi.display_name,',
      "  COALESCE(NULLIF(MAX(r.ship_class), ''), 'Unknown') AS ship_class,",
      '  COUNT(*) AS total_runs,',
      "  SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END)",
      '    AS avg_net_isk',
      runAppraisalFrom(),
      'JOIN fit_snapshots fs ON fs.id = r.fit_snapshot_id',
      'JOIN fit_identities fi ON fi.id = fs.fit_identity_id',
      where,
      'GROUP BY fi.id, fi.signature_hash, fi.hull_name, fi.display_name',
      'ORDER BY total_runs DESC, avg_net_isk DESC',
      'LIMIT 20',
    ].filter(Boolean).join('\n')).all(...params);
  }

  function getLatestSession(db, filters) {
    const { where, params } = buildStatsWhere(filters);
    const rows = db.prepare([
      'SELECT r.id, r.started_at, r.duration, r.outcome, a.net_isk, a.total_loss',
      runAppraisalFrom(),
      where,
      'ORDER BY r.started_at DESC, r.id DESC',
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
        COUNT(*) AS total_runs,
        SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,
        SUM(CASE WHEN r.outcome = 'Died' THEN 1 ELSE 0 END) AS died,
        AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration_survived,
        AVG(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS avg_net_isk,
        SUM(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS total_net_isk,
        AVG(CASE WHEN r.outcome = 'Died' THEN a.total_loss END) AS avg_loss,
        SUM(CASE WHEN r.outcome = 'Died' THEN a.total_loss ELSE 0 END) AS total_loss,
        MIN(r.started_at) AS first_run,
        MAX(r.started_at) AS last_run
      ${runAppraisalFrom()} ${where}
    `).get(...params);

    const byTier = db.prepare(`
      SELECT r.tier,
        COUNT(*) AS total_runs,
        SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,
        AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration,
        AVG(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS avg_net_isk
      ${runAppraisalFrom()} ${where}
      GROUP BY r.tier ORDER BY r.tier
    `).all(...params);

    const byWeather = db.prepare(`
      SELECT r.weather,
        COUNT(*) AS total_runs,
        SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,
        AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration,
        AVG(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS avg_net_isk
      ${runAppraisalFrom()} ${where}
      GROUP BY r.weather ORDER BY r.weather
    `).all(...params);

    const hourly = db.prepare(`
      SELECT
        SUM(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS profit,
        SUM(r.duration) AS duration
      ${runAppraisalFrom()}
      ${where ? where + ' AND' : 'WHERE'} r.duration > 0
    `).get(...params);
    const iskPerHour = hourly?.duration > 0 ? hourly.profit / (hourly.duration / 3600) : 0;

    const byHull = db.prepare([
      "SELECT COALESCE(NULLIF(r.hull_name, ''), 'Unknown ship') AS hull_name,",
      "  COALESCE(NULLIF(r.ship_class, ''), 'Unknown') AS ship_class,",
      '  COUNT(*) AS total_runs,',
      "  SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration,",
      "  AVG(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS avg_net_isk",
      runAppraisalFrom(),
      where,
      "GROUP BY COALESCE(NULLIF(r.hull_name, ''), 'Unknown ship'),",
      "  COALESCE(NULLIF(r.ship_class, ''), 'Unknown')",
      'ORDER BY total_runs DESC, avg_net_isk DESC',
      'LIMIT 20',
    ].filter(Boolean).join('\n')).all(...params);

    const itemRows = db.prepare([
      'SELECT al.disposition AS type, al.item_name,',
      '  COUNT(DISTINCT a.run_id) AS runs_containing,',
      '  SUM(al.qty) AS total_qty,',
      "  SUM(al.qty * CASE WHEN al.disposition = 'gained'",
      '    THEN al.unit_price_buy ELSE al.unit_price_sell END) AS total_value',
      'FROM appraisal_lines al',
      'JOIN appraisals a ON a.id = al.appraisal_id AND a.is_current = 1',
      'JOIN runs r ON r.id = a.run_id',
      where,
      "  " + (where ? 'AND' : 'WHERE') + " al.disposition IN ('gained', 'consumed', 'lost')",
      'GROUP BY al.disposition, al.item_name',
      'ORDER BY total_value DESC, total_qty DESC, al.item_name COLLATE NOCASE',
    ].filter(Boolean).join('\n')).all(...params);
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
        date(r.started_at, 'unixepoch', 'localtime') AS day,
        COUNT(*) AS total_runs,
        SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,
        SUM(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE -a.total_loss END) AS net_isk,
        SUM(CASE WHEN r.outcome = 'Died' THEN a.total_loss ELSE 0 END) AS total_loss
      ${runAppraisalFrom()} ${where}
      GROUP BY day
      ORDER BY day ASC
    `).all(...params);
  }

  return Object.freeze({ getStats, getDailyStats });
}

module.exports = { createStatisticsRepository };
