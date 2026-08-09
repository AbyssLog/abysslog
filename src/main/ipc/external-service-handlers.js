function registerExternalServiceHandlers({
  secureHandle,
  security,
  withCharacterCapability,
  esi,
  janice,
  getJaniceApiKey,
}) {
  secureHandle('esi:get-location', characterId =>
    withCharacterCapability(characterId, 'tracking', (id, token) => esi.getLocation(id, token)));
  secureHandle('esi:get-ship', characterId =>
    withCharacterCapability(characterId, 'tracking', (id, token) => esi.getShip(id, token)));
  secureHandle('esi:get-fitting', characterId =>
    withCharacterCapability(characterId, 'fitting', (id, token) => esi.getFitting(id, token)));
  secureHandle('esi:get-implants', characterId =>
    withCharacterCapability(characterId, 'implants', (id, token) => esi.getImplants(id, token)));
  secureHandle('esi:get-recent-abyss-loss', (characterId, startedAt, endedAt) =>
    withCharacterCapability(characterId, 'killmails', (id, token) =>
      esi.getRecentAbyssLoss(
        id,
        token,
        security.requireInteger(startedAt, 'Run start time'),
        security.requireInteger(endedAt, 'Run end time')
      )));
  secureHandle('esi:get-type-names', typeIds => {
    if (!Array.isArray(typeIds) || typeIds.length > 1000) {
      throw new TypeError('Type ID list is invalid');
    }
    return esi.getTypeNames(typeIds.map(id => security.requireInteger(id, 'Type ID')));
  });
  secureHandle('esi:get-system-name', systemId =>
    esi.getSystemName(security.requireInteger(systemId, 'System ID')));
  secureHandle('esi:get-type-info', typeId =>
    esi.getTypeInfo(security.requireInteger(typeId, 'Type ID')));

  secureHandle('janice:appraise', (items, pricing) => {
    if (pricing !== 'buy' && pricing !== 'sell') throw new TypeError('Pricing mode is invalid');
    const apiKey = getJaniceApiKey();
    if (!apiKey) throw new Error('Janice API key is unavailable');
    return janice.appraise(security.validateAppraisalItems(items), pricing, apiKey);
  });
  secureHandle('janice:test-key', apiKey =>
    janice.appraise(
      [{ name: 'Tritanium', qty: 1 }],
      'buy',
      security.requireTrimmedText(apiKey, 'Janice API key', 4096)
    ));
}

module.exports = { registerExternalServiceHandlers };
