const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const security = require('../src/shared/security');

const projectRoot = path.resolve(__dirname, '..');

test('escapeHtml neutralizes markup and attribute delimiters', () => {
  const payload = `<img src=x onerror="window.pwned=true">'`;
  const escaped = security.escapeHtml(payload);

  assert.equal(
    escaped,
    '&lt;img src=x onerror=&quot;window.pwned=true&quot;&gt;&#39;'
  );
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);
  assert.equal(escaped.includes('"'), false);
  assert.equal(escaped.includes("'"), false);
});

test('external URL allowlist accepts only intended HTTPS destinations', () => {
  assert.equal(
    security.isAllowedExternalUrl('https://login.eveonline.com/v2/oauth/authorize?client_id=test'),
    true
  );
  assert.equal(security.isAllowedExternalUrl('https://discord.gg/janice'), true);
  assert.equal(
    security.isAllowedExternalUrl('https://github.com/AbyssLog/abysslog/releases/latest'),
    true
  );

  for (const value of [
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'http://github.com/AbyssLog/abysslog/releases/latest',
    'https://github.com.attacker.example/AbyssLog/abysslog/releases/latest',
    'https://github.com/openai/openai/releases/latest',
    'https://user:password@github.com/AbyssLog/abysslog/releases/latest',
    'https://github.com:444/AbyssLog/abysslog/releases/latest',
  ]) {
    assert.equal(security.isAllowedExternalUrl(value), false, value);
  }
});

test('OAuth callbacks require the exact route, state, and expected parameters', () => {
  assert.deepEqual(
    security.parseOAuthCallback('eveauth-abysslog://callback?code=abc&state=xyz'),
    { code: 'abc', state: 'xyz' }
  );
  assert.deepEqual(
    security.parseOAuthCallback(
      'eveauth-abysslog://callback?error=access_denied&error_description=No&state=xyz'
    ),
    { error: 'access_denied', errorDescription: 'No', state: 'xyz' }
  );

  for (const value of [
    'https://callback?code=abc&state=xyz',
    'eveauth-abysslog://other?code=abc&state=xyz',
    'eveauth-abysslog://callback?code=abc',
    'eveauth-abysslog://callback?code=abc&state=one&state=two',
    'eveauth-abysslog://callback?code=abc&state=xyz&unexpected=true',
  ]) {
    assert.throws(() => security.parseOAuthCallback(value), value);
  }
});

test('public settings and appraisal data are bounded and validated', () => {
  assert.equal(security.validatePublicSetting('default_tier', 'T6'), 'T6');
  assert.equal(security.validatePublicSetting('esi_poll_interval', '5'), '5');
  assert.throws(() => security.validatePublicSetting('tokens_123', 'secret'));
  assert.throws(() => security.validatePublicSetting('default_tier', '<img>'));
  assert.throws(() => security.validatePublicSetting('esi_poll_interval', '1'));

  assert.deepEqual(
    security.validateAppraisalItems([{ name: 'Tritanium', qty: 2 }]),
    [{ name: 'Tritanium', qty: 2 }]
  );
  assert.throws(() => security.validateAppraisalItems([{ name: '', qty: 1 }]));
  assert.throws(() => security.validateAppraisalItems([{ name: '   ', qty: 1 }]));
  assert.throws(() => security.validateAppraisalItems([{ name: 'Tritanium\nPLEX', qty: 1 }]));
  assert.throws(() => security.validateAppraisalItems([{ name: 'Tritanium', qty: 0 }]));
});

test('run IPC payloads are schema-validated and sanitized', () => {
  const run = security.validateRunData({
    character_id: 123,
    started_at: 1_700_000_000,
    duration: 1200,
    tier: 'T4',
    weather: 'Electrical',
    outcome: 'Survived',
    loot_value: 100,
    consumed_cost: 25,
    net_isk: 75,
    total_loss: 0,
    ship_class: 'Cruiser',
    items: [{
      item_name: 'Triglavian Survey Database',
      qty: 1,
      type: 'gained',
      unit_price_buy: 100,
      unit_price_sell: 110,
    }],
  });

  assert.equal(run.net_isk, 75);
  assert.equal(run.cargo_before, '');
  assert.deepEqual(security.validateRunFilters({ character_id: '123', limit: 5 }), {
    character_id: 123,
    limit: 5,
  });
  assert.throws(() => security.validateRunData({ ...run, outcome: 'Won' }));
  assert.throws(() => security.validateRunData({ ...run, unexpected: true }));
  assert.throws(() => security.validateRunFilters({ limit: 1001 }));
  assert.throws(() => security.validateAppraisalUpdate({
    loot_value: 1,
    consumed_cost: 0,
    net_isk: 1,
    cargo_before: '',
    cargo_after: '',
    items: [{ item_name: 'Item', qty: 1, type: 'unknown' }],
  }));
});

test('Janice responses are reduced to a safe renderer-facing schema', () => {
  const result = security.validateJaniceResponse({
    items: [{
      itemType: { name: 'Tritanium', ignored: '<script>' },
      amount: 2,
      effectivePrices: {
        buyPrice: 5,
        sellPrice: 6,
        buyPriceTotal: 10,
        sellPriceTotal: 12,
      },
      buyOrderCount: 1,
      sellOrderCount: 1,
      ignored: '<script>',
    }],
    effectivePrices: { totalBuyPrice: 10, totalSellPrice: 12 },
    failures: '',
    datasetTime: '2026-07-26T00:00:00Z',
    ignored: '<script>',
  });

  assert.deepEqual(Object.keys(result.items[0]).sort(), [
    'amount',
    'buyOrderCount',
    'effectivePrices',
    'itemType',
    'sellOrderCount',
  ]);
  assert.throws(() => security.validateJaniceResponse({
    items: [{
      itemType: { name: 'Tritanium' },
      amount: '<img src=x onerror=alert(1)>',
      effectivePrices: {
        buyPrice: 5,
        sellPrice: 6,
        buyPriceTotal: 10,
        sellPriceTotal: 12,
      },
    }],
    effectivePrices: { totalBuyPrice: 10, totalSellPrice: 12 },
  }));
});

test('CSV cells neutralize spreadsheet formulas without changing numeric values', () => {
  assert.equal(security.escapeCsvCell('=HYPERLINK("https://example.test")'), `"'=HYPERLINK(""https://example.test"")"`);
  assert.equal(security.escapeCsvCell('  @SUM(1,2)'), `"'  @SUM(1,2)"`);
  assert.equal(security.escapeCsvCell(-42), '-42');
  assert.equal(security.escapeCsvCell('ordinary'), 'ordinary');
  assert.equal(security.unescapeCsvCell("'=SUM(1,2)"), '=SUM(1,2)');
  assert.equal(security.unescapeCsvCell("''literal"), "'literal");
  assert.equal(
    security.unescapeCsvCell(security.escapeCsvCell("'=literal")),
    "'=literal"
  );
});

test('renderer policy blocks inline script and inline event handlers', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'src/main/preload.js'), 'utf8');

  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  const scriptDirective = csp.split(';').map(part => part.trim()).find(part => part.startsWith('script-src'));
  assert.equal(scriptDirective, "script-src 'self'");
  assert.doesNotMatch(html, /\son(?:click|error|input|change)\s*=/i);
  assert.doesNotMatch(appJs, /\son(?:click|error|input|change)\s*=/i);
  assert.match(appJs, /\$\{esc\(r\.tier\)\}/);
  assert.match(appJs, /\$\{esc\(r\.weather\)\}/);
  assert.doesNotMatch(preload, /getTokens|saveTokens|refreshToken|verifyToken/);
});

test('IPC bridge matches guarded main-process handlers', () => {
  const main = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'src/main/preload.js'), 'utf8');
  const database = fs.readFileSync(path.join(projectRoot, 'src/main/database.js'), 'utf8');

  const handlerChannels = new Set(
    [...main.matchAll(/secureHandle\('([^']+)'/g)].map(match => match[1])
  );
  const invokedChannels = new Set(
    [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1])
  );

  assert.deepEqual([...invokedChannels].sort(), [...handlerChannels].sort());
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /if \(!validateIpcSender\(event\)\)/);
  assert.match(main, /security\.validateRunData/);
  assert.match(main, /security\.validateAppraisalUpdate/);
  assert.match(main, /if \(!db\.getSetting\('janice_api_key'\)\) \{[\s\S]*db\.hardenSensitiveStorage\(\);[\s\S]*db\.finishStartup\(\);/);
  assert.match(database, /secure_delete = ON/);
  assert.match(database, /quick_check/);
  assert.match(database, /user_version/);
  assert.match(database, /wal_checkpoint\(TRUNCATE\)/);
  assert.match(database, /AUTOMATIC_BACKUP_RETENTION = 7/);
});

test('CI uses read-only permissions, immutable Actions, and no build token', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github/workflows/build.yml'),
    'utf8'
  );

  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|GH_TOKEN/);
  for (const line of workflow.split(/\r?\n/).filter(value => value.includes('uses: actions/'))) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#\s+v[\d.]+)?$/);
  }
});

test('release publishing fails closed and isolates its write token', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github/workflows/release.yml'),
    'utf8'
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const beforePublishJob = workflow.split(/\n  publish:\s*\n/)[0];

  assert.match(workflow, /environment: release/);
  assert.match(packageJson.scripts['build:win:release'], /--config\.forceCodeSigning=true/);
  assert.match(workflow, /Get-AuthenticodeSignature/);
  assert.match(workflow, /TimeStamperCertificate/);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.doesNotMatch(beforePublishJob, /GH_TOKEN|GITHUB_TOKEN|github\.token/);
  assert.match(workflow, /permissions:\s*\n\s+contents: write/);
  for (const line of workflow.split(/\r?\n/).filter(value => value.includes('uses: actions/'))) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#\s+v[\d.]+)?$/);
  }
});

test('packaging locks security-sensitive Electron fuses', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const fuses = packageJson.build.electronFuses;

  assert.deepEqual(fuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  });
});
