function createTrackingDraftRepository(getConnection) {
  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function save(draft) {
    database().prepare(`
      INSERT INTO tracking_drafts (character_id, snapshot, updated_at)
      VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(character_id) DO UPDATE SET
        snapshot = excluded.snapshot, updated_at = excluded.updated_at
    `).run(draft.character_id, JSON.stringify(draft));
    return draft;
  }

  function get(characterId) {
    const row = database().prepare(
      'SELECT snapshot FROM tracking_drafts WHERE character_id = ?'
    ).get(characterId);
    if (!row) return null;
    try {
      return JSON.parse(row.snapshot);
    } catch {
      database().prepare('DELETE FROM tracking_drafts WHERE character_id = ?').run(characterId);
      return null;
    }
  }

  return Object.freeze({ get, save });
}

module.exports = { createTrackingDraftRepository };
