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
    refreshTokens,
    validateAccessToken,
    validateLifetime,
    now = () => Date.now(),
    refreshSkewMs = 60_000,
    isUnauthorizedError = error => /\bHTTP 401\b/.test(error?.message || ''),
  }) {
    for (const [label, operation] of Object.entries({
      loadTokens,
      saveTokens,
      refreshTokens,
      validateAccessToken,
      validateLifetime,
      now,
      isUnauthorizedError,
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

        const refreshed = await refreshTokens(current.refresh_token);
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

  return { createSingleFlight, createTokenCoordinator, createTransitionTracker };
});
