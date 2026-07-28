'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fitting = require('../src/shared/fitting');
const projectRoot = path.resolve(__dirname, '..');

const run = {
  started_at: Date.parse('2026-07-28T10:30:00Z') / 1000,
  tier: 'T5',
  weather: 'Exotic',
  ship_name: 'Gila',
  fitting: [
    { type_id: 17_918, type_name: 'Gila', qty: 1, slot: 'hull' },
    { type_id: 33_201, type_name: 'Rapid Light Missile Launcher II', qty: 1, slot: 'HiSlot1' },
    { type_id: 33_201, type_name: 'Rapid Light Missile Launcher II', qty: 1, slot: 'HiSlot0' },
    { type_id: 12_345, type_name: '10MN Afterburner II', qty: 1, slot: 'MedSlot0' },
    { type_id: 5_195, type_name: 'Drone Damage Amplifier II', qty: 1, slot: 'LoSlot1' },
    { type_id: 5_195, type_name: 'Drone Damage Amplifier II', qty: 1, slot: 'LoSlot0' },
    { type_id: 31_788, type_name: 'Medium Core Defense Field Purger II', qty: 1, slot: 'RigSlot0' },
    { type_id: 21_638, type_name: 'Vespa II', qty: 5, slot: 'DroneBay' },
    { type_id: 99_999, type_name: 'Unclassified Module', qty: 1, slot: 'AutoFit' },
  ],
  implants: [
    { type_id: 22_101, type_name: 'Mid-grade Crystal Alpha' },
    { type_id: 22_101, type_name: 'Mid-grade Crystal Alpha' },
    { type_id: 22_102, type_name: 'Mid-grade Crystal Beta' },
  ],
};

test('fitting snapshots group matching items within their slot sections', () => {
  const grouped = fitting.groupSnapshot(run.fitting, run.implants);

  assert.equal(grouped.hull.name, 'Gila');
  assert.deepEqual(grouped.sections.high, [{
    section: 'high',
    typeId: 33_201,
    name: 'Rapid Light Missile Launcher II',
    qty: 2,
    firstSlot: 0,
  }]);
  assert.equal(grouped.sections.low[0].qty, 2);
  assert.equal(grouped.sections.drone[0].qty, 5);
  assert.equal(grouped.implants[0].qty, 2);
  assert.equal(grouped.sections.other[0].name, 'Unclassified Module');
});

test('EFT export uses rack order, expands modules, and includes implants as cargo', () => {
  const result = fitting.createEftExport(run);

  assert.equal(
    result.text,
    `[Gila, AbyssLog T5 Exotic 2026-07-28]

Drone Damage Amplifier II
Drone Damage Amplifier II

10MN Afterburner II

Rapid Light Missile Launcher II
Rapid Light Missile Launcher II

Medium Core Defense Field Purger II


Vespa II x5


Mid-grade Crystal Alpha x2
Mid-grade Crystal Beta x1`
  );
  assert.equal(result.fittedItemCount, 7);
  assert.equal(result.droneCount, 5);
  assert.equal(result.implantCount, 3);
  assert.equal(result.omittedItemCount, 1);
  assert.doesNotMatch(result.text, /Unclassified Module/);
});

test('EFT export requires a captured hull and sanitizes generated lines', () => {
  assert.throws(
    () => fitting.createEftExport({ fitting: [], implants: [] }),
    /captured ship hull is unavailable/
  );

  const result = fitting.createEftExport({
    ship_name: 'Gila\nInjected',
    tier: 'T4\nBad',
    weather: 'Dark',
    fitting: [],
    implants: [{ type_id: 1, type_name: 'Implant\nName' }],
  });
  assert.equal(result.text, '[Gila Injected, AbyssLog T4 Bad Dark]\n\nImplant Name x1');
});

test('run details delegate captured setup and clipboard export to a dedicated dialog', () => {
  const html = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'index.html'),
    'utf8'
  );
  const appJs = fs.readFileSync(
    path.join(projectRoot, 'src', 'renderer', 'app.js'),
    'utf8'
  );
  const main = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'main.js'), 'utf8');

  assert.match(html, /id="shipSetupModal"[^>]+role="dialog"/);
  assert.match(html, /src="\.\.\/shared\/fitting\.js"/);
  assert.match(appJs, /data-action="show-ship-setup"/);
  assert.match(appJs, /data-action="copy-run-fitting"/);
  assert.match(appJs, /window\.AbyssFitting\.groupSnapshot/);
  assert.doesNotMatch(appJs, /function fittingTableHtml|function implantTableHtml/);
  assert.match(main, /secureHandle\('runs:copy-fitting'/);
  assert.match(main, /clipboard\.writeText\(exported\.text\)/);
});
