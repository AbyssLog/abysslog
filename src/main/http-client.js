const https = require('https');

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_SERVER_DELAY_MS = 5 * 60_000;

class HttpError extends Error {
  constructor(message, {
    statusCode = null,
    headers = {},
    retryable = false,
  } = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.headers = headers;
    this.retryable = retryable;
  }
}

function headerValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseRetryAfter(headers, now) {
  const value = headerValue(headers, 'retry-after');
  if (value == null) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_SERVER_DELAY_MS, Math.ceil(seconds * 1000));
  }
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp)
    ? Math.min(MAX_SERVER_DELAY_MS, Math.max(0, timestamp - now()))
    : 0;
}

function isRetryableStatus(statusCode) {
  return statusCode === 408
    || statusCode === 420
    || statusCode === 429
    || statusCode >= 500;
}

function createHttpClient({
  transport = https,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  random = () => Math.random(),
} = {}) {
  let blockedUntil = 0;

  function updateRateLimit(headers) {
    const remaining = Number(headerValue(headers, 'x-esi-error-limit-remain'));
    const resetSeconds = Number(headerValue(headers, 'x-esi-error-limit-reset'));
    if (
      Number.isFinite(remaining)
      && remaining <= 5
      && Number.isFinite(resetSeconds)
      && resetSeconds > 0
    ) {
      blockedUntil = Math.max(
        blockedUntil,
        now() + Math.min(MAX_SERVER_DELAY_MS, Math.ceil(resetSeconds * 1000))
      );
    }
  }

  async function waitForRateLimit() {
    const delay = blockedUntil - now();
    if (delay > 0) await sleep(delay);
  }

  function requestOnce(url, {
    method,
    headers,
    body,
    label,
    maxResponseBytes,
    timeoutMs,
  }) {
    return new Promise((resolve, reject) => {
      const urlObject = new URL(url);
      const bodyBuffer = body == null
        ? null
        : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
      const requestHeaders = { ...headers };
      if (bodyBuffer && requestHeaders['Content-Length'] == null) {
        requestHeaders['Content-Length'] = bodyBuffer.length;
      }

      let settled = false;
      const finish = (operation, value) => {
        if (settled) return;
        settled = true;
        operation(value);
      };

      const request = transport.request({
        protocol: urlObject.protocol,
        hostname: urlObject.hostname,
        port: urlObject.port || undefined,
        path: `${urlObject.pathname}${urlObject.search}`,
        method,
        headers: requestHeaders,
      }, response => {
        const chunks = [];
        let responseBytes = 0;

        response.on('data', chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.length;
          if (responseBytes > maxResponseBytes) {
            const error = new HttpError(`${label} response is too large`);
            finish(reject, error);
            response.destroy(error);
            return;
          }
          chunks.push(buffer);
        });
        response.on('error', error => {
          finish(reject, error);
        });
        response.on('end', () => {
          if (settled) return;
          const statusCode = response.statusCode || 0;
          const responseHeaders = response.headers || {};
          const text = Buffer.concat(chunks).toString('utf8');
          if (statusCode >= 400) {
            finish(reject, new HttpError(
              `${label} request failed with HTTP ${statusCode}`,
              {
                statusCode,
                headers: responseHeaders,
                retryable: isRetryableStatus(statusCode),
              }
            ));
            return;
          }
          try {
            finish(resolve, {
              data: JSON.parse(text),
              headers: responseHeaders,
              statusCode,
            });
          } catch {
            finish(reject, new HttpError(`${label} returned invalid JSON`));
          }
        });
      });

      request.on('error', error => {
        if (error instanceof HttpError) {
          finish(reject, error);
        } else {
          finish(reject, new HttpError(
            error instanceof Error ? error.message : `${label} request failed`,
            { retryable: true }
          ));
        }
      });
      request.setTimeout(timeoutMs, () => {
        request.destroy(new HttpError(`${label} request timed out`, { retryable: true }));
      });
      request.end(bodyBuffer || undefined);
    });
  }

  async function requestJson(url, {
    method = 'GET',
    headers = {},
    body = null,
    label = 'HTTP',
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    retryBaseMs = 250,
    includeResponseMetadata = false,
  } = {}) {
    if (!Number.isSafeInteger(retries) || retries < 0 || retries > 5) {
      throw new TypeError('HTTP retries must be an integer between 0 and 5');
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
      throw new TypeError('Maximum response size must be a positive integer');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new TypeError('HTTP timeout must be a positive integer');
    }
    if (typeof includeResponseMetadata !== 'boolean') {
      throw new TypeError('HTTP response metadata option must be a boolean');
    }

    for (let attempt = 0; ; attempt++) {
      await waitForRateLimit();
      try {
        const result = await requestOnce(url, {
          method,
          headers,
          body,
          label,
          maxResponseBytes,
          timeoutMs,
        });
        updateRateLimit(result.headers);
        return includeResponseMetadata ? result : result.data;
      } catch (error) {
        updateRateLimit(error.headers);
        if (!(error instanceof HttpError) || !error.retryable || attempt >= retries) {
          throw error;
        }
        const serverDelay = parseRetryAfter(error.headers, now);
        const backoff = Math.min(
          30_000,
          retryBaseMs * (2 ** attempt) + Math.floor(random() * retryBaseMs)
        );
        await sleep(Math.max(serverDelay, backoff));
      }
    }
  }

  return { requestJson };
}

module.exports = {
  HttpError,
  createHttpClient,
  parseRetryAfter,
};
