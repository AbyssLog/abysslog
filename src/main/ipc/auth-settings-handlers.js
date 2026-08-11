const loadouts = require('../../shared/loadouts');
const { registerCharacterDeletionHandler } = require('../character-handlers');

const LOADOUT_PRESETS_KEY = 'loadout_presets_v1';

function registerAuthSettingsHandlers({
  secureHandle,
  database,
  security,
  loadTokens,
  getCharacterCapabilities,
  startSso,
  getPublicSettings,
  validateObjectPayload,
  getSecureStorageStatus,
  getJaniceApiKey,
  janiceSecretKey,
  encryptSecret,
  recordDiagnostic,
}) {
  secureHandle('auth:get-characters', () => database.getCharacters());
  secureHandle('auth:has-tokens', characterId => Boolean(loadTokens(characterId)));
  secureHandle('auth:get-capabilities', characterId =>
    getCharacterCapabilities(security.requireInteger(characterId, 'Character ID')));
  secureHandle('auth:start-sso', selectedCapabilities => startSso(selectedCapabilities));
  registerCharacterDeletionHandler({
    secureHandle,
    database,
    requireInteger: security.requireInteger,
  });

  secureHandle('settings:get', key => {
    security.requireString(key, 'Setting key', 64);
    if (!security.PUBLIC_SETTING_KEYS.has(key)) throw new TypeError('Setting is not readable');
    return database.getSetting(key);
  });
  secureHandle('settings:set', (key, value) =>
    database.setSetting(key, security.validatePublicSetting(key, value)));
  secureHandle('settings:get-all', () => getPublicSettings());

  secureHandle('loadouts:get', () =>
    loadouts.parseStoredPresets(database.getSetting(LOADOUT_PRESETS_KEY)));
  secureHandle('loadouts:save', payload => {
    const data = validateObjectPayload(
      payload,
      'Loadout presets',
      loadouts.MAX_STORED_BYTES + 1024
    );
    if (Object.keys(data).length !== 1 || !Object.hasOwn(data, 'presets')) {
      throw new TypeError('Loadout presets payload is invalid');
    }
    const serialized = loadouts.serializePresets(data.presets);
    database.setSetting(LOADOUT_PRESETS_KEY, serialized);
    recordDiagnostic('loadouts.saved', { presetCount: data.presets.length });
    return loadouts.parseStoredPresets(serialized);
  });

  secureHandle('secrets:status', () => getSecureStorageStatus());
  secureHandle('secrets:has-janice-key', () => Boolean(getJaniceApiKey()));
  secureHandle('secrets:set-janice-key', apiKey => {
    const key = security.requireTrimmedText(apiKey, 'Janice API key', 4096);
    database.setSetting(janiceSecretKey, encryptSecret(key));
    database.deleteSetting('janice_api_key');
    return true;
  });
  secureHandle('secrets:delete-janice-key', () => {
    database.deleteSetting(janiceSecretKey);
    database.deleteSetting('janice_api_key');
    return true;
  });
}

module.exports = { registerAuthSettingsHandlers };
