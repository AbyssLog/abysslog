const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const calls = [];
const responses = [];
const fakeHttp = {
  async requestJson(url, options = {}) {
    calls.push({ url, options });
    if (responses.length === 0) throw new Error(`No fake response for ${url}`);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  },
};

const originalLoad = Module._load;
let esi;
try {
  Module._load = function loadWithHttpMock(request, parent, isMain) {
    if (request === './http-client' && parent?.filename.endsWith('esi.js')) {
      return { createHttpClient: () => fakeHttp };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  esi = require('../src/main/esi');
} finally {
  Module._load = originalLoad;
}

test.beforeEach(() => {
  calls.length = 0;
  responses.length = 0;
  esi.clearMetadataCaches();
});

test('ESI boundary validates and minimizes renderer-facing responses', async () => {
  responses.push({
    solar_system_id: 32_000_001,
    station_id: 60_000_001,
    ignored: '<script>',
  });
  assert.deepEqual(await esi.getLocation(123, 'token'), {
    solar_system_id: 32_000_001,
  });

  responses.push({ solar_system_id: '<script>' });
  await assert.rejects(esi.getLocation(123, 'token'), /Solar system ID/);
});

test('ESI caches stable system and type metadata', async () => {
  responses.push({ name: 'Jita', ignored: '<script>' });
  assert.equal(await esi.getSystemName(30_000_142), 'Jita');
  assert.equal(await esi.getSystemName(30_000_142), 'Jita');
  assert.equal(calls.length, 1);

  responses.push({ group_id: 26, name: 'Gila', ignored: '<script>' });
  assert.deepEqual(await esi.getTypeInfo(17_918), {
    group_id: 26,
    name: 'Gila',
  });

  responses.push([{ id: 12_345, name: 'Module', category: 'inventory_type' }]);
  assert.deepEqual(await esi.getTypeNames([17_918, 12_345, 17_918]), {
    12345: 'Module',
    17918: 'Gila',
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].options.body), [12_345]);
});

test('ESI derives the active fitting from paginated character assets', async () => {
  responses.push({
    ship_item_id: 9001,
    ship_name: 'Reliable Gila',
    ship_type_id: 17_918,
  });
  responses.push({
    data: [
      {
        item_id: 101,
        is_singleton: true,
        location_flag: 'HiSlot0',
        location_id: 9001,
        location_type: 'item',
        quantity: 1,
        type_id: 12_345,
      },
      {
        item_id: 102,
        is_singleton: false,
        location_flag: 'Cargo',
        location_id: 9001,
        location_type: 'item',
        quantity: 50,
        type_id: 34,
      },
    ],
    headers: { 'x-pages': '2' },
    statusCode: 200,
  });
  responses.push({
    data: [{
      item_id: 103,
      is_singleton: false,
      location_flag: 'DroneBay',
      location_id: 9001,
      location_type: 'item',
      quantity: 5,
      type_id: 21_638,
    }],
    headers: { 'x-pages': '2' },
    statusCode: 200,
  });

  assert.deepEqual(await esi.getFitting(123, 'token'), {
    ship_type_id: 17_918,
    items: [
      { flag: 'HiSlot0', quantity: 1, type_id: 12_345 },
      { flag: 'DroneBay', quantity: 5, type_id: 21_638 },
    ],
  });
  assert.match(calls[0].url, /\/characters\/123\/ship\/$/);
  assert.match(calls[1].url, /\/characters\/123\/assets\/\?page=1$/);
  assert.match(calls[2].url, /\/characters\/123\/assets\/\?page=2$/);
  assert.equal(calls[1].options.includeResponseMetadata, true);
  assert.equal(calls[1].options.headers['X-Compatibility-Date'], '2026-07-25');
});

test('OAuth token calls disable automatic replay and validate refresh tokens', async () => {
  responses.push({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 1_200,
  });
  assert.deepEqual(await esi.exchangeAuthorizationCode(
    'code',
    'client',
    'verifier',
    'callback'
  ), {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 1_200,
  });
  assert.equal(calls[0].options.retries, 0);

  responses.push({ access_token: 'access', expires_in: 1_200 });
  await assert.rejects(
    esi.exchangeAuthorizationCode('code', 'client', 'verifier', 'callback'),
    /refresh token/i
  );
});
