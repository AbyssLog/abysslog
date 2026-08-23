const CURRENT_SCHEMA_CONTRACT = Object.freeze({
  tables: Object.freeze({
    characters: Object.freeze(['id', 'name', 'portrait_url', 'client_id', 'created_at']),
    settings: Object.freeze(['key', 'value']),
    credentials: Object.freeze([
      'id', 'kind', 'character_id', 'ciphertext', 'format_version', 'updated_at',
    ]),
    fit_identities: Object.freeze([
      'id', 'signature', 'signature_hash', 'hull_name', 'display_name',
      'created_at', 'updated_at',
    ]),
    runs: Object.freeze([
      'id', 'character_id', 'started_at', 'duration', 'tier', 'weather', 'outcome',
      'loot_value', 'consumed_cost', 'net_isk', 'total_loss', 'system_id', 'system_name',
      'appraised_at', 'cargo_before', 'cargo_after', 'drone_before', 'drone_after',
      'hull_name', 'ship_class', 'fit_identity_id', 'notes', 'created_at',
    ]),
    run_items: Object.freeze([
      'id', 'run_id', 'item_name', 'qty', 'type', 'unit_price_buy', 'unit_price_sell',
    ]),
    run_fitting: Object.freeze([
      'id', 'run_id', 'type_id', 'type_name', 'qty', 'slot', 'unit_price_sell',
    ]),
    run_implants: Object.freeze([
      'id', 'run_id', 'type_id', 'type_name', 'slot', 'unit_price_sell',
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
    runs_character_started: Object.freeze({
      table: 'runs', columns: Object.freeze(['character_id', 'started_at']), unique: true, partial: false,
    }),
    idx_runs_character_started: Object.freeze({
      table: 'runs', columns: Object.freeze(['character_id', 'started_at']), unique: false, partial: false,
    }),
    idx_runs_fit_identity_started: Object.freeze({
      table: 'runs', columns: Object.freeze(['fit_identity_id', 'started_at']), unique: false, partial: false,
    }),
    idx_fit_identities_hash: Object.freeze({
      table: 'fit_identities', columns: Object.freeze(['signature_hash']), unique: false, partial: false,
    }),
    idx_run_items_run_type_name: Object.freeze({
      table: 'run_items', columns: Object.freeze(['run_id', 'type', 'item_name']), unique: false, partial: false,
    }),
    idx_run_tags_tag: Object.freeze({
      table: 'run_tags', columns: Object.freeze(['tag']), unique: false, partial: false,
    }),
  }),
  triggers: Object.freeze({
    validate_runs_insert: Object.freeze({
      table: 'runs', event: 'INSERT', message: 'run numeric values are invalid',
    }),
    validate_runs_update: Object.freeze({
      table: 'runs', event: 'UPDATE', message: 'run numeric values are invalid',
    }),
    validate_run_items_insert: Object.freeze({
      table: 'run_items', event: 'INSERT', message: 'run item values are invalid',
    }),
    validate_run_items_update: Object.freeze({
      table: 'run_items', event: 'UPDATE', message: 'run item values are invalid',
    }),
    validate_run_fitting_insert: Object.freeze({
      table: 'run_fitting', event: 'INSERT', message: 'fitting values are invalid',
    }),
    validate_run_fitting_update: Object.freeze({
      table: 'run_fitting', event: 'UPDATE', message: 'fitting values are invalid',
    }),
    validate_run_implants_insert: Object.freeze({
      table: 'run_implants', event: 'INSERT', message: 'implant values are invalid',
    }),
    validate_run_implants_update: Object.freeze({
      table: 'run_implants', event: 'UPDATE', message: 'implant values are invalid',
    }),
  }),
  foreignKeys: Object.freeze({
    credentials: Object.freeze([
      Object.freeze({ from: 'character_id', table: 'characters', to: 'id', onDelete: 'CASCADE' }),
    ]),
    runs: Object.freeze([
      Object.freeze({ from: 'character_id', table: 'characters', to: 'id', onDelete: 'CASCADE' }),
      Object.freeze({ from: 'fit_identity_id', table: 'fit_identities', to: 'id', onDelete: 'SET NULL' }),
    ]),
    run_items: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
    ]),
    run_fitting: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
    ]),
    run_implants: Object.freeze([
      Object.freeze({ from: 'run_id', table: 'runs', to: 'id', onDelete: 'CASCADE' }),
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
