function registerCharacterDeletionHandler({
  secureHandle,
  database,
  requireInteger,
}) {
  secureHandle('auth:delete-character', characterId => {
    const id = requireInteger(characterId, 'Character ID');
    return database.deleteCharacter(id);
  });
}

module.exports = { registerCharacterDeletionHandler };
