const SCHEMA_VERSION_V6 = 6;
const FIT_IDENTITY_ALGORITHM_VERSION = 1;

function createCredentialTable(connection) {
  connection.exec(`
    CREATE TABLE credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('oauth', 'janice')),
      character_id INTEGER,
      ciphertext TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version = 1),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      CHECK(
        (kind = 'oauth' AND character_id IS NOT NULL)
        OR (kind = 'janice' AND character_id IS NULL)
      ),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX credential_oauth_character
      ON credentials(character_id) WHERE kind = 'oauth';
    CREATE UNIQUE INDEX credential_janice_singleton
      ON credentials(kind) WHERE kind = 'janice';
  `);
}

function createFitIdentityTable(connection) {
  connection.exec(`
    CREATE TABLE fit_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      algorithm_version INTEGER NOT NULL DEFAULT 1 CHECK(algorithm_version = 1),
      signature TEXT NOT NULL UNIQUE,
      signature_hash TEXT NOT NULL,
      hull_name TEXT NOT NULL,
      display_name TEXT CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX idx_fit_identities_hash ON fit_identities(signature_hash);
  `);
}

function createRunStorageTables(connection) {
  connection.exec(`
    CREATE TABLE fit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      format_version INTEGER NOT NULL CHECK(format_version = 1),
      signature TEXT NOT NULL UNIQUE,
      signature_hash TEXT NOT NULL,
      fit_identity_id INTEGER,
      hull_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (fit_identity_id) REFERENCES fit_identities(id) ON DELETE RESTRICT
    );

    CREATE TABLE runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_uid TEXT NOT NULL UNIQUE,
      character_id INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0 CHECK(duration >= 0),
      tier TEXT,
      weather TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('Survived', 'Died')),
      system_id INTEGER,
      system_name TEXT,
      hull_name TEXT,
      ship_class TEXT,
      fit_snapshot_id INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (fit_snapshot_id) REFERENCES fit_snapshots(id) ON DELETE SET NULL
    );

    CREATE TABLE inventory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      format_version INTEGER NOT NULL CHECK(format_version = 1),
      phase TEXT NOT NULL CHECK(phase IN ('before', 'after', 'loss')),
      location TEXT NOT NULL CHECK(location IN ('cargo', 'drone')),
      raw_text TEXT,
      captured_at INTEGER,
      parse_status TEXT NOT NULL CHECK(parse_status IN ('complete', 'partial', 'unparsed')),
      parse_error_code TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(run_id, phase, location),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE inventory_snapshot_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      type_id INTEGER,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0),
      FOREIGN KEY (snapshot_id) REFERENCES inventory_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE fit_snapshot_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      type_id INTEGER,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0),
      slot TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (snapshot_id) REFERENCES fit_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE fit_snapshot_implants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      type_id INTEGER,
      type_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1 CHECK(qty > 0),
      slot TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (snapshot_id) REFERENCES fit_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE appraisals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      format_version INTEGER NOT NULL CHECK(format_version = 1),
      kind TEXT NOT NULL CHECK(kind IN ('survived', 'loss')),
      source TEXT NOT NULL CHECK(source IN ('janice', 'killmail', 'manual', 'migrated')),
      provider TEXT NOT NULL CHECK(provider IN ('janice', 'esi', 'manual', 'legacy')),
      appraised_at INTEGER,
      resolution_status TEXT NOT NULL CHECK(resolution_status IN ('complete', 'partial', 'failed')),
      loot_value REAL NOT NULL DEFAULT 0 CHECK(loot_value >= 0),
      consumed_cost REAL NOT NULL DEFAULT 0 CHECK(consumed_cost >= 0),
      net_isk REAL NOT NULL DEFAULT 0,
      total_loss REAL NOT NULL DEFAULT 0 CHECK(total_loss >= 0),
      is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0, 1)),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE appraisal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appraisal_id INTEGER NOT NULL,
      type_id INTEGER,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK(qty > 0),
      disposition TEXT NOT NULL
        CHECK(disposition IN ('gained', 'consumed', 'lost', 'fitted', 'implant')),
      unit_price_buy REAL NOT NULL DEFAULT 0 CHECK(unit_price_buy >= 0),
      unit_price_sell REAL NOT NULL DEFAULT 0 CHECK(unit_price_sell >= 0),
      FOREIGN KEY (appraisal_id) REFERENCES appraisals(id) ON DELETE CASCADE
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

    CREATE UNIQUE INDEX runs_character_started
      ON runs(character_id, started_at);
    CREATE INDEX idx_runs_character_started
      ON runs(character_id, started_at DESC);
    CREATE INDEX idx_runs_fit_snapshot_started
      ON runs(fit_snapshot_id, started_at DESC);
    CREATE INDEX idx_fit_snapshots_hash
      ON fit_snapshots(signature_hash);
    CREATE INDEX idx_inventory_snapshots_run
      ON inventory_snapshots(run_id, phase, location);
    CREATE INDEX idx_inventory_snapshot_items_name
      ON inventory_snapshot_items(item_name COLLATE NOCASE, snapshot_id);
    CREATE INDEX idx_fit_snapshot_items_snapshot_slot
      ON fit_snapshot_items(snapshot_id, slot, type_name COLLATE NOCASE);
    CREATE INDEX idx_fit_snapshot_implants_snapshot_slot
      ON fit_snapshot_implants(snapshot_id, slot);
    CREATE UNIQUE INDEX appraisal_current_per_run
      ON appraisals(run_id) WHERE is_current = 1;
    CREATE INDEX idx_appraisals_run_time
      ON appraisals(run_id, appraised_at DESC, id DESC);
    CREATE INDEX idx_appraisal_lines_name
      ON appraisal_lines(item_name COLLATE NOCASE, disposition, appraisal_id);
    CREATE INDEX idx_run_tags_tag
      ON run_tags(tag COLLATE NOCASE);
  `);
}

function createFreshSchemaV6(connection) {
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
  `);
  createCredentialTable(connection);
  createFitIdentityTable(connection);
  createRunStorageTables(connection);
  connection.exec(`
    CREATE TABLE active_run_state (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);
}

module.exports = {
  FIT_IDENTITY_ALGORITHM_VERSION,
  SCHEMA_VERSION_V6,
  createCredentialTable,
  createFitIdentityTable,
  createFreshSchemaV6,
  createRunStorageTables,
};
