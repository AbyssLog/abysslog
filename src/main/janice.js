const { createHttpClient } = require('./http-client');
const security = require('../shared/security');

const JANICE_BASE = 'https://janice.e-351.com';
const USER_AGENT = 'AbyssLog/1.0';
const http = createHttpClient();

/**
 * Appraise a list of items via Janice API v2
 * @param {Array<{name: string, qty: number}>} items
 * @param {'buy'|'sell'} pricing
 * @param {string} apiKey
 */
async function appraise(items, pricing, apiKey) {
  if (!items || items.length === 0) {
    return {
      items: [],
      totalBuyPrice: 0,
      totalSellPrice: 0,
      failures: '',
      unresolved: [],
    };
  }

  const body = items.map(item => `${item.name} x${item.qty}`).join('\n');
  const query = new URLSearchParams({
    market: '2',
    designation: 'appraisal',
    pricing,
    compactize: 'true',
    persist: 'false',
  }).toString();

  const response = await http.requestJson(
    `${JANICE_BASE}/api/rest/v2/appraisal?${query}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-ApiKey': apiKey,
        'User-Agent': USER_AGENT,
      },
      body,
      label: 'Janice',
    }
  );
  const result = security.validateJaniceResponse(response);

  const returnedNames = new Set(
    result.items.map(item => item.itemType.name.toLowerCase())
  );
  const unresolved = items
    .map(item => item.name)
    .filter(name => !returnedNames.has(name.toLowerCase()));
  const zeroPriceItems = result.items
    .filter(item =>
      item.effectivePrices.buyPrice === 0
      && item.effectivePrices.sellPrice === 0
      && item.buyOrderCount === 0
      && item.sellOrderCount === 0)
    .map(item => item.itemType.name);

  return {
    items: result.items,
    totalBuyPrice: result.effectivePrices.totalBuyPrice,
    totalSellPrice: result.effectivePrices.totalSellPrice,
    failures: result.failures || '',
    unresolved,
    zeroPriceItems,
    datasetTime: result.datasetTime,
  };
}

module.exports = { appraise };
