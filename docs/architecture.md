# AbyssLog architecture

This document describes runtime ownership, trust boundaries, and data flow in
AbyssLog 1.2.2.

## Runtime boundaries

AbyssLog is an Electron application with three trust zones:

1. The renderer owns presentation and transient UI state. It has no Node.js,
   filesystem, or direct network access.
2. The preload script exposes a fixed `window.api` surface backed by named IPC
   channels. It does not expose a general IPC primitive.
3. The main process validates the sender and every payload before using database,
   operating-system, clipboard, dialog, or network capabilities.

Packaged renderer assets load from the private `abysslog-app://bundle` origin.
Navigation, child windows, webviews, unexpected permissions, and renderer network
requests are blocked.

## Source ownership

### Renderer

- `app.js`: top-level feature composition, active-run orchestration, and shared
  event routing.
- `navigation-controller.js` and `modal-controller.js`: page and dialog lifecycle,
  including ARIA state and focus handling.
- `run-session-controller.js`: checkpoint serialization and appraisal or
  finalization generations.
- `manual-run-controller.js` and `run-details-controller.js`: manual entry,
  historical editing, re-appraisal, captured setup, and deletion.
- `manual-encounter-controller.js` and `manual-encounter-markup.js`: shared
  manual encounter fields, participant inventory and appraisal, and one atomic
  group save request.
- `character-controller.js`: character lists, permissions, SSO presentation,
  reauthorization, and removal.
- `support-settings-controller.js`: public settings, Janice-key controls, CSV
  import, backup and restore, and diagnostics.
- `loadout-controller.js`, `fit-name-controller.js`, and
  `appraisal-history-view.js`: focused loadout, fit-name, and appraisal-history
  behavior.
- `stats-view.js`: Statistics ranges, overview, and chart.
- `statistics-report-controller.js` and `statistics-report-markup.js`: report
  definition, options, rendering, sorting, formatting, and History drill-through.
- `tracker-view-controller.js` and `tracker-view-markup.js`: Tracker inventory
  stages, pre-run review, current-session metrics, and recent-run rendering.
- `concurrent-tracking-controller.js`: independent polling, transition state,
  active checkpoints, fit capture, and encounter matching for non-selected
  characters.
- `character-tracking-ui-controller.js` and
  `tracking-preparation-controller.js`: dropdown status, group status, and
  persistent per-character pre-run drafts.
- `history-view.js`: History filters, sorting, request generations, and match
  context.
- `inventory-editor.js`, `ui-formatters.js`, and `ui-task-controller.js`:
  reusable inventory editing, formatting, and bounded UI error handling.

### Main process

- `main.js`: Electron startup and main-process service composition.
- `preload.js`: the renderer-to-main API contract.
- `ipc-guard.js` and `ipc/`: sender checks, payload bounds, restore blocking, and
  feature-specific IPC registration.
- `oauth-service.js` and `credential-service.js`: PKCE, authorization persistence,
  credential validation, and `safeStorage` encryption.
- `esi.js`, `janice.js`, and `http-client.js`: validated external-service clients,
  bounded HTTP, retries, and rate-limit waits.
- `database.js`: stable persistence entry point.
- `database/facade.js`: repository and lifecycle composition. It contains no SQL.
- `database/schema.js` and `schema-contract-v7.js`: current schema creation and
  structural validation.
- `database/lifecycle-service.js`, `schema-v7-migration-service.js`, and
  `backup-service.js`: schema-v7 connection, schema-v6 migration, verified
  backups, restore, and rollback.
- `database/`: focused repositories for characters, settings, credentials,
  inventory baselines, runs, fits, appraisals, statistics, and CSV.
- `database/statistics-report-repository.js`: typed Run Performance and Item Drops
  aggregation.

### Shared modules

`src/shared` contains deterministic logic that can run in Node tests and the
renderer. Important contracts include fit identity, inventory parsing, security
validation, run-domain values, statistics ranges, and report definitions.

## Startup

1. Register the private renderer protocol and OAuth callback protocol.
2. Acquire the single-instance lock.
3. Start diagnostics and open SQLite.
4. Validate schema v7, or transactionally migrate schema v6 after a verified
   pre-migration backup.
5. Create the sandboxed `BrowserWindow` with context isolation and no Node.js
   integration.
6. Load settings, characters, credential status, backup status, diagnostics,
   and loadout presets.
7. Restore every per-character preparation and active checkpoint.
8. Poll every character that granted automatic tracking access. The dropdown
   selects the detailed Tracker view without suspending other characters.

The renderer remains active while the window is minimized so character polling
does not depend on window visibility. Closing AbyssLog stops all tracking.

Startup rejects foreign, outdated, or structurally incomplete databases without
mutating them.

## Run lifecycle

The renderer has five visible states:

```text
awaiting
  -> in-abyss
  -> awaiting-cargo -> appraisal -> awaiting
  -> died -----------------------> awaiting
```

Only `in-abyss`, `awaiting-cargo`, and `died` are checkpointed. Appraisal results
are not checkpointed. After a restart, a survived run returns to
`awaiting-cargo` and must be appraised again.

### Starting a run

A run starts manually or after consecutive ESI observations confirm Abyssal
entry. It captures:

- character, start time, tier, weather, system, hull type, notes, and tags;
- pre-run cargo and drone snapshots;
- fitting and implant snapshots when authorized.

The first checkpoint is written immediately. Later inventory edits schedule a
serialized, debounced checkpoint.

### Automatic transitions

Location and active hull are polled concurrently. The transition tracker requires
consecutive observations before confirming entry or exit. Capsule evidence during
exit selects the `Died` outcome.

Each polling session carries a generation and character ID. A stale result or a
result for a character that became selected cannot update background state.
Failures and backoff remain isolated to the affected character.

Characters entering Abyssal space within three minutes are presented as a group
candidate. ESI system IDs do not prove instance identity, so runs keep separate
encounter UUIDs until the user confirms the group. Manual runs and observations
outside Abyssal systems are never suggested automatically.

Candidate composition must be two or three frigates, or two destroyers, all of
the same ship class. Repository validation applies the same limits to completed
runs, manual input, and CSV import. Cruisers can only create solo encounters.

### Survived appraisal

Cargo and optional drone snapshots are parsed and compared. Gained items use
Janice buy prices. Consumed items use Janice sell prices. Net ISK is gained value
minus replacement cost.

Unresolved items remain in the saved appraisal with zero prices, preserving item
names for History search. After save, the post-run inventory becomes the next
baseline. An explicit clear marker prevents an older run from restoring a baseline
the user removed.

### Death appraisal

When killmail access is authorized, ESI is queried for ship and pod losses in the
run window. A verified killmail replaces estimated fit, implant, cargo, and drone
losses.

If no killmail is available, AbyssLog uses the captured pre-run inventory, fit,
and implants. The user can retry because killmails may be delayed.

Every asynchronous run operation rechecks its lifecycle after each `await`:

- the active run is still the captured run;
- the run is not finalizing;
- the run is not suspended for a character switch;
- the appraisal or polling generation is still current.

### Finalization

Save marks the run as finalizing before any awaited work. The renderer builds a
validated payload and invokes `runs:complete-active`.

One database transaction then:

1. checks for an existing run with the same character and start time;
2. inserts run metadata, exact fit data, inventory snapshots, and the first
   current appraisal when needed;
3. clears the active checkpoint;
4. returns the completed run ID.

Repeated completion requests are idempotent within this storage model.

Manual group entry appraises every participant before invoking
`runs:save-encounter`. Validation requires one shared environment and a valid
frigate or destroyer composition. One database transaction saves every
participant under a new encounter UUID or rolls the complete operation back.

## History, CSV, and statistics

History owns one filter object. Free-text search covers run metadata, tags, and
gained, consumed, or lost item names. Structured filters cover dates, tier,
weather, outcome, hull, fit, and tags. Asynchronous renders use request
generations to discard stale responses.

History CSV export receives the same filters as the visible query. The versioned
1.2.2 format includes stable encounter and run UIDs plus exact fits, inventory
snapshots, appraisal history, tags, and killmail IDs. Import skips a duplicate
run UID.

Tracker shows the current session beside the current and recent runs. It groups
completed runs separated by no more than one hour and marks an unfinished run as
active or pending. Session Net remains the combined session result, including
death losses. Pre-run inventory stays mounted while its visible panel is
replaced by post-run entry after survival. The earlier snapshot can be reviewed
or edited in a modal without duplicating its state.

The Statistics overview contains summary tiles, date controls, and an activity
chart. Net metrics in the overview, activity chart, and reports use survived-run
income, while average and total death losses remain separate. The report builder provides:

- Run Performance aggregation from current run results;
- Item Drops aggregation from positive changes between complete before-and-after
  cargo snapshots;
- up to two selected grouping dimensions;
- exact History drill-through that preserves the Statistics date range.

Report dimensions and metrics are allowlisted in `statistics-report.js`. Item is
an implicit dimension when an Item Drops report has no exact item filter.

Fit groups use persisted canonical identities. Equivalence includes the captured
hull, modules, drones, and implants, but not display names or slot placement.
Display names are metadata and do not alter historical snapshots.

## Persistence

SQLite uses WAL mode, foreign keys, and secure deletion.

- `characters`: public EVE identity.
- `settings`: public preferences.
- `credentials`: format-1 `safeStorage` ciphertext for OAuth tokens and the
  Janice key.
- `runs`: stable `run_uid`, metadata, canonical `hull_name`, and an optional fit
  snapshot reference. Each row is one character's ship entry.
- `encounters`: shared timing, tier, weather, and Abyssal identity for one or
  more character runs.
- `tracking_drafts`: one validated pre-run preparation per character.
- `fit_identities`: canonical equivalence and optional display names.
- `fit_snapshots`, `fit_snapshot_items`, and `fit_snapshot_implants`: globally
  deduplicated exact historical setups without prices or aliases.
- `inventory_snapshots` and `inventory_snapshot_items`: raw inventory text,
  capture and parse metadata, and normalized items.
- `appraisals` and `appraisal_lines`: immutable price results. Exactly one
  appraisal per run is current.
- `run_tags` and `run_killmails`: searchable tags and verified loss provenance.
- `active_run_state`: one versioned recovery snapshot per character.

Recovery payloads use version 3, `encounter_uid`, and `hull_name`. Runtime
payloads and the 1.2.2 CSV
do not support the former `ship_name` field.

Schema v7 is the current database and full-backup contract. Startup accepts only
schema v7 or schema v6 for the one-way v7 migration.

## Backup and restore

Each clean exit writes a verified automatic backup for the current local date.
The latest seven automatic backups are retained. Manual backups use unique
timestamps and are not pruned automatically.

Restore accepts schema-v7 backups and verified schema-v6 backups from AbyssLog
1.2. It validates a temporary private copy, creates a before-restore safety
backup, replaces the live database, migrates schema v6 when required, and rolls
back if the replacement cannot be opened safely.

## Change rules

- Keep deterministic transformations in shared modules.
- Keep privileged work behind explicit preload methods and validated IPC.
- Treat character switches, cancellation, and finalization as asynchronous
  cancellation boundaries.
- Preserve the database facade and preload contract across internal refactors.
- Keep new backups strict to schema v7. Limit startup and restore migration to
  verified schema-v6 databases.
- Keep fit display names outside equivalence signatures and captured snapshots.
- Keep PKCE and pending authorization state in `oauth-service.js`.
- Keep selected-run orchestration visible in `app.js` and background polling in
  `concurrent-tracking-controller.js`.
- Add a race regression test for workflows that retain mutable renderer state
  across multiple awaits.
- Add focused controllers, registrars, and repositories instead of expanding
  `main.js`, `database.js`, or `app.js`.
