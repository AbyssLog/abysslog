const { createFreshSchemaV6 } = require('./schema-v6');
const { createNewRunUid } = require('./v6-identities');

const SCHEMA_VERSION_V7 = 7;

function createEncounterExtensions(connection) {
  connection.exec(`
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encounter_uid TEXT NOT NULL UNIQUE,
      started_at INTEGER NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0 CHECK(duration >= 0),
      tier TEXT,
      weather TEXT,
      system_id INTEGER,
      system_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE tracking_drafts (
      character_id INTEGER PRIMARY KEY,
      snapshot TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    ALTER TABLE runs ADD COLUMN encounter_id INTEGER
      REFERENCES encounters(id) ON DELETE RESTRICT;

    CREATE INDEX idx_encounters_started ON encounters(started_at DESC, id DESC);
    CREATE INDEX idx_runs_encounter ON runs(encounter_id, character_id);

    CREATE TRIGGER runs_require_encounter_insert
    BEFORE INSERT ON runs
    WHEN NEW.encounter_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Run encounter is required');
    END;

    CREATE TRIGGER runs_require_encounter_update
    BEFORE UPDATE ON runs
    WHEN NEW.encounter_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'Run encounter is required');
    END;
  `);
}

function migrateActiveSnapshots(connection) {
  const rows = connection.prepare('SELECT character_id, snapshot FROM active_run_state').all();
  const update = connection.prepare(
    'UPDATE active_run_state SET snapshot = ?, updated_at = strftime(\'%s\',\'now\') '
    + 'WHERE character_id = ?'
  );
  for (const row of rows) {
    try {
      const snapshot = JSON.parse(row.snapshot);
      if (snapshot?.version !== 2 || !snapshot.run || typeof snapshot.run !== 'object') continue;
      snapshot.version = 3;
      snapshot.run.encounter_uid = createNewRunUid();
      update.run(JSON.stringify(snapshot), row.character_id);
    } catch {
      // Invalid recovery state is cleared by the validated IPC read path.
    }
  }
}

function backfillSoloEncounters(connection) {
  connection.prepare(`
    INSERT INTO encounters
      (encounter_uid, started_at, duration, tier, weather, system_id, system_name, created_at)
    SELECT run_uid, started_at, duration, tier, weather, system_id, system_name, created_at
    FROM runs
    ORDER BY id
  `).run();
  connection.prepare(`
    UPDATE runs SET encounter_id = (
      SELECT encounter.id FROM encounters encounter
      WHERE encounter.encounter_uid = runs.run_uid
    )
  `).run();
  if (connection.prepare('SELECT 1 FROM runs WHERE encounter_id IS NULL LIMIT 1').get()) {
    throw new Error('Encounter migration left an unlinked run');
  }
}

function migrateSchemaV6ToV7(connection) {
  createEncounterExtensions(connection);
  backfillSoloEncounters(connection);
  migrateActiveSnapshots(connection);
  connection.pragma(`user_version = ${SCHEMA_VERSION_V7}`);
}

function createFreshSchemaV7(connection) {
  createFreshSchemaV6(connection);
  createEncounterExtensions(connection);
}

module.exports = {
  SCHEMA_VERSION_V7,
  createEncounterExtensions,
  createFreshSchemaV7,
  migrateSchemaV6ToV7,
};
