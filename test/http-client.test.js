const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createHttpClient } = require('../src/main/http-client');

function createTransport(steps) {
  const requests = [];
  return {
    requests,
    request(options, onResponse) {
      const request = new EventEmitter();
      const step = steps.shift();
      requests.push({ options, request });
      request.setTimeout = (_milliseconds, callback) => {
        request.onTimeout = callback;
      };
      request.destroy = error => {
        queueMicrotask(() => request.emit('error', error));
      };
      request.end = body => {
        requests.at(-1).body = body;
        queueMicrotask(() => {
          if (step.timeout) {
            request.onTimeout();
            return;
          }
          if (step.error) {
            request.emit('error', step.error);
            return;
          }
          const response = new EventEmitter();
          response.statusCode = step.statusCode ?? 200;
          response.headers = step.headers || {};
          response.destroy = error => {
            queueMicrotask(() => response.emit('error', error));
          };
          onResponse(response);
          for (const chunk of step.chunks || [JSON.stringify(step.data)]) {
            response.emit('data', Buffer.from(chunk));
          }
          response.emit('end');
        });
      };
      return request;
    },
  };
}

test('HTTP client retries transient responses using Retry-After', async () => {
  const transport = createTransport([
    {
      statusCode: 503,
      headers: { 'retry-after': '1' },
      data: { error: 'unavailable' },
    },
    { statusCode: 200, data: { ok: true } },
  ]);
  const delays = [];
  const client = createHttpClient({
    transport,
    sleep: async delay => {
      delays.push(delay);
    },
    random: () => 0,
  });

  assert.deepEqual(await client.requestJson('https://example.test/data'), { ok: true });
  assert.deepEqual(delays, [1000]);
  assert.equal(transport.requests.length, 2);
});

test('HTTP client respects ESI error-limit reset before the next request', async () => {
  const transport = createTransport([
    {
      statusCode: 200,
      headers: {
        'x-esi-error-limit-remain': '5',
        'x-esi-error-limit-reset': '2',
      },
      data: { first: true },
    },
    { statusCode: 200, data: { second: true } },
  ]);
  const delays = [];
  const client = createHttpClient({
    transport,
    sleep: async delay => {
      delays.push(delay);
    },
    now: () => 1_000,
  });

  await client.requestJson('https://example.test/first');
  await client.requestJson('https://example.test/second');
  assert.deepEqual(delays, [2000]);
});

test('HTTP client fails closed on malformed and oversized JSON', async () => {
  const malformedClient = createHttpClient({
    transport: createTransport([{ chunks: ['not json'] }]),
  });
  await assert.rejects(
    malformedClient.requestJson('https://example.test/malformed'),
    /invalid JSON/
  );

  const oversizedClient = createHttpClient({
    transport: createTransport([{ chunks: ['12345'] }]),
  });
  await assert.rejects(
    oversizedClient.requestJson('https://example.test/large', {
      maxResponseBytes: 4,
    }),
    /too large/
  );
});

test('HTTP client bounds timeout retries', async () => {
  const transport = createTransport([{ timeout: true }, { timeout: true }]);
  const client = createHttpClient({
    transport,
    sleep: async () => {},
    random: () => 0,
  });

  await assert.rejects(
    client.requestJson('https://example.test/slow', {
      retries: 1,
      timeoutMs: 10,
    }),
    /timed out/
  );
  assert.equal(transport.requests.length, 2);
});

test('HTTP client does not retry authentication failures', async () => {
  const transport = createTransport([
    { statusCode: 401, data: { error: 'unauthorized' } },
  ]);
  const client = createHttpClient({ transport });

  await assert.rejects(
    client.requestJson('https://example.test/private'),
    /HTTP 401/
  );
  assert.equal(transport.requests.length, 1);
});

test('HTTP client retains only a bounded machine-readable OAuth error code', async () => {
  const client = createHttpClient({
    transport: createTransport([{
      statusCode: 400,
      data: {
        error: 'invalid_grant',
        error_description: 'sensitive provider detail',
      },
    }]),
  });

  await assert.rejects(
    client.requestJson('https://example.test/token'),
    error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.errorCode, 'invalid_grant');
      assert.doesNotMatch(error.message, /sensitive provider detail/);
      return true;
    }
  );
});

test('HTTP client exposes bounded response metadata only when requested', async () => {
  const client = createHttpClient({
    transport: createTransport([{
      statusCode: 200,
      headers: { 'x-pages': '3' },
      data: [{ id: 1 }],
    }]),
  });

  assert.deepEqual(await client.requestJson('https://example.test/assets', {
    includeResponseMetadata: true,
  }), {
    data: [{ id: 1 }],
    headers: { 'x-pages': '3' },
    statusCode: 200,
  });
});
