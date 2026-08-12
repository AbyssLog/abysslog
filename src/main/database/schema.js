const SCHEMA_VERSION = 4;

function tableColumns(connection, tableName) {
  return new Set(connection.pragma(`table_info(${tableName})`).map(column => column.name));
}

function ensureColumn(connection, tableName, columnName, definition) {
  if (tableColumns(connection, tableName).has(columnName)) return;
  connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function createSchema(connection) {
  connection.exec(`
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
      system_name TEXT,
      appraised_at INTEGER,
      cargo_before TEXT,
      cargo_after TEXT,
      drone_before TEXT,
      drone_after TEXT,
      hull_name TEXT,
      ship_class TEXT,
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

    CREATE TABLE IF NOT EXISTS run_tags (
      run_id INTEGER NOT NULL,
      tag TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (run_id, tag),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_killmails (
      run_id INTEGER NOT NULL,
      killmail_id INTEGER NOT NULL,
      PRIMARY KEY (run_id, killmail_id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS active_run_state (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_runs_character_started
      ON runs(character_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_items_run_type_name
      ON run_items(run_id, type, item_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_run_tags_tag
      ON run_tags(tag COLLATE NOCASE);
  `);
}

function migrateActiveRunSnapshotsToV2(connection) {
  const rows = connection.prepare(
    'SELECT character_id, snapshot FROM active_run_state'
  ).all();
  const update = connection.prepare(
    "UPDATE active_run_state SET snapshot = ?, updated_at = strftime('%s','now') "
      + 'WHERE character_id = ?'
  );

  for (const row of rows) {
    let snapshot;
    try {
      snapshot = JSON.parse(row.snapshot);
    } catch {
      continue;
    }
    if (!snapshot || snapshot.version !== 1 || !snapshot.run || typeof snapshot.run !== 'object') {
      continue;
    }
    snapshot.version = 2;
    snapshot.run.hull_name = typeof snapshot.run.ship_name === 'string'
      ? snapshot.run.ship_name
      : '';
    delete snapshot.run.ship_name;
    update.run(JSON.stringify(snapshot), row.character_id);
  }
}

const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    up(connection) {
      ensureColumn(connection, 'runs', 'cargo_before', 'TEXT');
      ensureColumn(connection, 'runs', 'cargo_after', 'TEXT');
      ensureColumn(connection, 'runs', 'drone_before', 'TEXT');
      ensureColumn(connection, 'runs', 'drone_after', 'TEXT');
      const columns = tableColumns(connection, 'runs');
      if (!columns.has('ship_name') && !columns.has('hull_name')) {
        connection.exec('ALTER TABLE runs ADD COLUMN ship_name TEXT');
      }
      ensureColumn(connection, 'runs', 'ship_class', 'TEXT');
    },
  }),
  Object.freeze({
    version: 2,
    up(connection) {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS active_run_state (
          character_id INTEGER PRIMARY KEY,
          snapshot TEXT NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        )
      `);
    },
  }),
  Object.freeze({
    version: 3,
    up(connection) {
      ensureColumn(connection, 'runs', 'system_name', 'TEXT');
      ensureColumn(connection, 'runs', 'appraised_at', 'INTEGER');
      connection.exec(`
        CREATE TABLE IF NOT EXISTS run_tags (
          run_id INTEGER NOT NULL,
          tag TEXT NOT NULL COLLATE NOCASE,
          PRIMARY KEY (run_id, tag),
          FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS run_killmails (
          run_id INTEGER NOT NULL,
          killmail_id INTEGER NOT NULL,
          PRIMARY KEY (run_id, killmail_id),
          FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_runs_character_started
          ON runs(character_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_run_items_run_type_name
          ON run_items(run_id, type, item_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_run_tags_tag
          ON run_tags(tag COLLATE NOCASE);
      `);
    },
  }),
  Object.freeze({
    version: 4,
    up(connection) {
      const columns = tableColumns(connection, 'runs');
      if (columns.has('ship_name') && !columns.has('hull_name')) {
        connection.exec('ALTER TABLE runs RENAME COLUMN ship_name TO hull_name');
      } else if (!columns.has('hull_name')) {
        connection.exec('ALTER TABLE runs ADD COLUMN hull_name TEXT');
      }
      migrateActiveRunSnapshotsToV2(connection);
    },
  }),
]);

function migrateSchema(connection, currentVersion) {
  let version = currentVersion;
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    migration.up(connection);
    connection.pragma(`user_version = ${migration.version}`);
    version = migration.version;
  }
  return version;
}

module.exports = {
  MIGRATIONS,
  SCHEMA_VERSION,
  createSchema,
  migrateSchema,
};
