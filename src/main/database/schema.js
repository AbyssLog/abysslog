const SCHEMA_VERSION = 5;
const ABYSSLOG_APPLICATION_ID = 0x4142594c;
const { CURRENT_SCHEMA_CONTRACT } = require('./schema-contract');

function tableColumns(connection, tableName) {
  return new Set(connection.pragma(`table_info(${tableName})`).map(column => column.name));
}

function getCurrentSchemaIssues(connection) {
  const issues = [];
  const objects = connection.prepare(`
    SELECT type, name FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'
  `).all();
  const namesByType = new Map([
    ['table', new Set()],
    ['index', new Set()],
    ['trigger', new Set()],
  ]);
  for (const object of objects) namesByType.get(object.type)?.add(object.name);

  const expectedTables = Object.keys(CURRENT_SCHEMA_CONTRACT.tables);
  const actualTables = namesByType.get('table');
  for (const table of expectedTables) {
    if (!actualTables.has(table)) {
      issues.push(`missing table ${table}`);
      continue;
    }
    const expectedColumns = new Set(CURRENT_SCHEMA_CONTRACT.tables[table]);
    const actualColumns = tableColumns(connection, table);
    const missing = [...expectedColumns].filter(column => !actualColumns.has(column));
    const unexpected = [...actualColumns].filter(column => !expectedColumns.has(column));
    if (missing.length || unexpected.length) {
      issues.push(
        `invalid columns for ${table}`
        + (missing.length ? `; missing ${missing.join(', ')}` : '')
        + (unexpected.length ? `; unexpected ${unexpected.join(', ')}` : '')
      );
    }
  }
  const unexpectedTables = [...actualTables].filter(table => !expectedTables.includes(table));
  if (unexpectedTables.length) issues.push(`unexpected tables ${unexpectedTables.join(', ')}`);

  for (const [index, expected] of Object.entries(CURRENT_SCHEMA_CONTRACT.indexes)) {
    if (!namesByType.get('index').has(index)) {
      issues.push(`missing index ${index}`);
      continue;
    }
    const listed = connection.pragma(`index_list(${expected.table})`)
      .find(candidate => candidate.name === index);
    const columns = connection.pragma(`index_info(${index})`).map(column => column.name);
    if (
      !listed
      || Boolean(listed.unique) !== expected.unique
      || Boolean(listed.partial) !== expected.partial
      || columns.length !== expected.columns.length
      || columns.some((column, position) => column !== expected.columns[position])
    ) {
      issues.push(`invalid index ${index}`);
    }
  }
  for (const [trigger, expected] of Object.entries(CURRENT_SCHEMA_CONTRACT.triggers)) {
    if (!namesByType.get('trigger').has(trigger)) {
      issues.push(`missing trigger ${trigger}`);
      continue;
    }
    const definition = connection.prepare(
      "SELECT tbl_name, sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?"
    ).get(trigger);
    const normalizedSql = definition?.sql?.replace(/\s+/g, ' ').toUpperCase() || '';
    if (
      definition?.tbl_name !== expected.table
      || !normalizedSql.includes(`BEFORE ${expected.event} ON ${expected.table}`.toUpperCase())
      || !normalizedSql.includes(`RAISE(ABORT, '${expected.message}')`.toUpperCase())
    ) {
      issues.push(`invalid trigger ${trigger}`);
    }
  }

  const foreignKeyKey = foreignKey => [
    foreignKey.from,
    foreignKey.table,
    foreignKey.to,
    foreignKey.on_delete || foreignKey.onDelete,
  ].join('|');
  for (const table of expectedTables) {
    const expected = new Set(
      (CURRENT_SCHEMA_CONTRACT.foreignKeys[table] || []).map(foreignKeyKey)
    );
    const actual = new Set(connection.pragma(`foreign_key_list(${table})`).map(foreignKeyKey));
    if (
      expected.size !== actual.size
      || [...expected].some(foreignKey => !actual.has(foreignKey))
    ) {
      issues.push(`invalid foreign keys for ${table}`);
    }
  }
  return issues;
}

function createValidationTriggers(connection) {
  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS validate_runs_insert
    BEFORE INSERT ON runs
    WHEN NEW.duration < 0 OR NEW.loot_value < 0 OR NEW.consumed_cost < 0
      OR NEW.total_loss < 0
    BEGIN
      SELECT RAISE(ABORT, 'run numeric values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_runs_update
    BEFORE UPDATE ON runs
    WHEN NEW.duration < 0 OR NEW.loot_value < 0 OR NEW.consumed_cost < 0
      OR NEW.total_loss < 0
    BEGIN
      SELECT RAISE(ABORT, 'run numeric values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_items_insert
    BEFORE INSERT ON run_items
    WHEN NEW.qty <= 0 OR NEW.unit_price_buy < 0 OR NEW.unit_price_sell < 0
      OR NEW.type NOT IN ('gained', 'consumed', 'lost')
    BEGIN
      SELECT RAISE(ABORT, 'run item values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_items_update
    BEFORE UPDATE ON run_items
    WHEN NEW.qty <= 0 OR NEW.unit_price_buy < 0 OR NEW.unit_price_sell < 0
      OR NEW.type NOT IN ('gained', 'consumed', 'lost')
    BEGIN
      SELECT RAISE(ABORT, 'run item values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_fitting_insert
    BEFORE INSERT ON run_fitting
    WHEN NEW.qty <= 0 OR NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'fitting values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_fitting_update
    BEFORE UPDATE ON run_fitting
    WHEN NEW.qty <= 0 OR NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'fitting values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_implants_insert
    BEFORE INSERT ON run_implants
    WHEN NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'implant values are invalid');
    END;
    CREATE TRIGGER IF NOT EXISTS validate_run_implants_update
    BEFORE UPDATE ON run_implants
    WHEN NEW.unit_price_sell < 0
    BEGIN
      SELECT RAISE(ABORT, 'implant values are invalid');
    END;
  `);
}

function createSchema(connection) {
  connection.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      portrait_url TEXT,
      client_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('oauth', 'janice')),
      character_id INTEGER,
      ciphertext TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version >= 0),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      CHECK(
        (kind = 'oauth' AND character_id IS NOT NULL)
        OR (kind = 'janice' AND character_id IS NULL)
      ),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE fit_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT NOT NULL UNIQUE,
      signature_hash TEXT NOT NULL,
      hull_name TEXT NOT NULL,
      display_name TEXT CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0 CHECK(duration >= 0),
      tier TEXT,
      weather TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('Survived', 'Died')),
      loot_value REAL NOT NULL DEFAULT 0 CHECK(loot_value >= 0),
      consumed_cost REAL NOT NULL DEFAULT 0 CHECK(consumed_cost >= 0),
      net_isk REAL NOT NULL DEFAULT 0,
      total_loss REAL NOT NULL DEFAULT 0 CHECK(total_loss >= 0),
      system_id INTEGER,
      system_name TEXT,
      appraised_at INTEGER,
      cargo_before TEXT,
      cargo_after TEXT,
      drone_before TEXT,
      drone_after TEXT,
      hull_name TEXT,
      ship_class TEXT,
      fit_identity_id INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (fit_identity_id) REFERENCES fit_identities(id) ON DELETE SET NULL
    );

    CREATE TABLE run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0),
      type TEXT NOT NULL CHECK(type IN ('gained','consumed','lost')),
      unit_price_buy REAL NOT NULL DEFAULT 0 CHECK(unit_price_buy >= 0),
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_fitting (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1 CHECK(qty > 0),
      slot TEXT,
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_implants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      type_id INTEGER NOT NULL,
      type_name TEXT NOT NULL,
      slot INTEGER,
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_tags (
      run_id INTEGER NOT NULL,
      tag TEXT NOT NULL COLLATE NOCASE,
      PRIMARY KEY (run_id, tag),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE run_killmails (
      run_id INTEGER NOT NULL,
      killmail_id INTEGER NOT NULL,
      PRIMARY KEY (run_id, killmail_id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE active_run_state (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX credential_oauth_character
      ON credentials(character_id) WHERE kind = 'oauth';
    CREATE UNIQUE INDEX credential_janice_singleton
      ON credentials(kind) WHERE kind = 'janice';
    CREATE UNIQUE INDEX runs_character_started
      ON runs(character_id, started_at);
    CREATE INDEX idx_runs_character_started
      ON runs(character_id, started_at DESC);
    CREATE INDEX idx_runs_fit_identity_started
      ON runs(fit_identity_id, started_at DESC);
    CREATE INDEX idx_fit_identities_hash
      ON fit_identities(signature_hash);
    CREATE INDEX idx_run_items_run_type_name
      ON run_items(run_id, type, item_name COLLATE NOCASE);
    CREATE INDEX idx_run_tags_tag
      ON run_tags(tag COLLATE NOCASE);
  `);
  createValidationTriggers(connection);
}

module.exports = {
  ABYSSLOG_APPLICATION_ID,
  CURRENT_SCHEMA_CONTRACT,
  SCHEMA_VERSION,
  createSchema,
  getCurrentSchemaIssues,
  tableColumns,
};
