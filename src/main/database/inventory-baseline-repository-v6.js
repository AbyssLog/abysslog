const INVENTORY_BASELINE_CLEAR_PREFIX = 'inventory_baseline_cleared_run_';

function createInventoryBaselineRepository(getConnection, settings) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Inventory baseline repository requires a connection provider');
  }
  if (typeof settings?.getSetting !== 'function' || typeof settings?.setSetting !== 'function') {
    throw new TypeError('Inventory baseline repository requires settings persistence');
  }

  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function clearMarkerKey(characterId) {
    return `${INVENTORY_BASELINE_CLEAR_PREFIX}${characterId}`;
  }

  function getInventoryBaseline(characterId) {
    const latestRun = database().prepare(`
      SELECT r.*, c.name AS character_name,
        MAX(CASE WHEN snapshots.phase = 'after' AND snapshots.location = 'cargo'
          THEN snapshots.raw_text END) AS cargo_after,
        MAX(CASE WHEN snapshots.phase = 'before' AND snapshots.location = 'drone'
          THEN snapshots.raw_text END) AS drone_before,
        MAX(CASE WHEN snapshots.phase = 'after' AND snapshots.location = 'drone'
          THEN snapshots.raw_text END) AS drone_after
      FROM runs r
      JOIN characters c ON r.character_id = c.id
      LEFT JOIN inventory_snapshots snapshots ON snapshots.run_id = r.id
      WHERE r.id = (
        SELECT latest.id FROM runs latest
        WHERE latest.character_id = ?
        ORDER BY latest.started_at DESC, latest.id DESC LIMIT 1
      )
      GROUP BY r.id
    `).get(characterId);
    if (!latestRun || latestRun.outcome !== 'Survived') return null;

    const clearedThroughRunId = Number(settings.getSetting(clearMarkerKey(characterId)));
    if (Number.isSafeInteger(clearedThroughRunId) && latestRun.id <= clearedThroughRunId) {
      return null;
    }
    return latestRun;
  }

  function clearInventoryBaseline(characterId, runId) {
    const latestRun = database().prepare(`
      SELECT id, outcome FROM runs
      WHERE character_id = ?
      ORDER BY started_at DESC, id DESC LIMIT 1
    `).get(characterId);
    if (!latestRun || latestRun.outcome !== 'Survived' || latestRun.id !== runId) {
      return false;
    }
    return settings.setSetting(clearMarkerKey(characterId), runId);
  }

  return Object.freeze({ clearInventoryBaseline, clearMarkerKey, getInventoryBaseline });
}

module.exports = { createInventoryBaselineRepository };
