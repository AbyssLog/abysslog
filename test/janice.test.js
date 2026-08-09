const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const { version } = require('../package.json');

test('Janice requests identify the installed package version', async () => {
  const janicePath = path.join(__dirname, '..', 'src', 'main', 'janice.js');
  const originalLoad = Module._load;
  let capturedRequest;

  Module._load = function mockJaniceDependencies(request, parent, isMain) {
    if (parent?.filename === janicePath && request === './http-client') {
      return {
        createHttpClient: () => ({
          requestJson: async (url, options) => {
            capturedRequest = { url, options };
            return {
              items: [],
              effectivePrices: { totalBuyPrice: 0, totalSellPrice: 0 },
              failures: '',
              datasetTime: null,
            };
          },
        }),
      };
    }
    if (parent?.filename === janicePath && request === '../shared/security') {
      return { validateJaniceResponse: response => response };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let janice;
  try {
    delete require.cache[require.resolve(janicePath)];
    janice = require(janicePath);
  } finally {
    Module._load = originalLoad;
  }

  try {
    await janice.appraise([{ name: 'Tritanium', qty: 1 }], 'buy', 'secret');
    assert.equal(capturedRequest.options.headers['User-Agent'], `AbyssLog/${version}`);
  } finally {
    delete require.cache[require.resolve(janicePath)];
  }
});
