const assert = require('node:assert/strict');
const test = require('node:test');

const Database = require('better-sqlite3');
const reporting = require('../src/shared/statistics-report');
const { createRunRepository } = require('../src/main/database/run-repository-v6');
const {
  createStatisticsReportRepository,
} = require('../src/main/database/statistics-report-repository');
const { createFreshSchemaV7 } = require('../src/main/database/schema-v7');

function createHarness() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  createFreshSchemaV7(connection);
  connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
    .run(9001, 'Report Pilot');
  const runs = createRunRepository(() => connection);
  const reports = createStatisticsReportRepository(() => connection);
  return { connection, reports, runs };
}

function fit(moduleTypeId = 33_201) {
  return [
    { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
    { type_id: moduleTypeId, type_name: `Module ${moduleTypeId}`, qty: 1, slot: 'HiSlot0' },
  ];
}

function saveRun(runs, overrides) {
  return runs.saveRun({
    character_id: 9001,
    started_at: 1_750_000_000,
    duration: 600,
    tier: 'T5',
    weather: 'Gamma',
    outcome: 'Survived',
    hull_name: 'Gila',
    ship_class: 'Cruiser',
    loot_value: 0,
    consumed_cost: 0,
    net_isk: 100,
    total_loss: 0,
    cargo_before: '',
    cargo_after: '',
    drone_before: '',
    drone_after: '',
    fitting: fit(),
    implants: [],
    items: [],
    ...overrides,
  });
}

function request(overrides = {}) {
  return reporting.validateReportRequest({
    version: 1,
    mode: 'runs',
    character_id: 9001,
    filters: {},
    group_by: ['weather'],
    metrics: ['runs'],
    ...overrides,
  });
}

test('run performance reports combine allowlisted filters, groupings, and metrics', () => {
  const { connection, reports, runs } = createHarness();
  try {
    saveRun(runs, { cargo_after: 'Triglavian Survey Database\t5' });
    saveRun(runs, {
      started_at: 1_750_000_100,
      duration: 900,
      net_isk: 200,
      cargo_after: 'Triglavian Survey Database\t3',
    });
    saveRun(runs, {
      started_at: 1_750_000_200,
      duration: 300,
      weather: 'Dark',
      net_isk: 50,
      cargo_before: 'Nanite Repair Paste\t10',
      cargo_after: 'Nanite Repair Paste\t10',
      fitting: fit(44_401),
    });
    saveRun(runs, {
      started_at: 1_750_000_300,
      outcome: 'Died',
      total_loss: 500,
      net_isk: 0,
      tier: 'T6',
    });

    const report = reports.getReport(request({
      filters: { tier: 'T5' },
      metrics: [
        'runs', 'survived', 'died', 'survival_pct',
        'duration_avg', 'duration_min', 'duration_max', 'net_avg', 'net_total',
      ],
      sort: { key: 'weather', direction: 'asc' },
    }));
    assert.deepEqual(report.rows.map(row => row.dimensions.weather), ['Dark', 'Gamma']);
    assert.deepEqual(report.rows[0].values, {
      runs: 1,
      survived: 1,
      died: 0,
      survival_pct: 100,
      duration_avg: 300,
      duration_min: 300,
      duration_max: 300,
      net_avg: 50,
      net_total: 50,
    });
    assert.deepEqual(report.rows[1].values, {
      runs: 2,
      survived: 2,
      died: 0,
      survival_pct: 100,
      duration_avg: 750,
      duration_min: 600,
      duration_max: 900,
      net_avg: 150,
      net_total: 300,
    });

    const financials = reports.getReport(request({
      group_by: [],
      metrics: ['net_avg', 'net_total', 'death_loss_avg', 'death_loss_total'],
      sort: { key: 'net_total', direction: 'desc' },
    })).rows[0].values;
    assert.equal(financials.net_avg, 350 / 3);
    assert.equal(financials.net_total, 350);
    assert.equal(financials.death_loss_avg, 500);
    assert.equal(financials.death_loss_total, 500);
  } finally {
    connection.close();
  }
});

test('selected item reports include other-loot runs and exclude no-loot, death, or missing cargo runs', () => {
  const { connection, reports, runs } = createHarness();
  try {
    const firstDropRunId = saveRun(runs, {
      cargo_after: 'Triglavian Survey Database\t5\nZero-Point Condensate\t2',
    });
    const secondDropRunId = saveRun(runs, {
      started_at: 1_750_000_100,
      cargo_after: 'Triglavian Survey Database\t3',
    });
    saveRun(runs, {
      started_at: 1_750_000_200,
      weather: 'Dark',
      cargo_before: 'Nanite Repair Paste\t10',
      cargo_after: 'Nanite Repair Paste\t10\nZero-Point Condensate\t1',
    });
    saveRun(runs, {
      started_at: 1_750_000_250,
      cargo_before: 'Nanite Repair Paste\t10',
      cargo_after: 'Nanite Repair Paste\t10',
    });
    saveRun(runs, {
      started_at: 1_750_000_300,
      outcome: 'Died',
      total_loss: 500,
      cargo_after: 'Triglavian Survey Database\t100',
    });
    saveRun(runs, {
      started_at: 1_750_000_400,
      cargo_before: undefined,
      cargo_after: undefined,
    });

    const report = reports.getReport(request({
      mode: 'drops',
      filters: { item_name: 'Triglavian Survey Database' },
      group_by: ['weather'],
      metrics: [
        'observed_runs', 'drop_runs', 'drop_rate', 'total_qty',
        'qty_per_run', 'drop_min', 'drop_max',
      ],
      sort: { key: 'weather', direction: 'asc' },
    }));
    assert.deepEqual(report.rows.map(row => row.dimensions.weather), ['Dark', 'Gamma']);
    assert.deepEqual(report.rows[0].values, {
      observed_runs: 1,
      drop_runs: 0,
      drop_rate: 0,
      total_qty: 0,
      qty_per_run: 0,
      drop_min: null,
      drop_max: null,
    });
    assert.deepEqual(report.rows[1].values, {
      observed_runs: 2,
      drop_runs: 2,
      drop_rate: 100,
      total_qty: 8,
      qty_per_run: 4,
      drop_min: 3,
      drop_max: 5,
    });
    const matchingRuns = runs.getRuns({
      character_id: 9001,
      drop_item_name: 'triglavian survey database',
    });
    assert.deepEqual(
      matchingRuns.map(run => Number(run.id)),
      [Number(secondDropRunId), Number(firstDropRunId)]
    );
    assert.deepEqual(matchingRuns[0].matching_items, [{
      item_name: 'triglavian survey database',
      type: 'gained',
    }]);
  } finally {
    connection.close();
  }
});

test('item-grouped reports use the complete observed population for each item', () => {
  const { connection, reports, runs } = createHarness();
  try {
    saveRun(runs, {
      cargo_after: 'Triglavian Survey Database\t5\nZero-Point Condensate\t2',
    });
    saveRun(runs, {
      started_at: 1_750_000_100,
      cargo_after: 'Triglavian Survey Database\t3',
    });
    const report = reports.getReport(request({
      mode: 'drops',
      filters: {},
      group_by: ['tier', 'weather'],
      metrics: ['observed_runs', 'drop_runs', 'drop_rate', 'total_qty', 'qty_per_run'],
      sort: { key: 'total_qty', direction: 'desc' },
    }));
    assert.deepEqual(report.group_by, ['item', 'tier', 'weather']);
    assert.deepEqual(report.rows.map(row => [
      row.dimensions.item,
      row.values.observed_runs,
      row.values.drop_runs,
      row.values.total_qty,
    ]), [
      ['Triglavian Survey Database', 2, 2, 8],
      ['Zero-Point Condensate', 2, 1, 2],
    ]);
    assert.equal(report.rows[0].values.drop_rate, 100);
    assert.equal(report.rows[1].values.qty_per_run, 1);
  } finally {
    connection.close();
  }
});

test('report options expose only actual cargo gains plus used hulls and fits', () => {
  const { connection, reports, runs } = createHarness();
  try {
    saveRun(runs, {
      cargo_before: 'Nanite Repair Paste\t10',
      cargo_after: 'Nanite Repair Paste\t10\nCrystalline Isogen-10\t4',
    });
    const options = reports.getOptions({ character_id: 9001 });
    assert.deepEqual(options.items, ['Crystalline Isogen-10']);
    assert.deepEqual(options.hulls.map(hull => hull.hull_name), ['Gila']);
    assert.equal(options.fits.length, 1);
    assert.equal(options.fits[0].hull_name, 'Gila');
  } finally {
    connection.close();
  }
});

test('shared encounters count once while preserving participant economics and loot', () => {
  const { connection, reports, runs } = createHarness();
  try {
    connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
      .run(9002, 'Second Pilot');
    connection.prepare('INSERT INTO characters (id, name) VALUES (?, ?)')
      .run(9003, 'Third Pilot');
    const encounterUid = '550e8400-e29b-41d4-a716-446655440000';
    saveRun(runs, {
      encounter_uid: encounterUid,
      hull_name: 'Hawk',
      ship_class: 'Frigate',
      fitting: [],
      cargo_before: 'Calm Gamma Filament\t3',
      cargo_after: 'Triglavian Survey Database\t20',
      consumed_cost: 7,
      loot_value: 146,
      net_isk: 139,
    });
    saveRun(runs, {
      encounter_uid: encounterUid,
      character_id: 9002,
      hull_name: 'Hawk',
      ship_class: 'Frigate',
      fitting: [],
      cargo_before: 'Inferno Rocket\t1000',
      cargo_after: 'Inferno Rocket\t700',
      consumed_cost: 2,
      net_isk: -2,
    });
    saveRun(runs, {
      encounter_uid: encounterUid,
      character_id: 9003,
      hull_name: 'Hawk',
      ship_class: 'Frigate',
      fitting: [],
      cargo_before: 'Inferno Rocket\t1000',
      cargo_after: 'Inferno Rocket\t700',
      consumed_cost: 3,
      net_isk: -3,
    });

    const performance = reports.getReport(request({
      character_id: undefined,
      group_by: [],
      metrics: ['encounters', 'runs', 'survived', 'net_total'],
      sort: { key: 'encounters', direction: 'desc' },
    })).rows[0].values;
    assert.deepEqual(performance, {
      encounters: 1,
      runs: 3,
      survived: 3,
      net_total: 134,
    });

    const drops = reports.getReport(request({
      version: 1,
      mode: 'drops',
      character_id: undefined,
      filters: { item_name: 'Triglavian Survey Database' },
      group_by: [],
      metrics: ['observed_runs', 'drop_runs', 'total_qty', 'qty_per_run'],
      sort: { key: 'total_qty', direction: 'desc' },
    })).rows[0].values;
    assert.deepEqual(drops, {
      observed_runs: 1,
      drop_runs: 1,
      total_qty: 20,
      qty_per_run: 20,
    });
  } finally {
    connection.close();
  }
});
