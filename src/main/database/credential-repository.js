function createCredentialRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Credential repository requires a connection provider');
  }

  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function normalizeKind(kind) {
    if (kind !== 'oauth' && kind !== 'janice') {
      throw new TypeError('Credential kind is invalid');
    }
    return kind;
  }

  function normalizeCharacterId(kind, characterId) {
    if (kind === 'janice') return null;
    const value = Number(characterId);
    if (!Number.isSafeInteger(value)) throw new TypeError('Character ID is invalid');
    return value;
  }

  function getCredential(kind, characterId = null) {
    const safeKind = normalizeKind(kind);
    const safeCharacterId = normalizeCharacterId(safeKind, characterId);
    const row = database().prepare(`
      SELECT ciphertext FROM credentials
      WHERE kind = ? AND character_id IS ?
    `).get(safeKind, safeCharacterId);
    return row?.ciphertext || null;
  }

  function listCredentialsNeedingNormalization() {
    return database().prepare(`
      SELECT kind, character_id, ciphertext
      FROM credentials
      WHERE format_version = 0
      ORDER BY kind, character_id
    `).all();
  }

  function setCredential(kind, characterId, ciphertext) {
    const safeKind = normalizeKind(kind);
    const safeCharacterId = normalizeCharacterId(safeKind, characterId);
    database().prepare(`
      INSERT INTO credentials (kind, character_id, ciphertext, format_version, updated_at)
      VALUES (?, ?, ?, 1, strftime('%s','now'))
      ON CONFLICT DO UPDATE SET
        ciphertext = excluded.ciphertext,
        format_version = excluded.format_version,
        updated_at = excluded.updated_at
    `).run(safeKind, safeCharacterId, String(ciphertext));
    return true;
  }

  function deleteCredential(kind, characterId = null) {
    const safeKind = normalizeKind(kind);
    const safeCharacterId = normalizeCharacterId(safeKind, characterId);
    database().prepare(
      'DELETE FROM credentials WHERE kind = ? AND character_id IS ?'
    ).run(safeKind, safeCharacterId);
    return true;
  }

  return Object.freeze({
    deleteCredential,
    getCredential,
    listCredentialsNeedingNormalization,
    setCredential,
  });
}

module.exports = { createCredentialRepository };
