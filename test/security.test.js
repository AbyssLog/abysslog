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
  assert.equal(
    security.isAllowedExternalUrl('https://github.com/AbyssLog/abysslog/blob/main/PRIVACY.md'),
    true
  );

  for (const value of [
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'http://github.com/AbyssLog/abysslog/releases/latest',
    'https://github.com.attacker.example/AbyssLog/abysslog/releases/latest',
    'https://github.com/openai/openai/releases/latest',
    'https://github.com/AbyssLog/abysslogger',
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
    hull_name: 'Gila',
    ship_class: 'Cruiser',
    system_id: 32_000_001,
    system_name: 'Abyssal #32000001',
    notes: 'New route',
    tags: ['Farm', 'farm', 'New Fit'],
    killmail_ids: [456, 456],
    appraised_at: 1_700_001_200,
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
  assert.deepEqual(run.tags, ['Farm', 'New Fit']);
  assert.deepEqual(run.killmail_ids, [456]);
  assert.equal(run.system_name, 'Abyssal #32000001');
  assert.deepEqual(security.validateRunFilters({
    character_id: '123',
    limit: 5,
    search: '  mutaplasmid  ',
    date_from: 1_700_000_000,
    date_to: 1_700_086_400,
    hull: ' Gila ',
    tag: ' Farm ',
    drop_item_name: ' Triglavian Survey Database ',
  }), {
    character_id: 123,
    search: 'mutaplasmid',
    date_from: 1_700_000_000,
    date_to: 1_700_086_400,
    hull: 'Gila',
    tag: 'Farm',
    drop_item_name: 'Triglavian Survey Database',
    limit: 5,
  });
  assert.deepEqual(security.validateStatsFilters({
    character_id: '123',
    range_start: 1_700_000_000,
    range_end: 1_700_086_400,
  }), {
    character_id: 123,
    range_start: 1_700_000_000,
    range_end: 1_700_086_400,
  });
  assert.throws(() => security.validateStatsFilters({ range_start: 20, range_end: 20 }));
  assert.throws(() => security.validateStatsFilters({ unexpected: true }));
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

  const meta = {
    tier: 'T5',
    weather: 'Gamma',
    outcome: 'Survived',
    duration: 900,
    started_at: 1_700_000_100,
    total_loss: 0,
    ship_class: 'Cruiser',
  };
  assert.throws(() => security.validateRunFilters({
    search: 'mutaplasmid',
    search_scope: 'lost',
  }));
  const edit = security.validateRunEdit({
    meta,
    cargo: {
      cargo_before: 'Nanite Repair Paste, 20',
      cargo_after: 'Triglavian Survey Database, 2',
      drone_before: 'Vespa II, 5',
      drone_after: '',
    },
  });
  assert.equal(edit.meta.tier, 'T5');
  assert.equal(edit.cargo.drone_after, '');
  assert.equal(edit.appraisal, null);
  assert.throws(() => security.validateRunEdit({ meta }));
  assert.throws(() => security.validateRunEdit({
    meta,
    cargo: edit.cargo,
    appraisal: {
      loot_value: 0,
      consumed_cost: 0,
      net_isk: 0,
      cargo_before: '',
      cargo_after: '',
      items: [],
    },
  }));
});

test('active run recovery snapshots are bounded and state-consistent', () => {
  const snapshot = security.validateActiveRunSnapshot({
    version: 2,
    state: 'in-abyss',
    run: {
      character_id: 123,
      started_at: 1_700_000_000,
      duration: 0,
      tier: 'T4',
      weather: 'Electrical',
      outcome: null,
      system_id: 32_000_001,
      system_name: 'Abyssal #32000001',
      notes: 'Watch the final room',
      tags: ['Testing', 'testing'],
      cargoBefore: 'Tritanium, 2',
      cargoAfter: '',
      droneBefore: 'Vespa II, 5',
      droneAfter: '',
      hull_name: 'Gila',
      ship_class: 'Cruiser',
      fitting: [],
      implants: [],
      killmailItems: [{ type_id: 12_345, type_name: 'Test Module', qty: 1 }],
      killmailIds: [456],
      fitCaptured: false,
    },
  });

  assert.equal(snapshot.state, 'in-abyss');
  assert.equal(snapshot.run.character_id, 123);
  assert.equal(snapshot.run.system_name, 'Abyssal #32000001');
  assert.equal(snapshot.run.notes, 'Watch the final room');
  assert.deepEqual(snapshot.run.tags, ['Testing']);
  assert.deepEqual(snapshot.run.killmailItems, [{
    type_id: 12_345,
    type_name: 'Test Module',
    qty: 1,
  }]);
  assert.deepEqual(snapshot.run.killmailIds, [456]);
  assert.throws(() => security.validateActiveRunSnapshot({
    ...snapshot,
    state: 'died',
  }), /outcome/);
  assert.throws(() => security.validateActiveRunSnapshot({
    ...snapshot,
    unexpected: true,
  }), /unexpected field/);
});

test('ESI and OAuth responses are reduced to bounded schemas', () => {
  assert.deepEqual(security.validateEsiLocation({
    solar_system_id: 32_000_001,
    structure_id: 123,
    ignored: '<script>',
  }), {
    solar_system_id: 32_000_001,
  });
  assert.deepEqual(security.validateEsiShip({
    ship_item_id: 99,
    ship_name: 'Reliable Gila',
    ship_type_id: 17_918,
    ignored: '<script>',
  }), {
    ship_item_id: 99,
    ship_type_id: 17_918,
  });
  assert.deepEqual(security.validateEsiAssets([{
    item_id: 100,
    is_singleton: true,
    location_flag: 'HiSlot0',
    location_id: 99,
    location_type: 'item',
    quantity: 1,
    type_id: 12_345,
    ignored: '<script>',
  }]), [{
    item_id: 100,
    is_singleton: true,
    location_flag: 'HiSlot0',
    location_id: 99,
    location_type: 'item',
    quantity: 1,
    type_id: 12_345,
  }]);
  assert.deepEqual(security.validateEsiFitting({
    ship_type_id: 17_918,
    items: [{
      flag: 'HiSlot0',
      quantity: 1,
      type_id: 12_345,
      ignored: '<script>',
    }],
  }), {
    ship_type_id: 17_918,
    items: [{ flag: 'HiSlot0', quantity: 1, type_id: 12_345 }],
  });
  assert.deepEqual(security.validateEsiKillmailRefs([{
    killmail_hash: 'safe_hash-123',
    killmail_id: 456,
    ignored: '<script>',
  }]), [{
    killmail_hash: 'safe_hash-123',
    killmail_id: 456,
  }]);
  assert.deepEqual(security.validateEsiKillmail({
    killmail_id: 456,
    killmail_time: '2026-07-26T12:00:00Z',
    solar_system_id: 32_000_001,
    victim: {
      character_id: 123,
      ship_type_id: 17_918,
      items: [{
        item_type_id: 12_345,
        quantity_destroyed: 2,
        quantity_dropped: 1,
      }],
    },
    ignored: '<script>',
  }), {
    killmail_id: 456,
    killmail_time: '2026-07-26T12:00:00Z',
    solar_system_id: 32_000_001,
    victim: {
      character_id: 123,
      ship_type_id: 17_918,
      items: [{ quantity: 3, type_id: 12_345 }],
    },
  });
  assert.deepEqual(security.validateOAuthTokenResponse({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 1_200,
    ignored: '<script>',
  }, { requireRefreshToken: true }), {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 1_200,
  });

  assert.throws(() => security.validateEsiLocation({
    solar_system_id: '<script>',
  }));
  assert.throws(() => security.validateEsiFitting({
    ship_type_id: 17_918,
    items: [{ flag: 'HiSlot0', quantity: 0, type_id: 12_345 }],
  }));
  assert.throws(() => security.validateEsiKillmailRefs([{
    killmail_hash: '../unsafe',
    killmail_id: 456,
  }]));
  assert.throws(() => security.validateOAuthTokenResponse({
    access_token: 'access',
    expires_in: 1_200,
  }, { requireRefreshToken: true }), /refresh token/i);
});

test('ESI feature selections map to least-privilege scopes and capabilities', () => {
  assert.deepEqual(
    security.validateEsiCapabilitySelection(['implants', 'tracking']),
    ['tracking', 'implants']
  );
  assert.deepEqual(security.getEsiScopesForCapabilities(['tracking', 'fitting']), [
    'esi-location.read_location.v1',
    'esi-location.read_ship_type.v1',
    'esi-assets.read_assets.v1',
  ]);
  assert.deepEqual(security.getEsiCapabilitiesForScopes([
    'esi-location.read_ship_type.v1',
    'esi-assets.read_assets.v1',
  ]), {
    tracking: false,
    fitting: true,
    implants: false,
    killmails: false,
  });
  assert.deepEqual(security.getEsiCapabilitiesForScopes([]), {
    tracking: false,
    fitting: false,
    implants: false,
    killmails: false,
  });
  assert.deepEqual(security.getEsiCapabilitiesForScopes([
    'esi-location.read_location.v1',
    'esi-location.read_ship_type.v1',
    'esi-location.read_online.v1',
    'esi-fittings.read_fittings.v1',
    'esi-clones.read_implants.v1',
  ]), {
    tracking: true,
    fitting: false,
    implants: true,
    killmails: false,
  });
  assert.deepEqual(security.getEsiCapabilitiesForScopes([
    'esi-killmails.read_killmails.v1',
  ]), {
    tracking: false,
    fitting: false,
    implants: false,
    killmails: true,
  });
  assert.throws(() => security.validateEsiCapabilitySelection(['tracking', 'tracking']));
  assert.throws(() => security.validateEsiCapabilitySelection(['wallet']));
  assert.throws(() => security.validateEsiScopes(['esi-wallet.read_character_wallet.v1']));
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
  const appraisalJs = fs.readFileSync(path.join(projectRoot, 'src/shared/appraisal.js'), 'utf8');
  const historyJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/history-view.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'src/main/preload.js'), 'utf8');
  const modalJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/modal-controller.js'), 'utf8');
  const navigationJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/navigation-controller.js'), 'utf8');
  const esi = fs.readFileSync(path.join(projectRoot, 'src/main/esi.js'), 'utf8');
  const loadoutControllerJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/loadout-controller.js'), 'utf8');
  const supportSettingsJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/support-settings-controller.js'), 'utf8');
  const uiTaskJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/ui-task-controller.js'), 'utf8');
  const runDetailsJs = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/run-details-controller.js'), 'utf8'
  );
  const manualRunJs = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/manual-run-controller.js'), 'utf8'
  );
  const characterJs = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/character-controller.js'), 'utf8'
  );

  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  const scriptDirective = csp.split(';').map(part => part.trim()).find(part => part.startsWith('script-src'));
  assert.equal(scriptDirective, "script-src 'self'");
  assert.doesNotMatch(html, /\son(?:click|error|input|change)\s*=/i);
  assert.doesNotMatch(appJs, /\son(?:click|error|input|change)\s*=/i);
  assert.match(appJs, /\$\{esc\(r\.tier\)\}/);
  assert.match(appJs, /\$\{esc\(r\.weather\)\}/);
  assert.doesNotMatch(appJs, /setInterval\(pollESI/);
  assert.match(appJs, /runESIPollLoop/);
  assert.match(appJs, /calculateBackoffDelay/);
  assert.match(characterJs, /getSelectedCapabilities/);
  assert.match(appJs, /S\.capabilities\.tracking/);
  assert.match(appJs, /inferAbyssalFilament/);
  assert.match(appJs, /restoreInventoryBaseline/);
  assert.match(appJs, /window\.api\.runs\.getInventoryBaseline/);
  assert.match(appJs, /window\.api\.runs\.clearInventoryBaseline/);
  assert.match(loadoutControllerJs, /api\.loadouts\.save/);
  assert.match(loadoutControllerJs, /createPresetFromInventoryText/);
  assert.match(html, /src="\.\.\/shared\/appraisal\.js"/);
  assert.match(html, /src="\.\.\/shared\/loadouts\.js"/);
  assert.match(appJs, /S\.capabilities\.killmails/);
  assert.match(manualRunJs, /currentEditOriginal\?\.total_loss\s*\|\|\s*0/);
  assert.match(manualRunJs, /drone_before:\s*droneBefore/);
  assert.match(runDetailsJs, /appraisalHelpers\.appraiseSurvivedInventory/);
  assert.match(appraisalJs, /diffOptionalInventoryPastes/);
  assert.match(appraisalJs, /mergeInventoryItems\(cargo\.gained,\s*drones\.gained\)/);
  assert.match(modalJs, /FOCUSABLE_SELECTOR/);
  assert.match(modalJs, /event\.key === 'Escape'/);
  assert.match(navigationJs, /aria-current/);
  assert.match(appJs, /aria-expanded/);
  assert.match(historyJs, /class="table-sort"/);
  assert.match(uiTaskJs, /function runUiTask/);
  assert.match(uiTaskJs, /Promise\.resolve\(\)\s*\.then\(operation\)/);
  assert.match(appJs, /window\.addEventListener\('unhandledrejection'/);
  assert.match(appJs, /'unhandled-rejection'/);
  assert.match(supportSettingsJs, /api\.diagnostics\.copySummary/);
  assert.doesNotMatch(appJs, /Promise\.resolve\(handler\(element\)\)/);
  assert.match(appJs, /persistActiveRun\(\)\.catch\(reportActiveRunCheckpointError\)/);
  assert.match(html, /src="\.\.\/shared\/ui-errors\.js"/);
  assert.match(manualRunJs, /api\.runs\.update\(currentEditRunId/);
  assert.doesNotMatch(appJs, /window\.api\.runs\.(?:updateMeta|updateCargoOnly)/);
  assert.match(appJs, /window\.api\.runs\.saveActive/);
  assert.match(esi, /validateEsiLocation/);
  assert.match(esi, /validateEsiShip/);
  assert.match(esi, /killmails\/recent/);
  assert.match(esi, /characters\/\$\{characterId\}\/assets/);
  assert.doesNotMatch(esi, /characters\/\$\{characterId\}\/fit\//);
  assert.doesNotMatch(preload, /getTokens|saveTokens|refreshToken|verifyToken/);
});

test('renderer exposes accessible form, dialog, and disclosure semantics', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const reportMarkup = fs.readFileSync(
    path.join(projectRoot, 'src/renderer/statistics-report-markup.js'),
    'utf8'
  );
  const accessibleMarkup = `${html}\n${reportMarkup}`;

  assert.match(html, /<title>AbyssLog<\/title>/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /id="globalErrorNotice"[^>]+role="alert"[^>]+aria-live="assertive"/);
  assert.doesNotMatch(html, /<div class="collapsible-header"/);
  assert.match(html, /class="collapsible-header"[^>]+aria-expanded="true"/);
  for (const tag of accessibleMarkup.match(/<(?:input|select|textarea)\b[^>]*>/g) || []) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    assert.ok(id, `Form control is missing an ID: ${tag}`);
    const hasAccessibleName = /\baria-label(?:ledby)?="[^"]+"/.test(tag)
      || new RegExp(`<label[^>]+for="${id}"`).test(accessibleMarkup);
    assert.equal(hasAccessibleName, true, `Form control ${id} is missing an accessible name`);
  }
});

test('IPC bridge matches guarded main-process handlers', () => {
  const main = fs.readFileSync(path.join(projectRoot, 'src/main/main.js'), 'utf8');
  const handlerSources = [
    fs.readFileSync(path.join(projectRoot, 'src/main/character-handlers.js'), 'utf8'),
    ...fs.readdirSync(path.join(projectRoot, 'src/main/ipc'))
      .filter(name => name.endsWith('.js'))
      .map(name => fs.readFileSync(path.join(projectRoot, 'src/main/ipc', name), 'utf8')),
  ];
  const handlerSource = handlerSources.join('\n');
  const preload = fs.readFileSync(path.join(projectRoot, 'src/main/preload.js'), 'utf8');
  const database = [
    fs.readFileSync(path.join(projectRoot, 'src/main/database.js'), 'utf8'),
    ...fs.readdirSync(path.join(projectRoot, 'src/main/database'))
      .filter(name => name.endsWith('.js'))
      .map(name => fs.readFileSync(path.join(projectRoot, 'src/main/database', name), 'utf8')),
  ].join('\n');
  const ipcGuard = fs.readFileSync(path.join(projectRoot, 'src/main/ipc-guard.js'), 'utf8');
  const credentials = fs.readFileSync(path.join(projectRoot, 'src/main/credential-service.js'), 'utf8');
  const oauth = fs.readFileSync(path.join(projectRoot, 'src/main/oauth-service.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(projectRoot, 'src/renderer/app.js'), 'utf8');
  const inventoryEditor = fs.readFileSync(path.join(projectRoot, 'src/renderer/inventory-editor.js'), 'utf8');

  const handlerChannels = new Set(
    [...([main, ...handlerSources].join('\n')).matchAll(/secureHandle\('([^']+)'/g)]
      .map(match => match[1])
  );
  const invokedChannels = new Set(
    [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1])
  );

  assert.deepEqual([...invokedChannels].sort(), [...handlerChannels].sort());
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /permission === 'clipboard-read'/);
  assert.match(main, /webContents === window\.webContents/);
  assert.match(main, /requestingUrl === APP_RENDERER_URL/);
  assert.match(main, /isMainFrame === true/);
  assert.match(main, /protocol\.registerSchemesAsPrivileged/);
  assert.match(main, /protocol\.handle\(APP_PROTOCOL_SCHEME/);
  assert.match(main, /await window\.loadURL\(APP_RENDERER_URL\)/);
  assert.doesNotMatch(main, /\.loadFile\(/);
  assert.match(main, /secureHandle: ipcGuard\.secureHandle/);
  assert.match(ipcGuard, /if \(!validateSender\(event\)\)/);
  assert.match(main, /createDiagnostics\(\{/);
  assert.match(main, /uncaughtExceptionMonitor/);
  assert.match(main, /render-process-gone/);
  assert.match(handlerSource, /clipboard\.writeText\(createDiagnosticsSummary\(\)\)/);
  assert.doesNotMatch(preload, /clipboard|node:fs|require\('fs'\)/);
  assert.match(inventoryEditor, /await navigator\.clipboard\.readText\(\)/);
  assert.match(handlerSource, /security\.validateRunData/);
  assert.match(handlerSource, /security\.validateAppraisalUpdate/);
  assert.match(handlerSource, /security\.validateRunEdit/);
  assert.match(handlerSource, /statisticsReport\.validateReportRequest/);
  assert.match(handlerSource, /statisticsReport\.validateScope/);
  assert.match(oauth, /security\.validateEsiCapabilitySelection/);
  assert.match(handlerSource, /loadouts\.serializePresets\(data\.presets\)/);
  assert.match(handlerSource, /withCharacterCapability\(characterId, 'fitting'/);
  assert.match(handlerSource, /withCharacterCapability\(characterId, 'killmails'/);
  assert.match(oauth, /tokens\.scopes = transaction\.scopes/);
  assert.match(main, /createOAuthService/);
  assert.doesNotMatch(main, /pendingAuth|function startSso|function handleOAuthCallback/);
  assert.match(credentials, /database\.deleteCredential\(OAUTH_CREDENTIAL_KIND, safeCharacterId\)/);
  assert.match(appJs, /if \(result\?\.authError\) return;/);
  assert.doesNotMatch(main, /normalizeMigratedCredentials/);
  assert.match(main, /db\.init\(\);[\s\S]*db\.hardenSensitiveStorage\(\);/);
  assert.match(main, /app\.on\('before-quit'[\s\S]*db\.createExitBackup\(\);[\s\S]*db\.close\(\);/);
  assert.match(database, /function createExitBackup\(\)[\s\S]*replaceExisting: true/);
  assert.doesNotMatch(main, /finishStartup|runs:get-recent-isk-per-hour/);
  assert.doesNotMatch(database, /finishStartup|getRecentIskPerHour/);
  assert.doesNotMatch(preload, /getRecentIskPerHour|runs:get-recent-isk-per-hour/);
  assert.doesNotMatch(appJs, /updateIskPerHour|iskPerHourDisplay/);
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
  assert.match(workflow, /Build unsigned Windows preview[\s\S]*Smoke test packaged application/);
  assert.match(workflow, /run: npm run test:package:win/);
  for (const line of workflow.split(/\r?\n/).filter(value => value.includes('uses: actions/'))) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#\s+v[\d.]+)?$/);
  }
});

test('unsigned release publishing is gated, draft-only, and isolates its write token', () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, '.github/workflows/release.yml'),
    'utf8'
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  );
  const beforePublishJob = workflow.split(/\n  publish:\s*\n/)[0];

  assert.match(workflow, /environment: release/);
  assert.doesNotMatch(packageJson.scripts['build:win:release'], /forceCodeSigning/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/);
  assert.doesNotMatch(workflow, /WIN_CSC|Get-AuthenticodeSignature|TimeStamperCertificate/);
  assert.match(workflow, /Build unsigned Windows installer[\s\S]*Smoke test packaged application/);
  assert.match(workflow, /run: npm run test:package:win/);
  assert.match(workflow, /run: npm run release:checksums/);
  assert.match(workflow, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(workflow, /gh release create[\s\S]*--draft/);
  assert.doesNotMatch(workflow, /--draft=false|gh release edit/);
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
