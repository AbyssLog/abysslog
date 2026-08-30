# AbyssLog 1.2 data model

Status: historical schema-v6 reference for AbyssLog 1.2.0 and 1.2.1. Schema v7
supersedes this runtime contract in AbyssLog 1.2.2.

## Design goals

- Preserve captured historical values and original inventory text.
- Separate captured snapshots, derived inventory changes, and price appraisals.
- Give each run a stable export and import identity independent of local row IDs.
- Store exact historical fits once while keeping fit equivalence and display names
  separate.
- Retain original and later appraisals instead of overwriting price history.
- Keep renderer payloads smaller than storage rows.

Cloud synchronization, accounts, event sourcing, and relational active-run drafts
are outside this model.

## Current contract

The database uses application identity `0x4142594c`, SQLite `user_version = 6`,
foreign keys, WAL mode, and secure deletion. Startup and restore validate the full
schema contract before accepting a file.

Foreign databases, other schema versions, unsupported credential formats, and
structurally incomplete files are rejected without mutation.

## Runs

`runs` is the aggregate root. Each row has:

- a stable `run_uid` for CSV interchange and duplicate detection;
- a local integer ID used by related tables;
- character, timing, tier, weather, outcome, system, notes, and hull metadata;
- an optional reference to an exact fit snapshot.

`hull_name` is the hull type. Pilot-assigned ship names are not stored, and the
former `ship_name` field is not supported by runtime payloads or the 1.2 CSV.

Tags and verified killmail IDs are stored in `run_tags` and `run_killmails`.

## Inventory snapshots

`inventory_snapshots` stores the inventory phase, location, original text,
capture metadata, and parse status.

- Phase is `before`, `after`, or `loss`.
- Location is `cargo` or `drone`.
- Parse status is `complete`, `partial`, or `unparsed`.

`inventory_snapshot_items` stores the parsed item name, optional EVE type ID,
and quantity. Raw text remains available when no normalized item rows can be
created.

Item Drops statistics use only survived runs with complete before-and-after cargo
snapshots and at least one positive cargo gain. Drone changes and appraisal values
do not affect drop quantities.

## Fits

`fit_identities` owns canonical equivalence and optional display names. Canonical
equivalence includes hull, modules, drones, and implants. It ignores display names,
generated ship names, prices, and slot placement.

`fit_snapshots` stores immutable captured setups. Exact snapshots are globally
deduplicated within the local database using a versioned signature that includes
hull, item, quantity, implant, and exact slot data. Each snapshot maps to one
canonical identity.

`fit_snapshot_items` and `fit_snapshot_implants` retain captured names, optional
type IDs, quantities, and slot metadata. Fitted and implant prices belong to
appraisal reference lines rather than fit snapshots.

## Appraisals

`appraisals` stores immutable pricing results. A run can have multiple revisions,
but exactly one is current. Statistics and renderer summaries read the current
revision.

Each appraisal records:

- provider and source, such as Janice, killmail, manual, or migrated data;
- appraisal time and survived or loss kind;
- totals, resolution status, and current-selection state.

`appraisal_lines` stores gained, consumed, lost, fitted-reference, and
implant-reference items with captured quantities and unit prices. Historical
prices remain SQLite `REAL` values to avoid changing monetary representation
during the schema migration.

## Active runs

`active_run_state` stores one bounded, versioned JSON recovery payload per
character. It is temporary UI recovery state, not analytical history. The current
payload version is 2 and uses `hull_name`.

## CSV interchange

Import and export accept only the versioned 1.2 History format. Each row contains
the stable run UID and JSON records for exact fits, inventory snapshots, appraisal
history, tags, and killmail IDs.

Import validates the complete row before writing it. An existing `run_uid` is
skipped rather than duplicated.

## Schema-v5 migration record

The private `1.2.0-private.1` candidate migrated the production schema-v5 database
to schema v6 in one transaction. The migration:

1. created and verified a byte-identical pre-migration backup;
2. created schema-v6 tables and indexes beside the old tables;
3. generated deterministic run UIDs;
4. converted raw inventory fields into snapshots while preserving original text;
5. created exact fit snapshots linked to existing canonical identities;
6. created one current appraisal for each historical run;
7. verified counts, relationships, hashes, and aggregate totals;
8. ran foreign-key and integrity checks before commit.

After private verification, schema-v5 migration and restore code was removed.
Current builds reject schema-v5 files without changing them.

## Verification evidence

Migration and current-schema tests confirmed:

- character, run, fit, credential, tag, and killmail counts were preserved;
- every run received a current migrated appraisal and reference lines;
- exact fits were deduplicated without changing canonical equivalence;
- original inventory text and normalized snapshot items were retained;
- aggregate loot, consumed, net, and loss totals were unchanged;
- foreign-key checks and SQLite integrity checks passed;
- the source schema-v5 database remained unchanged during validation;
- the 1.2 CSV restored all exported normalized records into a fresh schema-v6
  database;
- packaged startup passed with fresh and populated schema-v6 profiles.

Optional empty system names and notes normalize to SQL `NULL` during 1.2 CSV
round-trips.
