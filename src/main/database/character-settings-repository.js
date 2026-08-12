const { runInTransaction } = require('./transaction');

const STORAGE_HARDENING_KEY = 'security_storage_hardened_v1';
const CHARACTER_TOKEN_PREFIX = 'tokens_';

function createCharacterSettingsRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Character/settings repository requires a connection provider');
  }

  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function getSetting(key) {
    const row = database().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  function setSetting(key, value) {
    database().prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(key, String(value));
    return true;
  }

  function deleteSetting(key) {
    database().prepare('DELETE FROM settings WHERE key = ?').run(key);
    return true;
  }

  function getCharacters() {
    return database().prepare('SELECT * FROM characters ORDER BY name').all();
  }

  function saveCharacter(character) {
    database().prepare(`
      INSERT INTO characters (id, name, portrait_url, client_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        portrait_url = excluded.portrait_url,
        client_id = excluded.client_id
    `).run(character.id, character.name, character.portrait_url, character.client_id);
    return character;
  }

  function deleteCharacter(characterId, additionalSettingKeys = []) {
    const connection = database();
    runInTransaction(connection, () => {
      deleteSetting(`${CHARACTER_TOKEN_PREFIX}${characterId}`);
      for (const key of additionalSettingKeys) deleteSetting(key);
      connection.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
    });
    return true;
  }

  function hardenSensitiveStorage() {
    const connection = database();
    if (getSetting(STORAGE_HARDENING_KEY) === '1') return;
    connection.pragma('wal_checkpoint(TRUNCATE)');
    connection.exec('VACUUM');
    setSetting(STORAGE_HARDENING_KEY, '1');
  }

  return Object.freeze({
    deleteCharacter,
    deleteSetting,
    getCharacters,
    getSetting,
    hardenSensitiveStorage,
    saveCharacter,
    setSetting,
  });
}

module.exports = { createCharacterSettingsRepository };
