# AbyssLog 1.2 data model

Status: implemented and verified; production data and backups are schema v6.

Implementation note: schema v6 is the only runtime and restore contract. The private
migration candidate completed successfully, and its retained v5 recovery backup,
byte-identical live/manual v6 databases, and complete History CSV were verified before
the candidate-only v5 path was removed.

## Goals

- Preserve every captured historical value and original inventory paste.
- Separate captured snapshots, derived inventory changes, and price appraisals.
- Give each run a stable export/import identity independent of local row IDs.
- Store exact historical setups once while keeping canonical fit equivalence and aliases separate.
- Preserve original and later appraisals instead of overwriting price history.
- Keep the renderer-facing run model small and keep statistics queries straightforward.
- Migrate the released v1.1.7/schema-v5 contract transactionally and verify it against real data.

## Non-goals

- Cloud synchronization or accounts.
- Event sourcing.
- Relational storage for the short-lived active-run recovery snapshot.
- Framework, TypeScript, or renderer build-system adoption.
- Credential or public-settings redesign.
- Removal of raw inventory text.
- Bundled Janice access; that remains an independent onboarding change.

## Historical invariants

Migration must preserve:

- character and run IDs, ordering, timestamps, outcomes, tiers, weather, hull types, classes, systems, notes, and tags;
- raw before/after cargo and drone text exactly, including empty and unparseable values;
- run item names, quantities, dispositions, captured prices, and displayed totals;
- captured fitting rows, drones, implants, and their slot metadata;
- canonical fit signatures, identity IDs, representative runs, and friendly names;
- killmail IDs and active-run recovery state;
- current character/run/fit/tag/killmail counts and all aggregate ISK totals.

The migration must never contact ESI or Janice and must not infer missing type IDs from the network.

## Proposed schema-v6 ownership

### Runs

`runs` remains the aggregate root and gains an immutable `run_uid` used by CSV interchange and future merging. Local integer IDs remain stable.

Run metadata remains on `runs`. Current appraisal totals should be read through the selected appraisal rather than independently overwritten fields.

### Inventory snapshots

`inventory_snapshots` stores:

- run ID;
- phase: `before`, `after`, or `loss`;
- location: `cargo` or `drone`;
- original raw text;
- capture time when known;
- parse status: `complete`, `partial`, or `unparsed`.

`inventory_snapshot_items` stores parsed item name, optional type ID, and quantity. Unparseable input keeps its raw text even when no item rows can be created.

### Fits

`fit_identities` continues to own equivalence signatures and friendly names. Equivalent modules, drones, and implants remain independent of generated ship names and slot placement.

`fit_snapshots` stores the exact historical captured setup. Runs reference a snapshot, and each snapshot references its canonical fit identity. Exact snapshots are globally deduplicated within the local database using a versioned configuration signature. The signature includes hull, module, drone, implant, quantity, and exact slot data, but excludes character, run, alias, ship name, appraisal, and price data. A snapshot is immutable and must map to exactly one canonical identity; migration fails rather than silently merging an inconsistency.

`fit_snapshot_items` and `fit_snapshot_implants` replace per-run fitting and implant
rows while retaining quantity, slot, captured name, and optional type ID. Prices are
appraisal facts and are retained as `fitted` and `implant` appraisal reference lines.

### Appraisals

`appraisals` stores one or more immutable pricing results per run:

- provider and source (`janice`, `killmail`, `manual`, or migrated legacy result);
- appraisal time;
- survived/loss appraisal kind;
- totals and resolution status;
- whether this is the currently selected appraisal.

`appraisal_lines` stores gained, consumed, lost, fitted-reference, or implant-reference
items with quantity and captured unit prices.

Schema v6 should continue using SQLite `REAL` for historical prices. Changing monetary representation during the same migration would add rounding risk without a current user-facing requirement.

### Active runs

`active_run_state` remains versioned JSON. It is bounded recovery state rather than long-lived analytical data, and the existing ownership is simpler than relational draft tables.

## Migration outline

1. Checkpoint and close the v5 database.
2. Create and verify a retained byte-for-byte pre-migration backup.
3. Reopen the live database and begin one immediate transaction.
4. Create schema-v6 tables and indexes alongside the v5 tables.
5. Generate deterministic run UIDs from the existing character, start time, and run ID.
6. Create inventory snapshots from all four raw inventory fields, retaining raw text even when parsing is incomplete.
7. Create exact fit snapshots and link them to the existing canonical fit identities.
8. Create one migrated appraisal per historical run from current totals and run-item rows.
9. Verify counts, relationships, aliases, raw-text hashes, and aggregate totals.
10. Rebuild or replace superseded tables only after all verification succeeds.
11. Set `user_version = 6` and retain the AbyssLog application ID.
12. Run foreign-key and integrity checks before committing.

Any failure rolls back the transaction and leaves the original database plus verified backup available.

## Verification fixtures

Migration tests must cover:

- a fresh schema-v6 database;
- the released empty and populated schema-v5 contracts;
- a representative populated database and full backup;
- empty, malformed, and partially parseable inventory text;
- equivalent fits with different slots plus non-equivalent drones or implants;
- survived, loss, killmail, unpriced-item, and re-appraised runs;
- fault injection after each migration stage;
- repeated open after successful migration and repeated failure without partial state;
- schema-v5 backup restore followed by migration;
- newer, foreign, corrupt, and structurally incomplete databases rejected without mutation.

## Approved decisions

1. Appraisal history will be stored and exposed through a minimal user-visible 1.2.0 interface.
2. Immutable exact fit snapshots will be globally deduplicated within each local database using a versioned signature; canonical fit identity and aliases remain separate.
3. CSV import and export will support only the explicitly versioned 1.2 format.
4. The private migration candidate upgraded and verified the production schema-v5
   data set. Runtime schema-v5 support was then removed before public 1.2.0 preparation;
   the candidate, checksum, retained v5 backup, and v6 recovery artifacts remain private.

## Migration evidence

The migration completed successfully against disposable fixtures and the private
production schema-v5 database:

- character, run, fit-identity, credential, tag, and killmail counts were preserved;
- globally deduplicated exact-fit and raw-preserving inventory snapshots were created;
- every run received one current migrated appraisal with its reference lines;
- aggregate loot, consumed, net, and loss totals unchanged;
- zero foreign-key violations and successful SQLite quick checks;
- source database hashes unchanged after validation.

The migrated database and its verified backups reconcile exactly. The versioned 1.2
CSV restores every exported run and normalized record into a fresh schema-v6 database;
optional empty system names and notes canonically normalize to `NULL`. Packaged smoke
tests pass with both fresh and populated schema-v6 profiles.
