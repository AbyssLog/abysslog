const { createNewRunUid } = require('./v6-identities');

function createEncounterRepository(getConnection) {
  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function ensure(run, encounterUid = null, createdAt = null) {
    const connection = database();
    const uid = encounterUid || createNewRunUid();
    connection.prepare(`
      INSERT INTO encounters
        (encounter_uid, started_at, duration, tier, weather, system_id, system_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%s','now')))
      ON CONFLICT(encounter_uid) DO UPDATE SET
        duration = MAX(
          encounters.started_at + encounters.duration,
          excluded.started_at + excluded.duration
        ) - MIN(encounters.started_at, excluded.started_at),
        started_at = MIN(encounters.started_at, excluded.started_at),
        tier = CASE
          WHEN encounters.tier IS NULL OR encounters.tier = 'Unknown' THEN excluded.tier
          ELSE encounters.tier
        END,
        weather = CASE
          WHEN encounters.weather IS NULL OR encounters.weather = 'Unknown' THEN excluded.weather
          ELSE encounters.weather
        END,
        system_id = COALESCE(encounters.system_id, excluded.system_id),
        system_name = COALESCE(encounters.system_name, excluded.system_name)
    `).run(
      uid,
      run.started_at,
      run.duration || 0,
      run.tier,
      run.weather,
      run.system_id ?? null,
      run.system_name || null,
      createdAt
    );
    return connection.prepare(
      'SELECT id, encounter_uid FROM encounters WHERE encounter_uid = ?'
    ).get(uid);
  }

  function deleteIfEmpty(encounterId) {
    const connection = database();
    if (!connection.prepare('SELECT 1 FROM runs WHERE encounter_id = ? LIMIT 1').get(encounterId)) {
      connection.prepare('DELETE FROM encounters WHERE id = ?').run(encounterId);
      return true;
    }
    refresh(encounterId);
    return false;
  }

  function assertParticipantAllowed(encounterId, shipClass, { excludeRunId = null } = {}) {
    const connection = database();
    const existing = connection.prepare(`
      SELECT ship_class FROM runs
      WHERE encounter_id = ? AND (? IS NULL OR id <> ?)
    `).all(encounterId, excludeRunId, excludeRunId);
    if (existing.length === 0) return true;
    const maximum = shipClass === 'Frigate' ? 3 : shipClass === 'Destroyer' ? 2 : 1;
    if (
      maximum === 1
      || existing.length >= maximum
      || existing.some(run => run.ship_class !== shipClass)
    ) {
      throw new TypeError('Group encounters require up to three frigates or two destroyers');
    }
    return true;
  }

  function refresh(encounterId) {
    const connection = database();
    const values = connection.prepare(`
      SELECT MIN(started_at) AS started_at,
        MAX(started_at + duration) AS ended_at,
        COALESCE(MIN(NULLIF(tier, 'Unknown')), 'Unknown') AS tier,
        COALESCE(MIN(NULLIF(weather, 'Unknown')), 'Unknown') AS weather,
        MIN(system_id) AS system_id,
        MIN(system_name) AS system_name
      FROM runs WHERE encounter_id = ?
    `).get(encounterId);
    if (values.started_at == null) return false;
    connection.prepare(`
      UPDATE encounters SET started_at = ?, duration = ?, tier = ?, weather = ?,
        system_id = ?, system_name = ? WHERE id = ?
    `).run(
      values.started_at,
      Math.max(0, values.ended_at - values.started_at),
      values.tier,
      values.weather,
      values.system_id,
      values.system_name,
      encounterId
    );
    return true;
  }

  return Object.freeze({ assertParticipantAllowed, deleteIfEmpty, ensure, refresh });
}

module.exports = { createEncounterRepository };
