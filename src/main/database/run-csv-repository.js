const { parseCsv } = require('../../shared/csv');
const security = require('../../shared/security');
const { runInTransaction } = require('./transaction');

function createRunCsvRepository(getConnection, listRuns) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Run CSV repository requires a connection provider');
  }

  if (typeof listRuns !== 'function') {
    throw new TypeError('Run CSV repository requires a run query');
  }
  function exportRunsCSV(filters = {}) {
    const db = getConnection();
    const runs = listRuns(filters).slice().sort((left, right) =>
      left.started_at - right.started_at || left.id - right.id);

    const killmailsForRun = db.prepare(
      'SELECT killmail_id FROM run_killmails WHERE run_id = ? ORDER BY killmail_id'
    );
    for (const run of runs) {
      run.tags = JSON.stringify(run.tags || []);
      run.killmail_ids = JSON.stringify(
        killmailsForRun.all(run.id).map(row => row.killmail_id)
      );
    }

    const headers = [
      'id','character_id','character_name','started_at','duration','tier','weather','outcome',
      'hull_name','ship_class','system_id','system_name','loot_value','consumed_cost',
      'net_isk','total_loss','appraised_at','cargo_before','cargo_after','drone_before',
      'drone_after','notes','tags','killmail_ids'
    ];

    const rows = runs.map(r => headers.map(h => security.escapeCsvCell(r[h])).join(','));
    return {
      csv: [headers.join(','), ...rows].join('\n'),
      count: runs.length,
    };
  }

  function importRunsCSV(csvText, characterId) {
    const db = getConnection();
    const rows = parseCsv(csvText).filter(row => row.some(cell => cell.trim()));
    if (rows.length < 2) return { imported: 0, skipped: 0, errors: [] };

    const headers = rows[0].map((header, index) =>
      index === 0 ? header.replace(/^\uFEFF/, '') : header);
    const idx = (name) => headers.indexOf(name);
    for (const required of ['started_at', 'tier', 'weather', 'outcome', 'hull_name']) {
      if (idx(required) === -1) throw new TypeError(`CSV is missing required column: ${required}`);
    }

    const insertRun = db.prepare(`
      INSERT INTO runs
        (character_id, started_at, duration, tier, weather, outcome,
         hull_name, ship_class, system_id, system_name,
         loot_value, consumed_cost, net_isk, total_loss, appraised_at,
         cargo_before, cargo_after, drone_before, drone_after, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const runExists = db.prepare(
      'SELECT 1 FROM runs WHERE character_id = ? AND started_at = ? LIMIT 1'
    );
    const insertTag = db.prepare('INSERT INTO run_tags (run_id, tag) VALUES (?, ?)');
    const insertKillmail = db.prepare(
      'INSERT INTO run_killmails (run_id, killmail_id) VALUES (?, ?)'
    );

    let imported = 0, skipped = 0;
    const errors = [];

    runInTransaction(db, () => {
      for (let i = 1; i < rows.length; i++) {
        try {
          const cols = rows[i];
          const get = (name) => {
            const index = idx(name);
            return index === -1 ? null : security.unescapeCsvCell(cols[index] ?? '');
          };
          const charId = characterId || get('character_id');
          if (!charId) { skipped++; continue; }
          const number = (name) => {
            const raw = get(name);
            return raw == null || raw === '' ? 0 : Number(raw);
          };
          const optionalNumber = (name) => {
            const raw = get(name);
            return raw == null || raw === '' ? null : Number(raw);
          };
          const jsonArray = (name) => {
            const raw = get(name);
            if (raw == null || raw === '') return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new TypeError(name + ' must contain a JSON array');
            return parsed;
          };
          const run = security.validateRunData({
            character_id: charId,
            started_at: get('started_at') || String(Math.floor(Date.now() / 1000)),
            duration: get('duration') || '0',
            tier: get('tier') || 'Unknown',
            weather: get('weather') || 'Unknown',
            outcome: get('outcome') || 'Survived',
            hull_name: get('hull_name') || '',
            ship_class: get('ship_class') || 'Unknown',
            system_id: optionalNumber('system_id'),
            system_name: get('system_name') || null,
            appraised_at: optionalNumber('appraised_at'),
            tags: jsonArray('tags'),
            killmail_ids: jsonArray('killmail_ids'),
            loot_value: number('loot_value'),
            consumed_cost: number('consumed_cost'),
            net_isk: number('net_isk'),
            total_loss: number('total_loss'),
            cargo_before: get('cargo_before') || '',
            cargo_after: get('cargo_after') || '',
            drone_before: get('drone_before') || '',
            drone_after: get('drone_after') || '',
            notes: get('notes') || '',
            items: [],
            fitting: [],
            implants: [],
          });
          if (runExists.get(run.character_id, run.started_at)) {
            skipped++;
            continue;
          }

          const info = insertRun.run(
            run.character_id, run.started_at, run.duration,
            run.tier, run.weather, run.outcome,
            run.hull_name || null, run.ship_class,
            run.system_id, run.system_name,
            run.loot_value, run.consumed_cost, run.net_isk, run.total_loss,
            run.appraised_at,
            run.cargo_before || null, run.cargo_after || null,
            run.drone_before || null, run.drone_after || null, run.notes || null
          );
          for (const tag of run.tags) insertTag.run(info.lastInsertRowid, tag);
          for (const killmailId of run.killmail_ids) {
            insertKillmail.run(info.lastInsertRowid, killmailId);
          }
          imported++;
        } catch(e) {
          if (errors.length < 100) errors.push(`Row ${i + 1}: ${e.message}`);
          skipped++;
        }
      }
    });
    return { imported, skipped, errors };
  }
  return Object.freeze({ exportRunsCSV, importRunsCSV });
}

module.exports = { createRunCsvRepository };
