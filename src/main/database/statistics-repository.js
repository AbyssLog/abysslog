function createStatisticsRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Statistics repository requires a connection provider');
  }

  function buildStatsWhere(filters = {}) {
    const clauses = [];
    const params = [];
    if (filters.character_id != null) {
      clauses.push('character_id = ?');
      params.push(filters.character_id);
    }
    if (filters.range_start != null) {
      clauses.push('started_at >= ?');
      params.push(filters.range_start);
    }
    if (filters.range_end != null) {
      clauses.push('started_at < ?');
      params.push(filters.range_end);
    }
    return {
      where: clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '',
      params,
    };
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

    return { overall, byTier, byWeather, iskPerHour };
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
