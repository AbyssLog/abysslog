const path = require('path');
const { app } = require('electron');

let db;

function init() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(app.getPath('userData'), 'abysslog.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema();
  migrateSchema();
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      portrait_url TEXT,
      client_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      tier TEXT,
      weather TEXT,
      outcome TEXT NOT NULL,
      loot_value REAL DEFAULT 0,
      consumed_cost REAL DEFAULT 0,
      net_isk REAL DEFAULT 0,
      total_loss REAL DEFAULT 0,
      system_id INTEGER,
      cargo_before TEXT,
      cargo_after TEXT,
      notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('gained','consumed','lost')),
      unit_price_buy REAL DEFAULT 0,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_fitting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      slot TEXT,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_implants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      slot INTEGER,
      unit_price_sell REAL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
  `);
}


function migrateSchema() {
  // Add cargo columns to existing databases that predate this feature
  const cols = db.pragma('table_info(runs)').map(c => c.name);
  if (!cols.includes('cargo_before')) {
    db.exec('ALTER TABLE runs ADD COLUMN cargo_before TEXT');
  }
  if (!cols.includes('cargo_after')) {
    db.exec('ALTER TABLE runs ADD COLUMN cargo_after TEXT');
  }
}

// ── Characters ────────────────────────────────────────────────────────────

function getCharacters() {
  return db.prepare('SELECT * FROM characters ORDER BY name').all();
}

function saveCharacter(character) {
  const existing = db.prepare('SELECT id FROM characters WHERE id = ?').get(character.id);
  if (existing) {
    db.prepare('UPDATE characters SET name = ?, portrait_url = ?, client_id = ? WHERE id = ?')
      .run(character.name, character.portrait_url, character.client_id, character.id);
  } else {
    db.prepare('INSERT INTO characters (id, name, portrait_url, client_id) VALUES (?, ?, ?, ?)')
      .run(character.id, character.name, character.portrait_url, character.client_id);
  }
  return character;
}

function deleteCharacter(characterId) {
  db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
  return true;
}

// ── Settings ──────────────────────────────────────────────────────────────

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  return true;
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

// ── Runs ──────────────────────────────────────────────────────────────────

function saveRun(runData) {
  const {
    character_id, started_at, duration, tier, weather, outcome,
    loot_value, consumed_cost, net_isk, total_loss, system_id,
    cargo_before, cargo_after, notes,
    items = [], fitting = [], implants = []
  } = runData;

  const insertRun = db.prepare(`
    INSERT INTO runs (character_id, started_at, duration, tier, weather, outcome,
      loot_value, consumed_cost, net_isk, total_loss, system_id, cargo_before, cargo_after, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO run_items (run_id, item_name, qty, type, unit_price_buy, unit_price_sell)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertFitting = db.prepare(`
    INSERT INTO run_fitting (run_id, type_id, type_name, qty, slot, unit_price_sell)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertImplant = db.prepare(`
    INSERT INTO run_implants (run_id, type_id, type_name, slot, unit_price_sell)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const info = insertRun.run(
      character_id, started_at, duration, tier, weather, outcome,
      loot_value || 0, consumed_cost || 0, net_isk || 0, total_loss || 0,
      system_id, cargo_before || null, cargo_after || null, notes
    );
    const runId = info.lastInsertRowid;

    for (const item of items) {
      insertItem.run(runId, item.item_name, item.qty, item.type,
        item.unit_price_buy || 0, item.unit_price_sell || 0);
    }
    for (const f of fitting) {
      insertFitting.run(runId, f.type_id, f.type_name, f.qty || 1, f.slot || null, f.unit_price_sell || 0);
    }
    for (const imp of implants) {
      insertImplant.run(runId, imp.type_id, imp.type_name, imp.slot || null, imp.unit_price_sell || 0);
    }

    return runId;
  });

  return transaction();
}

function getRuns(filters = {}) {
  let query = 'SELECT r.*, c.name as character_name FROM runs r JOIN characters c ON r.character_id = c.id WHERE 1=1';
  const params = [];

  if (filters.character_id) {
    query += ' AND r.character_id = ?';
    params.push(filters.character_id);
  }
  if (filters.tier) {
    query += ' AND r.tier = ?';
    params.push(filters.tier);
  }
  if (filters.weather) {
    query += ' AND r.weather = ?';
    params.push(filters.weather);
  }
  if (filters.outcome) {
    query += ' AND r.outcome = ?';
    params.push(filters.outcome);
  }

  query += ' ORDER BY r.started_at DESC';

  if (filters.limit) {
    query += ' LIMIT ?';
    params.push(filters.limit);
  }

  return db.prepare(query).all(...params);
}

function getRunById(runId) {
  const run = db.prepare('SELECT r.*, c.name as character_name FROM runs r JOIN characters c ON r.character_id = c.id WHERE r.id = ?').get(runId);
  if (!run) return null;

  run.items = db.prepare('SELECT * FROM run_items WHERE run_id = ? ORDER BY type, item_name').all(runId);
  run.fitting = db.prepare('SELECT * FROM run_fitting WHERE run_id = ? ORDER BY slot, type_name').all(runId);
  run.implants = db.prepare('SELECT * FROM run_implants WHERE run_id = ? ORDER BY slot').all(runId);

  return run;
}

function deleteRun(runId) {
  db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
  return true;
}

function getStats(characterId) {
  const where = characterId ? 'WHERE character_id = ?' : '';
  const params = characterId ? [characterId] : [];

  const overall = db.prepare(`
    SELECT
      COUNT(*) as total_runs,
      SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
      SUM(CASE WHEN outcome = 'Died' THEN 1 ELSE 0 END) as died,
      AVG(CASE WHEN outcome = 'Survived' THEN duration END) as avg_duration_survived,
      AVG(CASE WHEN outcome = 'Survived' THEN net_isk END) as avg_net_isk,
      SUM(CASE WHEN outcome = 'Survived' THEN net_isk ELSE 0 END) as total_net_isk,
      AVG(CASE WHEN outcome = 'Died' THEN total_loss END) as avg_loss,
      SUM(CASE WHEN outcome = 'Died' THEN total_loss ELSE 0 END) as total_loss,
      MIN(started_at) as first_run,
      MAX(started_at) as last_run
    FROM runs ${where}
  `).get(...params);

  const byTier = db.prepare(`
    SELECT tier,
      COUNT(*) as total_runs,
      SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
      AVG(CASE WHEN outcome = 'Survived' THEN duration END) as avg_duration,
      AVG(CASE WHEN outcome = 'Survived' THEN net_isk END) as avg_net_isk
    FROM runs ${where}
    GROUP BY tier ORDER BY tier
  `).all(...params);

  const byWeather = db.prepare(`
    SELECT weather,
      COUNT(*) as total_runs,
      SUM(CASE WHEN outcome = 'Survived' THEN 1 ELSE 0 END) as survived,
      AVG(CASE WHEN outcome = 'Survived' THEN net_isk END) as avg_net_isk
    FROM runs ${where}
    GROUP BY weather ORDER BY weather
  `).all(...params);

  // ISK/hour based on last 20 survived runs
  const recentRuns = db.prepare(`
    SELECT net_isk, duration FROM runs
    ${where ? where + ' AND' : 'WHERE'} outcome = 'Survived' AND duration > 0
    ORDER BY started_at DESC LIMIT 20
  `).all(...params);

  let iskPerHour = 0;
  if (recentRuns.length > 0) {
    const totalIsk = recentRuns.reduce((s, r) => s + r.net_isk, 0);
    const totalHours = recentRuns.reduce((s, r) => s + r.duration, 0) / 3600;
    iskPerHour = totalHours > 0 ? totalIsk / totalHours : 0;
  }

  return { overall, byTier, byWeather, iskPerHour };
}

function deleteSetting(key) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  return true;
}

function updateAppraisal(runId, { loot_value, consumed_cost, net_isk, cargo_before, cargo_after, items }) {
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE runs SET loot_value = ?, consumed_cost = ?, net_isk = ?,
        cargo_before = ?, cargo_after = ? WHERE id = ?
    `).run(loot_value, consumed_cost, net_isk, cargo_before, cargo_after, runId);

    // Replace gained/consumed items — keep lost items (from death) untouched
    db.prepare("DELETE FROM run_items WHERE run_id = ? AND type IN ('gained','consumed')").run(runId);

    const insertItem = db.prepare(`
      INSERT INTO run_items (run_id, item_name, qty, type, unit_price_buy, unit_price_sell)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(runId, item.item_name, item.qty, item.type,
        item.unit_price_buy || 0, item.unit_price_sell || 0);
    }
  });
  transaction();
  return true;
}

module.exports = { init, getCharacters, saveCharacter, deleteCharacter, getSetting, setSetting, deleteSetting, getAllSettings, saveRun, updateAppraisal, getRuns, getRunById, deleteRun, getStats };
