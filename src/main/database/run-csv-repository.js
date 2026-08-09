const { parseCsv } = require('../../shared/csv');
const security = require('../../shared/security');

function createRunCsvRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Run CSV repository requires a connection provider');
  }

  function exportRunsCSV(characterId) {
    const db = getConnection();
    const filters = characterId ? 'WHERE r.character_id = ?' : '';
    const params = characterId ? [characterId] : [];
    const runs = db.prepare(`
      SELECT r.*, c.name as character_name
      FROM runs r JOIN characters c ON r.character_id = c.id
      ${filters}
      ORDER BY r.started_at ASC
    `).all(...params);

    const headers = [
      'id','character_id','character_name','started_at','duration','tier','weather','outcome',
      'ship_name','ship_class','loot_value','consumed_cost','net_isk','total_loss',
      'cargo_before','cargo_after','drone_before','drone_after','notes'
    ];

    const rows = runs.map(r => headers.map(h => security.escapeCsvCell(r[h])).join(','));
    return [headers.join(','), ...rows].join('\n');
  }

  function importRunsCSV(csvText, characterId) {
    const db = getConnection();
    const rows = parseCsv(csvText).filter(row => row.some(cell => cell.trim()));
    if (rows.length < 2) return { imported: 0, skipped: 0, errors: [] };

    const headers = rows[0].map((header, index) =>
      index === 0 ? header.replace(/^\uFEFF/, '') : header);
    const idx = (name) => headers.indexOf(name);
    for (const required of ['started_at', 'tier', 'weather', 'outcome']) {
      if (idx(required) === -1) throw new TypeError(`CSV is missing required column: ${required}`);
    }

    const insertRun = db.prepare(`
      INSERT INTO runs
        (character_id, started_at, duration, tier, weather, outcome,
         ship_name, ship_class, loot_value, consumed_cost, net_isk, total_loss,
         cargo_before, cargo_after, drone_before, drone_after, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const runExists = db.prepare(
      'SELECT 1 FROM runs WHERE character_id = ? AND started_at = ? LIMIT 1'
    );

    let imported = 0, skipped = 0;
    const errors = [];

    const transaction = db.transaction(() => {
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
          const run = security.validateRunData({
            character_id: charId,
            started_at: get('started_at') || String(Math.floor(Date.now() / 1000)),
            duration: get('duration') || '0',
            tier: get('tier') || 'Unknown',
            weather: get('weather') || 'Unknown',
            outcome: get('outcome') || 'Survived',
            ship_name: get('ship_name') || '',
            ship_class: get('ship_class') || 'Unknown',
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

          insertRun.run(
            run.character_id, run.started_at, run.duration,
            run.tier, run.weather, run.outcome,
            run.ship_name || null, run.ship_class,
            run.loot_value, run.consumed_cost, run.net_isk, run.total_loss,
            run.cargo_before || null, run.cargo_after || null,
            run.drone_before || null, run.drone_after || null, run.notes || null
          );
          imported++;
        } catch(e) {
          if (errors.length < 100) errors.push(`Row ${i + 1}: ${e.message}`);
          skipped++;
        }
      }
    });
    transaction();
    return { imported, skipped, errors };
  }
  return Object.freeze({ exportRunsCSV, importRunsCSV });
}

module.exports = { createRunCsvRepository };
