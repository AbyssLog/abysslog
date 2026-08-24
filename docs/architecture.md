# AbyssLog architecture

This document describes the runtime boundaries and state transitions that matter
when changing AbyssLog. It intentionally focuses on ownership and data flow
rather than individual UI controls.

## Runtime processes

AbyssLog is an Electron application with three trust zones.

1. The renderer displays the application and owns transient UI state. It has no
   Node.js access and cannot make network or filesystem requests directly.
2. The preload script exposes a fixed window.api surface. Each method invokes a
   named IPC channel; no general-purpose IPC primitive is exposed.
3. The main process validates the sender and every payload before using
   operating-system, database, clipboard, dialog, or network capabilities.

The packaged renderer is served from the private abysslog-app://bundle origin.
Navigation, child windows, webviews, unexpected permissions, and renderer
network access are blocked.

## Source map

- src/renderer/app.js coordinates feature controllers and top-level events.
- src/renderer/navigation-controller.js owns page selection and navigation ARIA state.
- src/renderer/modal-controller.js owns dialog lifecycle, focus return, focus trapping, and Escape/overlay dismissal.
- src/renderer/ui-formatters.js owns shared ISK, duration, and byte formatting.
- src/renderer/run-session-controller.js owns checkpoint serialization and
  appraisal/finalization generations.
- src/renderer/ui-task-controller.js owns UI error reporting, diagnostics, and recovery wrappers.
- src/renderer/support-settings-controller.js owns settings, backup/restore, CSV, diagnostics, and Janice-key interactions.
- src/renderer/loadout-controller.js owns loadout preset selection, editing, persistence, and application.
- src/renderer/run-details-controller.js owns historical details, re-appraisal, captured setup, clipboard export, and deletion.
- src/renderer/appraisal-history-view.js renders immutable appraisal revisions in run details.
- src/renderer/fit-name-controller.js owns canonical-fit display-name editing.
- src/renderer/manual-run-controller.js owns manual run entry, historical run editing, staged appraisal, and submission guards.
- src/renderer/character-controller.js owns character lists, permission selection, SSO presentation, reauthorization, and removal UI. renderer/app.js retains active-run character-switch orchestration.
- src/renderer/stats-view.js owns statistics range controls, session and analytics markup, and charts.
- src/renderer/statistics-report-controller.js owns dynamic report state, options,
  result generations, sorting, formatting, and History drill-through.
- src/renderer/statistics-report-markup.js owns accessible report-builder markup.
- src/renderer/history-view.js owns history filter mapping, sorting, result generations, and match context.
- src/renderer/styles/app.css owns the application stylesheet.
- src/renderer/inventory-editor.js owns structured cargo and drone editing.
- src/main/preload.js defines the renderer-to-main contract.
- src/main/main.js bootstraps Electron and composes main-process services.
- src/main/oauth-service.js owns PKCE transactions, callback validation, character verification, and authorization persistence.
- src/main/ipc-guard.js owns trusted-sender checks, restore blocking, bounded payload validation, and guarded handler registration.
- src/main/credential-service.js owns current-format safeStorage encryption and credential validation.
- src/main/database/credential-repository.js exclusively owns dedicated credential-table persistence.
- src/main/ipc contains feature registrars for authenticated IPC channels.
- src/main/database.js is the stable facade for local persistence.
- src/main/database/facade.js composes persistence without owning SQL or Electron lifecycle details.
- src/main/database/schema.js owns only current schema-v6 creation and validation;
  schema-contract-v6.js declares its structural contract.
- src/main/database/lifecycle-service.js and backup-service.js own strict
  schema-v6 connection and backup lifecycles.
- src/main/database contains focused character/settings, inventory-baseline, run-write,
  run-query, fit, statistics, CSV, and CSV-validation repositories.
- src/main/database/statistics-report-repository.js owns typed Run Performance and
  Item Drops aggregation; src/shared/statistics-report.js owns the allowlisted contract.
- src/shared/fit-identity.js defines canonical fit equivalence from hulls, modules, drones, and implants.
- src/main/esi.js and src/main/janice.js are validated external-service clients.
- src/main/http-client.js provides bounded HTTP, retries, and rate-limit waits.
- src/shared contains deterministic logic usable by both Node tests and the
  renderer.

## Startup

1. Electron registers the private renderer protocol and the OAuth callback
   protocol before the application becomes ready.
2. The main process acquires the single-instance lock.
3. Diagnostics and the SQLite connection are initialized.
4. The database identity and exact schema-v6 contract are validated before the window opens.
5. The BrowserWindow is created with sandboxing, context isolation, and Node
   integration disabled.
6. The renderer loads settings, characters, secure-storage status, backup
   status, diagnostics status, and loadout presets concurrently.
7. The selected character is restored, followed by its active run checkpoint or
   most recent survived inventory baseline.
8. ESI polling starts only if that character granted the tracking capability.

## Run state machine

The renderer has five visible states:

    awaiting
        -> in-abyss
        -> awaiting-cargo -> appraisal -> awaiting
        -> died -----------------------> awaiting

Only in-abyss, awaiting-cargo, and died are persisted recovery states.
Appraisal results are deliberately not checkpointed; after a restart the user
returns to awaiting-cargo and re-appraises against current prices.

### Starting

A run can start manually or after the transition tracker confirms consecutive
Abyssal observations. The run captures:

- character, timestamp, tier, weather, system, hull type, notes, and tags;
- pre-run cargo and drone snapshots;
- optional fitting and implant snapshots when authorized.

The initial checkpoint is written immediately. Inventory edits schedule a
serialized, debounced checkpoint.

### Automatic transitions

The renderer polls location and ship concurrently. The shared transition
tracker filters transient ESI observations:

- consecutive inside observations confirm entry;
- consecutive outside observations confirm exit;
- capsule evidence during exit selects the Died outcome.

Each polling loop carries a generation and character ID. Results from a stopped
loop or previously selected character must not update current state.

### Survived appraisal

Cargo and optional drone snapshots are parsed and diffed. Gained items are
appraised at Janice buy prices, while consumed items are appraised at Janice
sell prices. Net ISK is loot value minus replacement cost. Canonical item rows are retained with zero prices when Janice cannot resolve them, which keeps item-name history search complete.

When saved, the post-run cargo and drone state becomes the next pre-run
inventory baseline. An explicit clear marker prevents an older survived run
from repopulating a baseline the user cleared.

### Death appraisal

If killmail access is authorized, the renderer asks ESI for ship and pod losses
within the run window. A verified killmail inventory replaces the estimated
fitting, implant, cargo, and drone loss.

If no killmail is available, the renderer appraises the pre-run inventory plus
captured fitting and implants. Users can retry because killmails may be delayed.

All asynchronous run operations must check the same lifecycle conditions after
every await:

- the active run is still the captured run object;
- the run is not finalizing;
- the run is not suspended for a character switch;
- appraisal work still has the current generation, where applicable.

### Finalization

Saving marks the run as finalizing before any awaited work. The renderer builds
the validated persistence payload and invokes runs:complete-active.

The database completes the operation in one transaction:

1. find an already-completed run with the same character and start timestamp;
2. insert run metadata, immutable exact-fit data, inventory snapshots, and the
   initial current appraisal when it does not exist;
3. clear the active run checkpoint;
4. return the completed run ID.

This makes a repeated completion request idempotent within the current storage
model.

## History and statistics

History owns one canonical filter object. Its global free-text search covers run metadata,
tags, and gained, consumed, or lost item names. Statistics rows drill through by adding
exact tier, weather, hull/class, or canonical-fit filters while preserving the selected
statistics date range. Active drill-through filters are shown as removable context, and
every asynchronous render is guarded by a request generation.

CSV export receives the same canonical filters as the visible History query. The main
process labels the save dialog and result as filtered history or all history and reports
the exported row count. The only accepted interchange shape is the explicitly versioned
1.2 history CSV. Each row carries the stable run UID plus JSON-encoded exact-fit,
inventory-snapshot, appraisal-history, tag, and killmail records. A duplicate UID is
skipped instead of cloned under a second local identity.

The Statistics overview retains its tiles, latest session, and activity chart. One
typed report builder replaces the fixed tier, weather, hull, and fit tables. Run
Performance reports aggregate current run results. Item Drops reports calculate
positive quantity changes from complete before/after cargo snapshots, so drop rates
do not depend on Janice values or appraisal dates. Report dimensions and metrics are
strictly allowlisted, with at most two user-selected breakdowns; Item is implicit for
unfiltered Item Drops reports.

Fit report rows reference persisted canonical fit identities. Equivalence is calculated
only from the captured hull, modules, drones, and implants. A user-defined display name
belongs to that identity, is exposed separately from captured snapshots, and never
participates in equivalence.

## Persistence

SQLite runs in WAL mode with foreign keys and secure deletion enabled.

- characters stores public EVE character identity.
- settings stores public preferences only.
- credentials stores current format-1 safeStorage ciphertext for OAuth tokens and the Janice key.
- runs stores stable `run_uid` values and run metadata, including canonical
  `hull_name`; it references an optional exact fit snapshot.
- fit_identities stores canonical equivalence and optional user display names.
- fit_snapshots plus fit_snapshot_items and fit_snapshot_implants store globally
  deduplicated exact historical configurations without prices or aliases.
- inventory_snapshots preserves exact raw text, capture/parse metadata, and
  normalized inventory_snapshot_items.
- appraisals and appraisal_lines preserve every pricing result. Exactly one
  appraisal per run is current; statistics and renderer summaries read through it.
- run_tags and run_killmails store searchable tags and verified loss provenance.
- active_run_state stores one versioned recovery snapshot per character.

Recovery snapshots use version 2 and canonical `hull_name`. Runtime payloads and
the 1.2 CSV require `hull_name`; `ship_name` compatibility is not retained.

Schema v6 is the only accepted contract. Other schema versions, foreign application
identities, and structurally incomplete files are rejected without mutation.

## Backup and restore

Clean exit creates a verified daily full-database backup and retains seven
automatic backups. Manual backups use unique timestamps.

Restore accepts schema-v6 backups only. It stages and validates a private copy,
creates a before-restore safety backup, swaps the live database, and rolls back if
opening fails.

## Change rules

- Keep business transformations in shared, deterministic modules.
- Keep privileged operations behind explicit preload methods and validated IPC.
- Treat character switches, cancellation, and finalization as cancellation
  boundaries for every asynchronous renderer workflow.
- Preserve the database facade and preload API across internal refactors.
- Keep startup, restore, and repositories strict to the complete schema-v6 contract.
- Keep canonical fit aliases metadata-only and outside fit equivalence signatures.
- Keep PKCE and pending authorization state inside oauth-service.js.
- Keep active-run and polling transitions visible in renderer/app.js even when character presentation is delegated.
- Add a race regression test whenever a workflow performs multiple awaits while
  holding a reference to mutable renderer state.
- Prefer feature registrars and repositories over adding more responsibilities
  to main.js, database.js, or renderer/app.js.
