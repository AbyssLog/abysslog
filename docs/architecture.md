# AbyssLog architecture

This document describes runtime ownership, trust boundaries, and data flow in
AbyssLog 1.2.1.

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
- `character-controller.js`: character lists, permissions, SSO presentation,
  reauthorization, and removal.
- `support-settings-controller.js`: public settings, Janice-key controls, CSV
  import, backup and restore, and diagnostics.
- `loadout-controller.js`, `fit-name-controller.js`, and
  `appraisal-history-view.js`: focused loadout, fit-name, and appraisal-history
  behavior.
- `stats-view.js`: Statistics ranges, overview, latest session, and chart.
- `statistics-report-controller.js` and `statistics-report-markup.js`: report
  definition, options, rendering, sorting, formatting, and History drill-through.
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
- `database/schema.js` and `schema-contract-v6.js`: current schema creation and
  structural validation.
- `database/lifecycle-service.js` and `backup-service.js`: schema-v6 connection,
  backup, inspection, restore, and rollback.
- `database/`: focused repositories for characters, settings, credentials,
  inventory baselines, runs, fits, appraisals, statistics, and CSV.
- `database/statistics-report-repository.js`: typed Run Performance and Item Drops
  aggregation.

### Shared modules

`src/shared` contains deterministic logic that can run in Node tests and the
renderer. Important contracts include fit identity, inventory parsing, security
validation, statistics ranges, and report definitions.

## Startup

1. Register the private renderer protocol and OAuth callback protocol.
2. Acquire the single-instance lock.
3. Start diagnostics and open SQLite.
4. Validate the application ID and complete schema-v6 contract.
5. Create the sandboxed `BrowserWindow` with context isolation and no Node.js
   integration.
6. Load settings, characters, credential status, backup status, diagnostics,
   and loadout presets.
7. Restore the selected character and its active checkpoint or latest survived
   inventory baseline.
8. Start ESI polling only when that character granted tracking access.

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

Each polling loop carries a generation and character ID. A result from an older
generation or previously selected character cannot update current state.

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

## History, CSV, and statistics

History owns one filter object. Free-text search covers run metadata, tags, and
gained, consumed, or lost item names. Structured filters cover dates, tier,
weather, outcome, hull, fit, and tags. Asynchronous renders use request
generations to discard stale responses.

History CSV export receives the same filters as the visible query. The versioned
1.2 format includes stable run UIDs plus exact fits, inventory snapshots,
appraisal history, tags, and killmail IDs. Import skips a duplicate run UID.

The Statistics overview contains summary tiles, latest session, date controls,
and an activity chart. The report builder provides:

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
  snapshot reference.
- `fit_identities`: canonical equivalence and optional display names.
- `fit_snapshots`, `fit_snapshot_items`, and `fit_snapshot_implants`: globally
  deduplicated exact historical setups without prices or aliases.
- `inventory_snapshots` and `inventory_snapshot_items`: raw inventory text,
  capture and parse metadata, and normalized items.
- `appraisals` and `appraisal_lines`: immutable price results. Exactly one
  appraisal per run is current.
- `run_tags` and `run_killmails`: searchable tags and verified loss provenance.
- `active_run_state`: one versioned recovery snapshot per character.

Recovery payloads use version 2 and `hull_name`. Runtime payloads and the 1.2 CSV
do not support the former `ship_name` field.

Schema v6 is the only accepted database and full-backup contract.

## Backup and restore

Each clean exit writes a verified automatic backup for the current local date.
The latest seven automatic backups are retained. Manual backups use unique
timestamps and are not pruned automatically.

Restore accepts schema-v6 AbyssLog backups only. It validates a temporary private
copy, creates a before-restore safety backup, replaces the live database, and
rolls back if the replacement cannot be opened safely.

## Change rules

- Keep deterministic transformations in shared modules.
- Keep privileged work behind explicit preload methods and validated IPC.
- Treat character switches, cancellation, and finalization as asynchronous
  cancellation boundaries.
- Preserve the database facade and preload contract across internal refactors.
- Keep startup, backup, restore, and repositories strict to schema v6.
- Keep fit display names outside equivalence signatures and captured snapshots.
- Keep PKCE and pending authorization state in `oauth-service.js`.
- Keep active-run and polling transitions visible in `app.js`.
- Add a race regression test for workflows that retain mutable renderer state
  across multiple awaits.
- Add focused controllers, registrars, and repositories instead of expanding
  `main.js`, `database.js`, or `app.js`.
