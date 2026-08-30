const { parseCsv } = require('../../shared/csv');
const security = require('../../shared/security');
const {
  jsonCell,
  validateAppraisals,
  validateFitSnapshot,
  validateInventorySnapshots,
} = require('./run-csv-validation-v6');

const RUN_CSV_FORMAT = 'abysslog-history';
const RUN_CSV_FORMAT_VERSION = 2;
const RUN_UID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = Object.freeze([
  'format',
  'format_version',
  'run_uid',
  'encounter_uid',
  'character_id',
  'character_name',
  'started_at',
  'duration',
  'tier',
  'weather',
  'outcome',
  'hull_name',
  'ship_class',
  'system_id',
  'system_name',
  'notes',
  'created_at',
  'fit_snapshot',
  'inventory_snapshots',
  'appraisals',
  'tags',
  'killmail_ids',
]);

function createRunCsvRepository(getConnection, listRuns, saveRun) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Run CSV repository requires a connection provider');
  }
  if (typeof listRuns !== 'function' || typeof saveRun !== 'function') {
    throw new TypeError('Run CSV repository requires run persistence');
  }

  function fitSnapshotForRun(db, run) {
    if (!run.fit_snapshot_id) return null;
    const snapshot = db.prepare(`
      SELECT fs.format_version, fs.hull_name,
        fi.algorithm_version, fi.display_name
      FROM fit_snapshots fs
      LEFT JOIN fit_identities fi ON fi.id = fs.fit_identity_id
      WHERE fs.id = ?
    `).get(run.fit_snapshot_id);
    if (!snapshot) throw new Error(`Run ${run.id} references a missing fit snapshot`);
    snapshot.fitting = db.prepare(`
      SELECT type_id, type_name, qty, slot
      FROM fit_snapshot_items WHERE snapshot_id = ? ORDER BY id
    `).all(run.fit_snapshot_id);
    snapshot.implants = db.prepare(`
      SELECT type_id, type_name, qty, slot
      FROM fit_snapshot_implants WHERE snapshot_id = ? ORDER BY id
    `).all(run.fit_snapshot_id);
    return snapshot;
  }

  function inventorySnapshotsForRun(db, runId) {
    const snapshots = db.prepare(`
      SELECT id, format_version, phase, location, raw_text, captured_at,
        parse_status, parse_error_code, created_at
      FROM inventory_snapshots WHERE run_id = ? ORDER BY id
    `).all(runId);
    const loadItems = db.prepare(`
      SELECT type_id, item_name, qty
      FROM inventory_snapshot_items WHERE snapshot_id = ? ORDER BY id
    `);
    return snapshots.map(snapshot => ({
      ...snapshot,
      id: undefined,
      items: loadItems.all(snapshot.id),
    }));
  }

  function appraisalsForRun(db, runId) {
    const appraisals = db.prepare(`
      SELECT id, format_version, kind, source, provider, appraised_at,
        resolution_status, loot_value, consumed_cost, net_isk, total_loss,
        is_current, created_at
      FROM appraisals WHERE run_id = ? ORDER BY id
    `).all(runId);
    const loadLines = db.prepare(`
      SELECT type_id, item_name, qty, disposition, unit_price_buy, unit_price_sell
      FROM appraisal_lines WHERE appraisal_id = ? ORDER BY id
    `);
    return appraisals.map(appraisal => ({
      ...appraisal,
      id: undefined,
      lines: loadLines.all(appraisal.id),
    }));
  }

  function exportRunsCSV(filters = {}) {
    const db = getConnection();
    const runs = listRuns(filters).slice().sort((left, right) =>
      left.started_at - right.started_at || left.id - right.id);
    const loadKillmails = db.prepare(
      'SELECT killmail_id FROM run_killmails WHERE run_id = ? ORDER BY killmail_id'
    );
    const rows = runs.map(run => {
      const values = {
        format: RUN_CSV_FORMAT,
        format_version: RUN_CSV_FORMAT_VERSION,
        run_uid: run.run_uid,
        encounter_uid: run.encounter_uid,
        character_id: run.character_id,
        character_name: run.character_name,
        started_at: run.started_at,
        duration: run.duration,
        tier: run.tier,
        weather: run.weather,
        outcome: run.outcome,
        hull_name: run.hull_name,
        ship_class: run.ship_class,
        system_id: run.system_id,
        system_name: run.system_name,
        notes: run.notes,
        created_at: run.created_at,
        fit_snapshot: JSON.stringify(fitSnapshotForRun(db, run)),
        inventory_snapshots: JSON.stringify(inventorySnapshotsForRun(db, run.id)),
        appraisals: JSON.stringify(appraisalsForRun(db, run.id)),
        tags: JSON.stringify(run.tags || []),
        killmail_ids: JSON.stringify(loadKillmails.all(run.id).map(row => row.killmail_id)),
      };
      return HEADERS.map(header => security.escapeCsvCell(values[header])).join(',');
    });
    return { csv: [HEADERS.join(','), ...rows].join('\n'), count: runs.length };
  }

  function insertInventorySnapshots(db, runId, snapshots) {
    db.prepare('DELETE FROM inventory_snapshots WHERE run_id = ?').run(runId);
    const insertSnapshot = db.prepare(`
      INSERT INTO inventory_snapshots
        (run_id, format_version, phase, location, raw_text, captured_at,
         parse_status, parse_error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertItem = db.prepare(`
      INSERT INTO inventory_snapshot_items (snapshot_id, type_id, item_name, qty)
      VALUES (?, ?, ?, ?)
    `);
    for (const snapshot of snapshots) {
      const snapshotId = insertSnapshot.run(
        runId,
        snapshot.format_version,
        snapshot.phase,
        snapshot.location,
        snapshot.raw_text,
        snapshot.captured_at,
        snapshot.parse_status,
        snapshot.parse_error_code,
        snapshot.created_at
      ).lastInsertRowid;
      for (const item of snapshot.items) {
        insertItem.run(snapshotId, item.type_id, item.item_name, item.qty);
      }
    }
  }

  function insertAppraisals(db, runId, appraisals) {
    db.prepare('DELETE FROM appraisals WHERE run_id = ?').run(runId);
    const insertAppraisal = db.prepare(`
      INSERT INTO appraisals
        (run_id, format_version, kind, source, provider, appraised_at,
         resolution_status, loot_value, consumed_cost, net_isk, total_loss,
         is_current, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLine = db.prepare(`
      INSERT INTO appraisal_lines
        (appraisal_id, type_id, item_name, qty, disposition,
         unit_price_buy, unit_price_sell)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const appraisal of appraisals) {
      const appraisalId = insertAppraisal.run(
        runId,
        appraisal.format_version,
        appraisal.kind,
        appraisal.source,
        appraisal.provider,
        appraisal.appraised_at,
        appraisal.resolution_status,
        appraisal.loot_value,
        appraisal.consumed_cost,
        appraisal.net_isk,
        appraisal.total_loss,
        appraisal.is_current,
        appraisal.created_at
      ).lastInsertRowid;
      for (const line of appraisal.lines) {
        insertLine.run(
          appraisalId,
          line.type_id,
          line.item_name,
          line.qty,
          line.disposition,
          line.unit_price_buy,
          line.unit_price_sell
        );
      }
    }
  }

  function importRunsCSV(csvText, characterId) {
    const db = getConnection();
    const rows = parseCsv(csvText).filter(row => row.some(cell => cell.trim()));
    if (rows.length < 2) return { imported: 0, skipped: 0, errors: [] };
    const headers = rows[0].map((header, index) =>
      index === 0 ? header.replace(/^\uFEFF/, '') : header);
    if (headers.length !== HEADERS.length || HEADERS.some((header, index) => headers[index] !== header)) {
      throw new TypeError('CSV is not the supported AbyssLog 1.2.2 history format');
    }
    const idx = name => headers.indexOf(name);
    const existingUid = db.prepare('SELECT 1 FROM runs WHERE run_uid = ?');
    const existingStart = db.prepare(
      'SELECT 1 FROM runs WHERE character_id = ? AND started_at = ?'
    );
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      try {
        db.transaction(() => {
          const columns = rows[rowIndex];
          const get = name => security.unescapeCsvCell(columns[idx(name)] ?? '');
          if (get('format') !== RUN_CSV_FORMAT || Number(get('format_version')) !== RUN_CSV_FORMAT_VERSION) {
            throw new TypeError('Run export format version is unsupported');
          }
          const runUid = get('run_uid').toLowerCase();
          if (!RUN_UID_PATTERN.test(runUid)) throw new TypeError('Run UID is invalid');
          const encounterUid = get('encounter_uid').toLowerCase();
          if (!RUN_UID_PATTERN.test(encounterUid)) throw new TypeError('Encounter UID is invalid');
          const targetCharacterId = characterId || security.requireInteger(get('character_id'), 'Character ID');
          const fit = validateFitSnapshot(jsonCell(get('fit_snapshot'), 'Fit snapshot'));
          const inventories = validateInventorySnapshots(
            jsonCell(get('inventory_snapshots'), 'Inventory snapshots')
          );
          const appraisals = validateAppraisals(jsonCell(get('appraisals'), 'Appraisals'));
          const current = appraisals.find(appraisal => appraisal.is_current === 1);
          const rawByKind = new Map(inventories.map(snapshot => [
            `${snapshot.phase}:${snapshot.location}`,
            snapshot.raw_text ?? '',
          ]));
          const tags = jsonCell(get('tags'), 'Tags');
          const killmailIds = jsonCell(get('killmail_ids'), 'Killmail IDs');
          const referencePrice = (typeId, name, disposition) => current.lines.find(line =>
            line.disposition === disposition
            && (line.type_id === typeId || (line.type_id == null && line.item_name === name))
          )?.unit_price_sell || 0;
          const run = security.validateRunData({
            character_id: targetCharacterId,
            started_at: Number(get('started_at')),
            duration: Number(get('duration')),
            tier: get('tier'),
            weather: get('weather'),
            outcome: get('outcome'),
            hull_name: get('hull_name'),
            ship_class: get('ship_class'),
            system_id: get('system_id') === '' ? null : Number(get('system_id')),
            system_name: get('system_name') || null,
            notes: get('notes'),
            cargo_before: rawByKind.get('before:cargo') || '',
            cargo_after: rawByKind.get('after:cargo') || '',
            drone_before: rawByKind.get('before:drone') || '',
            drone_after: rawByKind.get('after:drone') || '',
            tags,
            killmail_ids: killmailIds,
            appraised_at: current.appraised_at,
            loot_value: current.loot_value,
            consumed_cost: current.consumed_cost,
            net_isk: current.net_isk,
            total_loss: current.total_loss,
            items: current.lines.filter(line =>
              ['gained', 'consumed', 'lost'].includes(line.disposition)
            ).map(line => ({
              item_name: line.item_name,
              qty: line.qty,
              type: line.disposition,
              unit_price_buy: line.unit_price_buy,
              unit_price_sell: line.unit_price_sell,
            })),
            fitting: (fit?.fitting || []).map(item => ({
              ...item,
              unit_price_sell: referencePrice(item.type_id, item.type_name, 'fitted'),
            })),
            implants: (fit?.implants || []).map(item => ({
              ...item,
              unit_price_sell: referencePrice(item.type_id, item.type_name, 'implant'),
            })),
            encounter_uid: encounterUid,
          });
          if (existingUid.get(runUid) || existingStart.get(run.character_id, run.started_at)) {
            skipped++;
            return;
          }
          const createdAt = security.requireInteger(get('created_at'), 'Run creation time', { min: 0 });
          const runId = saveRun(run, { runUid, createdAt });
          insertInventorySnapshots(db, runId, inventories);
          insertAppraisals(db, runId, appraisals);
          if (fit?.display_name) {
            db.prepare(`
              UPDATE fit_identities SET display_name = COALESCE(display_name, ?),
                updated_at = strftime('%s','now')
              WHERE id = (
                SELECT fs.fit_identity_id FROM runs r
                JOIN fit_snapshots fs ON fs.id = r.fit_snapshot_id WHERE r.id = ?
              )
            `).run(fit.display_name, runId);
          }
          imported++;
        })();
      } catch (error) {
        if (errors.length < 100) errors.push(`Row ${rowIndex + 1}: ${error.message}`);
        skipped++;
      }
    }
    return { imported, skipped, errors };
  }

  return Object.freeze({ exportRunsCSV, importRunsCSV });
}

module.exports = {
  HEADERS,
  RUN_CSV_FORMAT,
  RUN_CSV_FORMAT_VERSION,
  createRunCsvRepository,
};
