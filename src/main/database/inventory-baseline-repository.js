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
      SELECT r.*, c.name AS character_name
      FROM runs r
      JOIN characters c ON r.character_id = c.id
      WHERE r.character_id = ?
      ORDER BY r.started_at DESC, r.id DESC
      LIMIT 1
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
      SELECT id, outcome
      FROM runs
      WHERE character_id = ?
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `).get(characterId);
    if (!latestRun || latestRun.outcome !== 'Survived' || latestRun.id !== runId) {
      return false;
    }
    return settings.setSetting(clearMarkerKey(characterId), runId);
  }

  return Object.freeze({ clearInventoryBaseline, clearMarkerKey, getInventoryBaseline });
}

module.exports = { createInventoryBaselineRepository };
