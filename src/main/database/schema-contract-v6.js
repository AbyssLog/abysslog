const CURRENT_SCHEMA_CONTRACT = Object.freeze({
  tables: Object.freeze({
    characters: Object.freeze(['id', 'name', 'portrait_url', 'client_id', 'created_at']),
    settings: Object.freeze(['key', 'value']),
    credentials: Object.freeze([
      'id', 'kind', 'character_id', 'ciphertext', 'format_version', 'updated_at',
    ]),
    fit_identities: Object.freeze([
      'id', 'algorithm_version', 'signature', 'signature_hash', 'hull_name',
      'display_name', 'created_at', 'updated_at',
    ]),
    fit_snapshots: Object.freeze([
      'id', 'format_version', 'signature', 'signature_hash', 'fit_identity_id',
      'hull_name', 'created_at',
    ]),
    runs: Object.freeze([
      'id', 'run_uid', 'character_id', 'started_at', 'duration', 'tier', 'weather',
      'outcome', 'system_id', 'system_name', 'hull_name', 'ship_class',
      'fit_snapshot_id', 'notes', 'created_at',
    ]),
    inventory_snapshots: Object.freeze([
      'id', 'run_id', 'format_version', 'phase', 'location', 'raw_text',
      'captured_at', 'parse_status', 'parse_error_code', 'created_at',
    ]),
    inventory_snapshot_items: Object.freeze([
      'id', 'snapshot_id', 'type_id', 'item_name', 'qty',
    ]),
    fit_snapshot_items: Object.freeze([
      'id', 'snapshot_id', 'type_id', 'type_name', 'qty', 'slot',
    ]),
    fit_snapshot_implants: Object.freeze([
      'id', 'snapshot_id', 'type_id', 'type_name', 'qty', 'slot',
    ]),
    appraisals: Object.freeze([
      'id', 'run_id', 'format_version', 'kind', 'source', 'provider', 'appraised_at',
      'resolution_status', 'loot_value', 'consumed_cost', 'net_isk', 'total_loss',
      'is_current', 'created_at',
    ]),
    appraisal_lines: Object.freeze([
      'id', 'appraisal_id', 'type_id', 'item_name', 'qty', 'disposition',
      'unit_price_buy', 'unit_price_sell',
    ]),
    run_tags: Object.freeze(['run_id', 'tag']),
    run_killmails: Object.freeze(['run_id', 'killmail_id']),
    active_run_state: Object.freeze(['character_id', 'snapshot', 'updated_at']),
  }),
  indexes: Object.freeze({
    credential_oauth_character: Object.freeze({
      table: 'credentials', columns: Object.freeze(['character_id']), unique: true, partial: true,
    }),
    credential_janice_singleton: Object.freeze({
      table: 'credentials', columns: Object.freeze(['kind']), unique: true, partial: true,
    }),
    idx_fit_identities_hash: Object.freeze({
      table: 'fit_identities', columns: Object.freeze(['signature_hash']), unique: false, partial: false,
    }),
    runs_character_started: Object.freeze({
      table: 'runs', columns: Object.freeze(['character_id', 'started_at']), unique: true, partial: false,
    }),
    idx_runs_character_started: Object.freeze({
      table: 'runs', columns: Object.freeze(['character_id', 'started_at']), unique: false, partial: false,
    }),
    idx_runs_fit_snapshot_started: Object.freeze({
      table: 'runs', columns: Object.freeze(['fit_snapshot_id', 'started_at']), unique: false, partial: false,
    }),
    idx_fit_snapshots_hash: Object.freeze({
      table: 'fit_snapshots', columns: Object.freeze(['signature_hash']), unique: false, partial: false,
    }),
    idx_inventory_snapshots_run: Object.freeze({
      table: 'inventory_snapshots', columns: Object.freeze(['run_id', 'phase', 'location']), unique: false, partial: false,
    }),
    idx_inventory_snapshot_items_name: Object.freeze({
      table: 'inventory_snapshot_items', columns: Object.freeze(['item_name', 'snapshot_id']), unique: false, partial: false,
    }),
    idx_fit_snapshot_items_snapshot_slot: Object.freeze({
      table: 'fit_snapshot_items', columns: Object.freeze(['snapshot_id', 'slot', 'type_name']), unique: false, partial: false,
    }),
    idx_fit_snapshot_implants_snapshot_slot: Object.freeze({
      table: 'fit_snapshot_implants', columns: Object.freeze(['snapshot_id', 'slot']), unique: false, partial: false,
    }),
    appraisal_current_per_run: Object.freeze({
      table: 'appraisals', columns: Object.freeze(['run_id']), unique: true, partial: true,
    }),
    idx_appraisals_run_time: Object.freeze({
      table: 'appraisals', columns: Object.freeze(['run_id', 'appraised_at', 'id']), unique: false, partial: false,
    }),
    idx_appraisal_lines_name: Object.freeze({
      table: 'appraisal_lines', columns: Object.freeze(['item_name', 'disposition', 'appraisal_id']), unique: false, partial: false,
    }),
    idx_run_tags_tag: Object.freeze({
      table: 'run_tags', columns: Object.freeze(['tag']), unique: false, partial: false,
    }),
  }),
  triggers: Object.freeze({}),
  tableSqlIncludes: Object.freeze({
    credentials: Object.freeze([
      "KIND TEXT NOT NULL CHECK(KIND IN ('OAUTH', 'JANICE'))",
      'FORMAT_VERSION INTEGER NOT NULL DEFAULT 1 CHECK(FORMAT_VERSION = 1)',
    ]),
    fit_identities: Object.freeze([
      'ALGORITHM_VERSION INTEGER NOT NULL DEFAULT 1 CHECK(ALGORITHM_VERSION = 1)',
      'SIGNATURE TEXT NOT NULL UNIQUE',
    ]),
    fit_snapshots: Object.freeze([
      'FORMAT_VERSION INTEGER NOT NULL CHECK(FORMAT_VERSION = 1)',
      'SIGNATURE TEXT NOT NULL UNIQUE',
    ]),
    runs: Object.freeze([
      'RUN_UID TEXT NOT NULL UNIQUE',
      "OUTCOME TEXT NOT NULL CHECK(OUTCOME IN ('SURVIVED', 'DIED'))",
    ]),
    inventory_snapshots: Object.freeze([
      'FORMAT_VERSION INTEGER NOT NULL CHECK(FORMAT_VERSION = 1)',
      "PARSE_STATUS TEXT NOT NULL CHECK(PARSE_STATUS IN ('COMPLETE', 'PARTIAL', 'UNPARSED'))",
      'UNIQUE(RUN_ID, PHASE, LOCATION)',
    ]),
    appraisals: Object.freeze([
      'FORMAT_VERSION INTEGER NOT NULL CHECK(FORMAT_VERSION = 1)',
      'IS_CURRENT INTEGER NOT NULL DEFAULT 0 CHECK(IS_CURRENT IN (0, 1))',
    ]),
  }),
  foreignKeys: Object.freeze({
    credentials: Object.freeze([
      Object.freeze({ from: 'character_id', table: 'characters', to: 'id', onDelete: 'CASCADE' }),
    ]),
    fit_snapshots: Object.freeze([
      Object.freeze({ from: 'fit_identity_id', table: 'fit_identities', to: 'id', onDelete: 'RESTRICT' }),
    ]),
    runs: Object.freeze([
      Object.freeze({ from: 'fit_snapshot_id', table: 'fit_snapshots', to: 'id', onDelete: 'SET NULL' }),
      Object.freeze({ from: 'character_id', table: 'characters', to: 'id', onDelete: 'CASCADE' }),
    ]),
    inventory_snapshots: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
    ]),
    inventory_snapshot_items: Object.freeze([
      Object.freeze({ from: 'snapshot_id', table: 'inventory_snapshots', to: 'id', onDelete: 'CASCADE' }),
    ]),
    fit_snapshot_items: Object.freeze([
      Object.freeze({ from: 'snapshot_id', table: 'fit_snapshots', to: 'id', onDelete: 'CASCADE' }),
    ]),
    fit_snapshot_implants: Object.freeze([
      Object.freeze({ from: 'snapshot_id', table: 'fit_snapshots', to: 'id', onDelete: 'CASCADE' }),
    ]),
    appraisals: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
    ]),
    appraisal_lines: Object.freeze([
      Object.freeze({ from: 'appraisal_id', table: 'appraisals', to: 'id', onDelete: 'CASCADE' }),
    ]),
    run_tags: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
    ]),
    run_killmails: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
    ]),
    active_run_state: Object.freeze([
      Object.freeze({ from: 'character_id', table: 'characters', to: 'id', onDelete: 'CASCADE' }),
    ]),
  }),
});

module.exports = { CURRENT_SCHEMA_CONTRACT };
