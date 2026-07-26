const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateBackoffDelay,
  createSingleFlight,
  createTokenCoordinator,
  createTransitionTracker,
  diffInventoryPastes,
  diffOptionalInventoryPastes,
  inferAbyssalFilament,
  mergeInventoryItems,
  parseInventoryPaste,
} = require('../src/shared/run-tracking');

test('poll backoff grows exponentially and respects its cap', () => {
  assert.equal(calculateBackoffDelay(5_000, 1), 5_000);
  assert.equal(calculateBackoffDelay(5_000, 2), 10_000);
  assert.equal(calculateBackoffDelay(5_000, 5), 60_000);
  assert.equal(calculateBackoffDelay(5_000, 20), 60_000);
  assert.throws(() => calculateBackoffDelay(0, 1));
});

test('filament names infer tier and weather only when unambiguous', () => {
  assert.deepEqual(inferAbyssalFilament([
    { name: 'Cataclysmic Electrical Filament', qty: 3 },
    { name: 'Caldari Navy Missile', qty: 100 },
  ]), {
    tier: 'T6',
    weather: 'Electrical',
    name: 'Cataclysmic Electrical Filament',
    ambiguous: false,
  });
  assert.deepEqual(inferAbyssalFilament([
    { name: 'Tranquil Dark Filament', qty: 1 },
  ]), {
    tier: 'T0',
    weather: 'Dark',
    name: 'Tranquil Dark Filament',
    ambiguous: false,
  });
  assert.equal(inferAbyssalFilament([{ name: 'Tritanium', qty: 1 }]), null);
  assert.equal(inferAbyssalFilament([
    { name: 'Calm Gamma Filament', qty: 1 },
    { name: 'Raging Firestorm Filament', qty: 1 },
  ]).ambiguous, true);
});

test('inventory pastes parse, merge, and diff cargo and drone stacks safely', () => {
  assert.deepEqual(parseInventoryPaste([
    'Vespa II\t5\tDrone',
    'Vespa II x 2',
    'Abyssal Loot\tMaterial',
    '__proto__\t3\tMaterial',
  ].join('\n')), [
    { name: 'Vespa II', qty: 7 },
    { name: 'Abyssal Loot', qty: 1 },
    { name: '__proto__', qty: 3 },
  ]);

  assert.deepEqual(mergeInventoryItems(
    [{ name: 'Vespa II', qty: 5 }],
    [{ name: 'Vespa II', qty: 2 }, { name: 'Hammerhead II', qty: 1 }]
  ), [
    { name: 'Vespa II', qty: 7 },
    { name: 'Hammerhead II', qty: 1 },
  ]);

  assert.deepEqual(diffInventoryPastes(
    'Vespa II\t5\nNanite Repair Paste\t20',
    'Vespa II\t4\nTriglavian Survey Database\t2'
  ), {
    gained: [{ name: 'Triglavian Survey Database', qty: 2 }],
    consumed: [
      { name: 'Vespa II', qty: 1 },
      { name: 'Nanite Repair Paste', qty: 20 },
    ],
  });
  assert.throws(() => parseInventoryPaste('Tritanium\t1,000,000,001'), /too large/);
  assert.throws(() => mergeInventoryItems([{ name: 'Vespa II', qty: -1 }]), /invalid/);
});

test('omitted post-run inventory is unchanged while an explicit paste records losses', () => {
  assert.deepEqual(
    diffOptionalInventoryPastes('Vespa II\t5', ''),
    { gained: [], consumed: [] }
  );
  assert.deepEqual(
    diffOptionalInventoryPastes('Vespa II\t5', 'Vespa II\t4'),
    { gained: [], consumed: [{ name: 'Vespa II', qty: 1 }] }
  );
  assert.throws(() => diffOptionalInventoryPastes([], ''), /must be text/);
});

test('single-flight work is shared per key and cleared after completion', async () => {
  const singleFlight = createSingleFlight();
  let calls = 0;
  let release;
  const blocked = new Promise(resolve => {
    release = resolve;
  });
  const operation = async () => {
    calls++;
    await blocked;
    return 'token';
  };

  const first = singleFlight(42, operation);
  const second = singleFlight(42, operation);
  assert.equal(first, second);
  assert.equal(calls, 0);

  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['token', 'token']);

  assert.equal(await singleFlight(42, async () => {
    calls++;
    return 'new-token';
  }), 'new-token');
  assert.equal(calls, 2);
});

test('token coordinator refreshes expired tokens once for concurrent callers', async () => {
  let stored = {
    access_token: 'expired',
    refresh_token: 'refresh-1',
    expires_at: 900,
  };
  let refreshCalls = 0;
  const coordinator = createTokenCoordinator({
    loadTokens: () => stored,
    saveTokens: (_characterId, tokens) => {
      stored = tokens;
    },
    clearTokens: () => {
      stored = null;
    },
    refreshTokens: async () => {
      refreshCalls++;
      await Promise.resolve();
      return {
        access_token: 'fresh',
        refresh_token: 'refresh-2',
        expires_in: 3_600,
      };
    },
    validateAccessToken: token => token,
    validateLifetime: lifetime => lifetime,
    now: () => 1_000,
    refreshSkewMs: 60,
  });

  assert.deepEqual(await Promise.all([
    coordinator.getAccessToken(42),
    coordinator.getAccessToken(42),
  ]), ['fresh', 'fresh']);
  assert.equal(refreshCalls, 1);
  assert.equal(stored.refresh_token, 'refresh-2');
  assert.equal(stored.expires_at, 3_601_000);
});

test('token coordinator refreshes and retries once after HTTP 401', async () => {
  let stored = {
    access_token: 'revoked',
    refresh_token: 'refresh-1',
    expires_at: 100_000,
  };
  let attempts = 0;
  let refreshCalls = 0;
  const coordinator = createTokenCoordinator({
    loadTokens: () => stored,
    saveTokens: (_characterId, tokens) => {
      stored = tokens;
    },
    clearTokens: () => {
      stored = null;
    },
    refreshTokens: async () => {
      refreshCalls++;
      return { access_token: 'replacement', expires_in: 3_600 };
    },
    validateAccessToken: token => token,
    validateLifetime: lifetime => lifetime,
    now: () => 1_000,
  });

  const result = await coordinator.runWithToken(42, async (_characterId, token) => {
    attempts++;
    if (token === 'revoked') throw new Error('ESI request failed with HTTP 401');
    return token;
  });

  assert.equal(result, 'replacement');
  assert.equal(attempts, 2);
  assert.equal(refreshCalls, 1);
});

test('token coordinator clears a definitively revoked authorization', async () => {
  let stored = {
    access_token: 'expired',
    refresh_token: 'revoked-refresh',
    expires_at: 900,
  };
  let clearCalls = 0;
  const coordinator = createTokenCoordinator({
    loadTokens: () => stored,
    saveTokens: (_characterId, tokens) => {
      stored = tokens;
    },
    clearTokens: () => {
      clearCalls++;
      stored = null;
    },
    refreshTokens: async () => {
      const error = new Error('EVE SSO request failed with HTTP 400');
      error.errorCode = 'invalid_grant';
      throw error;
    },
    validateAccessToken: token => token,
    validateLifetime: lifetime => lifetime,
    now: () => 1_000,
    refreshSkewMs: 60,
  });

  await assert.rejects(
    coordinator.getAccessToken(42),
    /authorization expired or was revoked/
  );
  assert.equal(clearCalls, 1);
  assert.equal(stored, null);
});

test('failed stale refresh cannot erase a newer authorization', async () => {
  let stored = {
    access_token: 'expired',
    refresh_token: 'old-refresh',
    expires_at: 900,
  };
  let clearCalls = 0;
  const coordinator = createTokenCoordinator({
    loadTokens: () => stored,
    saveTokens: (_characterId, tokens) => {
      stored = tokens;
    },
    clearTokens: () => {
      clearCalls++;
      stored = null;
    },
    refreshTokens: async () => {
      stored = {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: 100_000,
      };
      const error = new Error('EVE SSO request failed with HTTP 400');
      error.errorCode = 'invalid_grant';
      throw error;
    },
    validateAccessToken: token => token,
    validateLifetime: lifetime => lifetime,
    now: () => 1_000,
    refreshSkewMs: 60,
  });

  await assert.rejects(
    coordinator.getAccessToken(42),
    /authorization expired or was revoked/
  );
  assert.equal(clearCalls, 0);
  assert.equal(stored.refresh_token, 'new-refresh');
});

test('token coordinator preserves authorization during transient refresh failures', async () => {
  const stored = {
    access_token: 'expired',
    refresh_token: 'valid-refresh',
    expires_at: 900,
  };
  let clearCalls = 0;
  const coordinator = createTokenCoordinator({
    loadTokens: () => stored,
    saveTokens: () => {},
    clearTokens: () => {
      clearCalls++;
    },
    refreshTokens: async () => {
      const error = new Error('EVE SSO request failed with HTTP 503');
      error.statusCode = 503;
      throw error;
    },
    validateAccessToken: token => token,
    validateLifetime: lifetime => lifetime,
    now: () => 1_000,
    refreshSkewMs: 60,
  });

  await assert.rejects(coordinator.getAccessToken(42), /HTTP 503/);
  assert.equal(clearCalls, 0);
});

test('transition tracker requires consecutive entry observations', () => {
  const tracker = createTransitionTracker();

  assert.equal(tracker.observe({
    inAbyss: true,
    isCapsule: false,
    observedAt: 100,
  }), null);
  assert.equal(tracker.observe({
    inAbyss: false,
    isCapsule: false,
    observedAt: 105,
  }), null);
  assert.equal(tracker.observe({
    inAbyss: true,
    isCapsule: false,
    observedAt: 110,
  }), null);
  assert.deepEqual(tracker.observe({
    inAbyss: true,
    isCapsule: false,
    observedAt: 115,
  }), {
    type: 'entered',
    observedAt: 110,
  });
});

test('transition tracker confirms exits and remembers capsule evidence', () => {
  const tracker = createTransitionTracker({ initialPhase: 'inside' });

  assert.equal(tracker.observe({
    inAbyss: true,
    isCapsule: true,
    observedAt: 200,
  }), null);
  assert.equal(tracker.observe({
    inAbyss: false,
    isCapsule: false,
    observedAt: 205,
  }), null);
  assert.deepEqual(tracker.observe({
    inAbyss: false,
    isCapsule: true,
    observedAt: 210,
  }), {
    type: 'exited',
    observedAt: 205,
    outcome: 'Died',
  });
});

test('transition tracker ignores one stale outside observation', () => {
  const tracker = createTransitionTracker({ initialPhase: 'inside' });

  assert.equal(tracker.observe({
    inAbyss: false,
    isCapsule: false,
    observedAt: 300,
  }), null);
  assert.equal(tracker.observe({
    inAbyss: true,
    isCapsule: false,
    observedAt: 305,
  }), null);
  assert.equal(tracker.observe({
    inAbyss: false,
    isCapsule: false,
    observedAt: 310,
  }), null);
  assert.deepEqual(tracker.observe({
    inAbyss: false,
    isCapsule: false,
    observedAt: 315,
  }), {
    type: 'exited',
    observedAt: 310,
    outcome: 'Survived',
  });
});
