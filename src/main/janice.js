const https = require('https');
const security = require('../shared/security');

const JANICE_BASE = 'https://janice.e-351.com';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Appraise a list of items via Janice API v2
 * @param {Array<{name: string, qty: number}>} items
 * @param {'buy'|'sell'} pricing - 'buy' for loot (instant sell), 'sell' for consumed/lost (replacement cost)
 * @param {string} apiKey
 */
function appraise(items, pricing, apiKey) {
  if (!items || items.length === 0) {
    return Promise.resolve({ items: [], totalBuyPrice: 0, totalSellPrice: 0, failures: '', unresolved: [] });
  }

  // Build the raw text body — one item per line, \n separated
  const body = items.map(i => `${i.name} x${i.qty}`).join('\n');

  const query = new URLSearchParams({
    market: '2',
    designation: 'appraisal',
    pricing: pricing,
    compactize: 'true',
    persist: 'false'
  }).toString();

  const path = `/api/rest/v2/appraisal?${query}`;

  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, 'utf8');
    const options = {
      hostname: 'janice.e-351.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': bodyBuf.length,
        'X-ApiKey': apiKey,
        'User-Agent': 'AbyssLog/1.0'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
        if (data.length > MAX_RESPONSE_BYTES) {
          res.destroy(new Error('Janice response is too large'));
        }
      });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Janice request failed with HTTP ${res.statusCode}`));
          return;
        }
        try {
          const result = security.validateJaniceResponse(JSON.parse(data));

          // Detect unresolved items by comparing submitted names against returned names
          const returnedNames = new Set(result.items.map(i => i.itemType.name.toLowerCase()));
          const submittedNames = items.map(i => i.name);
          const unresolved = submittedNames.filter(n => !returnedNames.has(n.toLowerCase()));

          // Flag zero-price items
          const zeroPriceItems = result.items.filter(i =>
            i.effectivePrices.buyPrice === 0 && i.effectivePrices.sellPrice === 0 &&
            i.buyOrderCount === 0 && i.sellOrderCount === 0
          ).map(i => i.itemType.name);

          resolve({
            items: result.items,
            totalBuyPrice: result.effectivePrices.totalBuyPrice,
            totalSellPrice: result.effectivePrices.totalSellPrice,
            failures: result.failures || '',
            unresolved,
            zeroPriceItems,
            datasetTime: result.datasetTime
          });
        } catch (e) {
          reject(new Error('Failed to parse Janice response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Janice request timed out')));
    req.write(bodyBuf);
    req.end();
  });
}

module.exports = { appraise };
