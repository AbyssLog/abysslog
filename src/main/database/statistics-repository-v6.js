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
        COUNT(DISTINCT r.encounter_id) AS total_encounters,
        SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,
        SUM(CASE WHEN r.outcome = 'Died' THEN 1 ELSE 0 END) AS died,
        AVG(CASE WHEN r.outcome = 'Survived' THEN r.duration END) AS avg_duration_survived,
        AVG(CASE WHEN r.outcome = 'Survived' THEN a.net_isk END) AS avg_net_isk,
        SUM(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE 0 END) AS total_net_isk,
        AVG(CASE WHEN r.outcome = 'Died' THEN a.total_loss END) AS avg_loss,
        SUM(CASE WHEN r.outcome = 'Died' THEN a.total_loss ELSE 0 END) AS total_loss,
        SUM(CASE WHEN r.outcome = 'Survived' AND r.duration > 0 THEN a.net_isk ELSE 0 END)
          AS hourly_net_isk,
        SUM(CASE WHEN r.outcome = 'Survived' AND r.duration > 0 THEN r.duration ELSE 0 END)
          AS hourly_duration,
        MIN(r.started_at) AS first_run,
        MAX(r.started_at) AS last_run
      ${runAppraisalFrom()} ${where}
    `).get(...params);
    const { hourly_net_isk, hourly_duration, ...rendererOverall } = overall;
    const iskPerHour = hourly_duration > 0
      ? hourly_net_isk / (hourly_duration / 3600)
      : 0;

    return {
      overall: rendererOverall,
      iskPerHour,
      daily: getDailyStats(db, filters),
    };
  }

  function getSessionStats(filters = {}) {
    return getLatestSession(getConnection(), filters);
  }

  function getDailyStats(db, filters) {
    const { where, params } = buildStatsWhere(filters);
    return db.prepare(`
      SELECT
        date(r.started_at, 'unixepoch', 'localtime') AS day,
        COUNT(*) AS total_runs,
        COUNT(DISTINCT r.encounter_id) AS total_encounters,
        SUM(CASE WHEN r.outcome = 'Survived' THEN 1 ELSE 0 END) AS survived,
        SUM(CASE WHEN r.outcome = 'Survived' THEN a.net_isk ELSE 0 END) AS net_isk,
        SUM(CASE WHEN r.outcome = 'Died' THEN a.total_loss ELSE 0 END) AS total_loss
      ${runAppraisalFrom()} ${where}
      GROUP BY day
      ORDER BY day ASC
    `).all(...params);
  }

  return Object.freeze({ getSessionStats, getStats });
}

module.exports = { createStatisticsRepository };
