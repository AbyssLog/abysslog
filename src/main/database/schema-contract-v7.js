const { CURRENT_SCHEMA_CONTRACT: V6_CONTRACT } = require('./schema-contract-v6');

const CURRENT_SCHEMA_CONTRACT = Object.freeze({
  tables: Object.freeze({
    ...V6_CONTRACT.tables,
    encounters: Object.freeze([
      'id', 'encounter_uid', 'started_at', 'duration', 'tier', 'weather',
      'system_id', 'system_name', 'created_at',
    ]),
    runs: Object.freeze([...V6_CONTRACT.tables.runs, 'encounter_id']),
    tracking_drafts: Object.freeze(['character_id', 'snapshot', 'updated_at']),
  }),
  indexes: Object.freeze({
    ...V6_CONTRACT.indexes,
    idx_encounters_started: Object.freeze({
      table: 'encounters', columns: Object.freeze(['started_at', 'id']),
      unique: false, partial: false,
    }),
    idx_runs_encounter: Object.freeze({
      table: 'runs', columns: Object.freeze(['encounter_id', 'character_id']),
      unique: false, partial: false,
    }),
  }),
  triggers: Object.freeze({
    runs_require_encounter_insert: Object.freeze({
      table: 'runs', event: 'INSERT', message: 'Run encounter is required',
    }),
    runs_require_encounter_update: Object.freeze({
      table: 'runs', event: 'UPDATE', message: 'Run encounter is required',
    }),
  }),
  tableSqlIncludes: Object.freeze({
    ...V6_CONTRACT.tableSqlIncludes,
    encounters: Object.freeze([
      'ENCOUNTER_UID TEXT NOT NULL UNIQUE',
      'DURATION INTEGER NOT NULL DEFAULT 0 CHECK(DURATION >= 0)',
    ]),
    tracking_drafts: Object.freeze([
      'CHARACTER_ID INTEGER PRIMARY KEY',
      'SNAPSHOT TEXT NOT NULL',
    ]),
  }),
  foreignKeys: Object.freeze({
    ...V6_CONTRACT.foreignKeys,
    encounters: Object.freeze([]),
    runs: Object.freeze([
      ...V6_CONTRACT.foreignKeys.runs,
      Object.freeze({
        from: 'encounter_id', table: 'encounters', to: 'id', onDelete: 'RESTRICT',
      }),
    ]),
    tracking_drafts: Object.freeze([
      Object.freeze({
        from: 'character_id', table: 'characters', to: 'id', onDelete: 'CASCADE',
      }),
    ]),
  }),
});

module.exports = { CURRENT_SCHEMA_CONTRACT };
