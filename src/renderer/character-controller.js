(function initCharacterController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssCharacters = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule() {
  const CAPABILITY_INPUTS = Object.freeze([
    ['tracking', 'permissionTracking'],
    ['fitting', 'permissionFitting'],
    ['implants', 'permissionImplants'],
    ['killmails', 'permissionKillmails'],
  ]);

  function normalizeCapabilities(value) {
    return {
      tracking: value?.tracking === true,
      fitting: value?.fitting === true,
      implants: value?.implants === true,
      killmails: value?.killmails === true,
    };
  }

  function characterPortraitUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'images.evetech.net' ? url.href : '';
    } catch {
      return '';
    }
  }

  function createCharacterController({
    document,
    api,
    state,
    escapeHtml,
    switchCharacter,
    onRemoveActiveCharacter,
    openModal,
    closeModal,
    confirmAction = message => globalThis.confirm(message),
    schedule = setTimeout,
  }) {
    if (!document || !api?.auth || !state) {
      throw new Error('Character controller requires document, auth APIs, and state');
    }
    for (const dependency of [
      escapeHtml,
      switchCharacter,
      onRemoveActiveCharacter,
      openModal,
      closeModal,
      confirmAction,
      schedule,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Character controller dependencies must be functions');
      }
    }

    let capabilityGeneration = 0;

    async function refreshCapabilities() {
      const generation = ++capabilityGeneration;
      const characters = [...state.characters];
      const entries = await Promise.all(characters.map(async character => {
        try {
          const capabilities = await api.auth.getCapabilities(character.id);
          return [character.id, normalizeCapabilities(capabilities)];
        } catch {
          return [character.id, normalizeCapabilities(null)];
        }
      }));
      if (generation !== capabilityGeneration) return false;
      state.characterCapabilities = Object.fromEntries(entries);
      return true;
    }

    function populateSelect() {
      const select = document.getElementById('charSelect');
      select.replaceChildren();
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No character';
      select.append(empty);
      for (const character of state.characters) {
        const option = document.createElement('option');
        option.value = character.id;
        option.textContent = character.name;
        select.append(option);
      }
      select.value = state.activeCharId || '';
    }

    function showNoCharacter() {
      document.getElementById('no-char-prompt').style.display = 'block';
      document.getElementById('tracker-ui').style.display = 'none';
    }

    function renderList() {
      const container = document.getElementById('charList');
      if (!state.characters.length) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">'
          + 'No characters added yet.</div>';
        return;
      }
      container.innerHTML = state.characters.map(character => {
        const capabilities = normalizeCapabilities(
          state.characterCapabilities[character.id]
        );
        const badges = [
          ['tracking', 'Tracking'],
          ['fitting', 'Fitting'],
          ['implants', 'Implants'],
          ['killmails', 'Killmails'],
        ].filter(([capability]) => capabilities[capability])
          .map(([, label]) => `<span class="capability-badge enabled">${label}</span>`)
          .join('');
        return `
          <div class="char-item">
            <img class="char-portrait" src="${escapeHtml(
              characterPortraitUrl(character.portrait_url)
            )}" alt="" data-hide-on-error>
            <div class="char-info">
              <div class="char-name">${escapeHtml(character.name)}</div>
              <div class="char-id">${escapeHtml(character.id)}</div>
              <div class="capability-list">${badges
                || '<span class="capability-badge">Manual only</span>'}</div>
            </div>
            <div style="display:flex;gap:6px;margin-left:auto">
              <button class="btn sm ghost" data-action="reauth-character" data-character-id="${
                escapeHtml(character.id)
              }">Permissions</button>
              <button class="btn sm red" data-action="remove-character" data-character-id="${
                escapeHtml(character.id)
              }">Remove</button>
            </div>
          </div>`;
      }).join('');
    }

    function getSelectedCapabilities() {
      return CAPABILITY_INPUTS
        .filter(([, id]) => document.getElementById(id).checked)
        .map(([capability]) => capability);
    }

    function updatePermissionSummary() {
      const selected = getSelectedCapabilities();
      document.getElementById('permissionSummary').textContent = selected.length === 0
        ? 'No ESI data permissions will be requested. This character can use manual run entry only.'
        : `${selected.length} optional feature${selected.length === 1 ? '' : 's'} selected. `
          + 'EVE SSO requires approval for every corresponding permission.';
    }

    function setSelectedCapabilities(capabilities) {
      const selected = normalizeCapabilities(capabilities);
      for (const [capability, id] of CAPABILITY_INPUTS) {
        document.getElementById(id).checked = selected[capability];
      }
      updatePermissionSummary();
    }

    function openAdd() {
      document.getElementById('addCharModalTitle').textContent = 'Add Character';
      document.getElementById('ssoStatus').textContent = '';
      document.getElementById('ssoSpinner').style.display = 'none';
      setSelectedCapabilities({ tracking: true });
      openModal('addCharModal');
    }

    async function startSso() {
      try {
        const status = document.getElementById('ssoStatus');
        status.textContent = 'Browser opened — waiting for authorisation...';
        status.textContent += ' AbyssLog will return to the foreground when sign-in finishes.';
        document.getElementById('ssoSpinner').style.display = 'inline-block';
        await api.auth.startSso(getSelectedCapabilities());
      } catch (error) {
        document.getElementById('ssoStatus').textContent = `Error: ${error.message}`;
        document.getElementById('ssoSpinner').style.display = 'none';
      }
    }

    async function handleComplete(character) {
      state.characters = await api.auth.getCharacters();
      await refreshCapabilities();
      populateSelect();
      await switchCharacter(character.id);
      document.getElementById('ssoStatus').textContent =
        `Logged in as ${character.name}. You can close the browser tab.`;
      document.getElementById('ssoSpinner').style.display = 'none';
      schedule(() => closeModal('addCharModal'), 1500);
      renderList();
    }

    function handleError(message) {
      document.getElementById('ssoStatus').textContent = `Error: ${message}`;
      document.getElementById('ssoSpinner').style.display = 'none';
    }

    async function reauthorize(characterId) {
      await switchCharacter(characterId);
      document.getElementById('addCharModalTitle').textContent = 'Character Permissions';
      setSelectedCapabilities(state.characterCapabilities[characterId]);
      document.getElementById('ssoSpinner').style.display = 'none';
      document.getElementById('ssoStatus').textContent =
        'Adjust the features, then continue to EVE SSO to replace this character authorization.';
      openModal('addCharModal');
    }

    async function remove(characterId) {
      if (!confirmAction('Remove this character? Their run history will be deleted.')) return;
      const removingActiveCharacter = String(state.activeCharId) === String(characterId);
      await api.auth.deleteCharacter(characterId);
      if (removingActiveCharacter) await onRemoveActiveCharacter();
      state.characters = await api.auth.getCharacters();
      await refreshCapabilities();
      populateSelect();
      renderList();
      if (!removingActiveCharacter) return;
      state.activeCharId = null;
      if (state.characters.length) await switchCharacter(state.characters[0].id);
      else showNoCharacter();
    }

    return Object.freeze({
      getSelectedCapabilities,
      handleComplete,
      handleError,
      openAdd,
      populateSelect,
      reauthorize,
      refreshCapabilities,
      remove,
      renderList,
      setSelectedCapabilities,
      showNoCharacter,
      startSso,
      updatePermissionSummary,
    });
  }

  return Object.freeze({
    characterPortraitUrl,
    createCharacterController,
    normalizeCapabilities,
  });
});
