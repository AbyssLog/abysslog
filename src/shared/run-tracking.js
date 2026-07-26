(function exposeRunTracking(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssRunTracking = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function createSingleFlight() {
    const pending = new Map();

    return function singleFlight(key, operation) {
      if (pending.has(key)) return pending.get(key);
      if (typeof operation !== 'function') throw new TypeError('Operation must be a function');

      const promise = Promise.resolve().then(operation);
      pending.set(key, promise);
      const cleanup = () => {
        if (pending.get(key) === promise) pending.delete(key);
      };
      promise.then(cleanup, cleanup);
      return promise;
    };
  }

  function createTokenCoordinator({
    loadTokens,
    saveTokens,
    clearTokens,
    refreshTokens,
    validateAccessToken,
    validateLifetime,
    now = () => Date.now(),
    refreshSkewMs = 60_000,
    isUnauthorizedError = error => /\bHTTP 401\b/.test(error?.message || ''),
    isInvalidRefreshError = error => error?.errorCode === 'invalid_grant',
  }) {
    for (const [label, operation] of Object.entries({
      loadTokens,
      saveTokens,
      clearTokens,
      refreshTokens,
      validateAccessToken,
      validateLifetime,
      now,
      isUnauthorizedError,
      isInvalidRefreshError,
    })) {
      if (typeof operation !== 'function') throw new TypeError(`${label} must be a function`);
    }
    if (!Number.isSafeInteger(refreshSkewMs) || refreshSkewMs < 0) {
      throw new TypeError('Token refresh skew must be a non-negative integer');
    }

    const refreshSingleFlight = createSingleFlight();

    function requireTokens(characterId) {
      const tokens = loadTokens(characterId);
      if (!tokens) throw new Error('Character authorization is unavailable');
      return tokens;
    }

    async function refreshAccessToken(characterId, rejectedAccessToken = null) {
      return refreshSingleFlight(characterId, async () => {
        const current = requireTokens(characterId);
        if (
          rejectedAccessToken !== null
          && current.access_token !== rejectedAccessToken
        ) {
          return validateAccessToken(current.access_token);
        }
        if (
          rejectedAccessToken === null
          && current.expires_at
          && now() <= current.expires_at - refreshSkewMs
        ) {
          return validateAccessToken(current.access_token);
        }

        let refreshed;
        try {
          refreshed = await refreshTokens(current.refresh_token);
        } catch (error) {
          if (isInvalidRefreshError(error)) {
            const latest = loadTokens(characterId);
            if (latest?.refresh_token === current.refresh_token) {
              await clearTokens(characterId);
            }
            throw new Error(
              'Character authorization expired or was revoked; re-authenticate in Settings',
              { cause: error }
            );
          }
          throw error;
        }
        const merged = {
          ...current,
          ...refreshed,
          refresh_token: refreshed.refresh_token || current.refresh_token,
          expires_at: now() + validateLifetime(refreshed.expires_in) * 1000,
        };
        saveTokens(characterId, merged);
        return validateAccessToken(merged.access_token);
      });
    }

    async function getAccessToken(characterId) {
      const tokens = requireTokens(characterId);
      if (!tokens.expires_at || now() > tokens.expires_at - refreshSkewMs) {
        return refreshAccessToken(characterId);
      }
      return validateAccessToken(tokens.access_token);
    }

    async function runWithToken(characterId, operation) {
      if (typeof operation !== 'function') throw new TypeError('Token operation must be a function');
      const accessToken = await getAccessToken(characterId);
      try {
        return await operation(characterId, accessToken);
      } catch (error) {
        if (!isUnauthorizedError(error)) throw error;
        const refreshedToken = await refreshAccessToken(characterId, accessToken);
        return operation(characterId, refreshedToken);
      }
    }

    return { getAccessToken, runWithToken };
  }

  function createTransitionTracker({
    initialPhase = 'outside',
    confirmations = 2,
  } = {}) {
    if (initialPhase !== 'outside' && initialPhase !== 'inside') {
      throw new TypeError('Initial phase must be outside or inside');
    }
    if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 10) {
      throw new TypeError('Confirmations must be an integer between 1 and 10');
    }

    let phase = initialPhase;
    let candidate = null;

    function reset(nextPhase = phase) {
      if (nextPhase !== 'outside' && nextPhase !== 'inside') {
        throw new TypeError('Phase must be outside or inside');
      }
      phase = nextPhase;
      candidate = null;
    }

    function observe({ inAbyss, isCapsule, observedAt }) {
      if (typeof inAbyss !== 'boolean' || typeof isCapsule !== 'boolean') {
        throw new TypeError('ESI observation flags must be booleans');
      }
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
        throw new TypeError('ESI observation time must be a non-negative integer');
      }

      if (phase === 'outside') {
        if (!inAbyss) {
          candidate = null;
          return null;
        }
        if (!candidate || candidate.type !== 'entered') {
          candidate = { type: 'entered', count: 0, observedAt };
        }
        candidate.count++;
        if (candidate.count < confirmations) return null;

        const transition = { type: 'entered', observedAt: candidate.observedAt };
        phase = 'inside';
        candidate = null;
        return transition;
      }

      if (inAbyss) {
        candidate = null;
        return null;
      }
      if (!candidate || candidate.type !== 'exited') {
        candidate = {
          type: 'exited',
          count: 0,
          observedAt,
          capsuleSeen: false,
        };
      }
      candidate.count++;
      candidate.capsuleSeen ||= isCapsule;
      if (candidate.count < confirmations) return null;

      const transition = {
        type: 'exited',
        observedAt: candidate.observedAt,
        outcome: candidate.capsuleSeen ? 'Died' : 'Survived',
      };
      phase = 'outside';
      candidate = null;
      return transition;
    }

    return {
      observe,
      reset,
      getPhase: () => phase,
    };
  }

  function calculateBackoffDelay(baseDelayMs, failureCount, capMs = 60_000) {
    if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 1) {
      throw new TypeError('Base delay must be a positive integer');
    }
    if (!Number.isSafeInteger(failureCount) || failureCount < 1) {
      throw new TypeError('Failure count must be a positive integer');
    }
    if (!Number.isSafeInteger(capMs) || capMs < baseDelayMs) {
      throw new TypeError('Backoff cap must be at least the base delay');
    }
    return Math.min(capMs, baseDelayMs * (2 ** Math.min(failureCount - 1, 20)));
  }

  const FILAMENT_TIERS = Object.freeze({
    tranquil: 'T0',
    calm: 'T1',
    agitated: 'T2',
    fierce: 'T3',
    raging: 'T4',
    chaotic: 'T5',
    cataclysmic: 'T6',
  });
  const FILAMENT_WEATHERS = Object.freeze({
    electrical: 'Electrical',
    dark: 'Dark',
    exotic: 'Exotic',
    firestorm: 'Firestorm',
    gamma: 'Gamma',
  });

  function inferAbyssalFilament(items) {
    if (!Array.isArray(items)) throw new TypeError('Cargo items must be an array');
    const matches = new Map();
    for (const item of items) {
      if (!item || typeof item.name !== 'string') continue;
      const match = item.name.trim().match(
        /^(Tranquil|Calm|Agitated|Fierce|Raging|Chaotic|Cataclysmic) (Electrical|Dark|Exotic|Firestorm|Gamma) Filament$/i
      );
      if (!match) continue;
      const tier = FILAMENT_TIERS[match[1].toLowerCase()];
      const weather = FILAMENT_WEATHERS[match[2].toLowerCase()];
      matches.set(`${tier}:${weather}`, {
        tier,
        weather,
        name: `${match[1]} ${match[2]} Filament`,
      });
    }
    const candidates = [...matches.values()];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return { ...candidates[0], ambiguous: false };
    return { ambiguous: true, candidates };
  }

  function parseInventoryPaste(raw) {
    if (typeof raw !== 'string') throw new TypeError('Inventory paste must be text');
    if (!raw.trim()) return [];

    const items = new Map();
    const addItem = (name, quantity) => {
      const nextQuantity = (items.get(name) || 0) + quantity;
      if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 1_000_000_000) {
        throw new RangeError(`Inventory quantity for ${name} is too large`);
      }
      items.set(name, nextQuantity);
    };

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const columns = trimmed.split(/\t/);
      if (columns.length >= 2) {
        const name = columns[0].trim();
        const quantityText = columns[1]
          .trim()
          .replace(/^x/i, '')
          .replace(/,/g, '')
          .replace(/\s.*$/, '');
        if (name && /^\d+$/.test(quantityText)) {
          const quantity = Number(quantityText);
          if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new RangeError(`Inventory quantity for ${name} is invalid`);
          }
          addItem(name, quantity);
          continue;
        }
        if (name.length > 2) {
          addItem(name, 1);
          continue;
        }
      }

      if (columns.length === 1) {
        const quantityMatch = trimmed.match(/^(.+?)\s+x\s*([0-9,]+)\s*$/i);
        if (quantityMatch) {
          const name = quantityMatch[1].trim();
          const quantity = Number(quantityMatch[2].replace(/,/g, ''));
          if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new RangeError(`Inventory quantity for ${name} is invalid`);
          }
          addItem(name, quantity);
          continue;
        }
        if (trimmed.length > 2) addItem(trimmed, 1);
      }
    }

    return [...items.entries()].map(([name, qty]) => ({ name, qty }));
  }

  function mergeInventoryItems(...groups) {
    const items = new Map();
    for (const group of groups) {
      if (!Array.isArray(group)) throw new TypeError('Inventory items must be arrays');
      for (const item of group) {
        if (
          !item
          || typeof item.name !== 'string'
          || !item.name.trim()
          || !Number.isSafeInteger(item.qty)
          || item.qty <= 0
        ) {
          throw new TypeError('Inventory item is invalid');
        }
        const nextQuantity = (items.get(item.name) || 0) + item.qty;
        if (!Number.isSafeInteger(nextQuantity) || nextQuantity > 1_000_000_000) {
          throw new RangeError(`Inventory quantity for ${item.name} is too large`);
        }
        items.set(item.name, nextQuantity);
      }
    }
    return [...items.entries()].map(([name, qty]) => ({ name, qty }));
  }

  function diffInventoryPastes(beforeRaw, afterRaw) {
    const before = new Map(
      parseInventoryPaste(beforeRaw).map(item => [item.name, item.qty])
    );
    const after = new Map(
      parseInventoryPaste(afterRaw).map(item => [item.name, item.qty])
    );
    const gained = [];
    const consumed = [];
    const names = new Set([...before.keys(), ...after.keys()]);

    for (const name of names) {
      const beforeQuantity = before.get(name) || 0;
      const afterQuantity = after.get(name) || 0;
      if (afterQuantity > beforeQuantity) {
        gained.push({ name, qty: afterQuantity - beforeQuantity });
      } else if (beforeQuantity > afterQuantity) {
        consumed.push({ name, qty: beforeQuantity - afterQuantity });
      }
    }
    return { gained, consumed };
  }

  return {
    calculateBackoffDelay,
    createSingleFlight,
    createTokenCoordinator,
    createTransitionTracker,
    diffInventoryPastes,
    inferAbyssalFilament,
    mergeInventoryItems,
    parseInventoryPaste,
  };
});
