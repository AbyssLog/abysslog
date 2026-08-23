const assert = require('node:assert/strict');
const test = require('node:test');

const { JSDOM } = require('jsdom');
const {
  characterPortraitUrl,
  createCharacterController,
  normalizeCapabilities,
} = require('../src/renderer/character-controller');

function createHarness() {
  const dom = new JSDOM(`
    <select id="charSelect"></select>
    <div id="charList"></div>
    <div id="no-char-prompt"></div>
    <div id="tracker-ui"></div>
    <div id="addCharModalTitle"></div>
    <div id="ssoStatus"></div>
    <div id="ssoSpinner"></div>
    <input type="checkbox" id="permissionTracking">
    <input type="checkbox" id="permissionFitting">
    <input type="checkbox" id="permissionImplants">
    <input type="checkbox" id="permissionKillmails">
    <div id="permissionSummary"></div>
  `);
  const state = {
    activeCharId: 9001,
    characters: [
      { id: 9001, name: 'Primary Pilot', portrait_url: 'https://images.evetech.net/1.png' },
      { id: 9002, name: 'Second Pilot', portrait_url: 'https://example.test/private.png' },
    ],
    characterCapabilities: {},
  };
  const calls = {
    close: [],
    deleted: [],
    open: [],
    removedActive: 0,
    scheduled: [],
    sso: [],
    switches: [],
  };
  let availableCharacters = [...state.characters];
  let capabilityLoader = async id => id === 9001 ? { tracking: true } : {};
  const api = {
    auth: {
      deleteCharacter: async id => { calls.deleted.push(id); },
      getCapabilities: id => capabilityLoader(id),
      getCharacters: async () => [...availableCharacters],
      startSso: async capabilities => { calls.sso.push(capabilities); },
    },
  };
  const controller = createCharacterController({
    document: dom.window.document,
    api,
    state,
    escapeHtml: value => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
    switchCharacter: async id => { calls.switches.push(id); state.activeCharId = Number(id); },
    onRemoveActiveCharacter: async () => { calls.removedActive++; },
    openModal: id => calls.open.push(id),
    closeModal: id => calls.close.push(id),
    confirmAction: () => true,
    schedule: (callback, delay) => calls.scheduled.push([callback, delay]),
  });
  return {
    calls,
    controller,
    document: dom.window.document,
    setAvailableCharacters: characters => { availableCharacters = characters; },
    setCapabilityLoader: loader => { capabilityLoader = loader; },
    state,
  };
}

test('character controller renders selectors, safe portraits, and permissions', async () => {
  const { calls, controller, document, state } = createHarness();
  await controller.refreshCapabilities();
  controller.populateSelect();
  controller.renderList();
  assert.equal(document.getElementById('charSelect').options.length, 3);
  assert.equal(document.getElementById('charSelect').value, '9001');
  assert.match(document.getElementById('charList').innerHTML, /Primary Pilot/);
  assert.doesNotMatch(document.getElementById('charList').innerHTML, /example\.test/);
  assert.equal(state.characterCapabilities[9001].tracking, true);

  controller.openAdd();
  assert.equal(document.getElementById('permissionTracking').checked, true);
  assert.equal(calls.open.at(-1), 'addCharModal');
  await controller.startSso();
  assert.deepEqual(calls.sso, [['tracking']]);
});

test('character capability refresh ignores stale generations', async () => {
  const { controller, setCapabilityLoader, state } = createHarness();
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  setCapabilityLoader(async id => {
    if (id === 9001) return firstGate;
    return { implants: true };
  });
  const first = controller.refreshCapabilities();
  state.characters = [{ id: 9002, name: 'Second Pilot' }];
  const second = controller.refreshCapabilities();
  await second;
  releaseFirst({ tracking: true });
  await first;
  assert.deepEqual(Object.keys(state.characterCapabilities), ['9002']);
  assert.equal(state.characterCapabilities[9002].implants, true);
});

test('character removal delegates active lifecycle cleanup and selects a fallback', async () => {
  const {
    calls,
    controller,
    setAvailableCharacters,
    state,
  } = createHarness();
  setAvailableCharacters([{ id: 9002, name: 'Second Pilot' }]);
  await controller.remove(9001);
  assert.deepEqual(calls.deleted, [9001]);
  assert.equal(calls.removedActive, 1);
  assert.deepEqual(calls.switches, [9002]);
  assert.equal(state.activeCharId, 9002);
});

test('character authorization completion refreshes UI and schedules modal close', async () => {
  const { calls, controller, document } = createHarness();
  await controller.handleComplete({ id: 9001, name: 'Primary Pilot' });
  assert.deepEqual(calls.switches, [9001]);
  assert.match(document.getElementById('ssoStatus').textContent, /Logged in as Primary Pilot/);
  assert.equal(calls.scheduled[0][1], 1500);
  calls.scheduled[0][0]();
  assert.equal(calls.close.at(-1), 'addCharModal');
});

test('character helpers normalize capability and portrait boundaries', () => {
  assert.deepEqual(normalizeCapabilities({ tracking: 1, fitting: true }), {
    tracking: false, fitting: true, implants: false, killmails: false,
  });
  assert.match(characterPortraitUrl('https://images.evetech.net/characters/1/portrait'), /^https:/);
  assert.equal(characterPortraitUrl('https://example.test/portrait'), '');
  assert.equal(characterPortraitUrl('not a URL'), '');
});
