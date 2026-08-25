# Changelog

## 1.2.1 (24 August 2026)

- Replaced the fixed Statistics breakdown tables with a report builder.
- Added Run Performance reports with tier, weather, hull, fit, and outcome
  filters and grouping.
- Added Item Drops reports based on positive cargo quantity changes from complete
  before-and-after snapshots.
- Defined drop rate and average quantity against survived runs where any cargo
  loot was gained.
- Added presets, two-level grouping, sortable columns, and exact History
  drill-through.
- Added an implicit Item column to unfiltered Item Drops reports, leaving both
  grouping selectors available.
- Kept the item picker in the dark theme and excluded appraisal-derived net
  values from Item Drops.

## 1.2.0 (23 August 2026)

### Highlights

- Replaced run storage with normalized schema v6 and stable run UUIDs.
- Globally deduplicated exact fit snapshots while keeping fit equivalence and
  display names independent from captured history.
- Preserved immutable appraisal revisions and exposed appraisal history in Run
  Details.
- Preserved raw inventory text with normalized snapshot items and parse status.
- Replaced the earlier run CSV with the versioned 1.2 History CSV, including
  exact fits, inventory snapshots, appraisal history, tags, and killmail IDs.
- Split run querying, persistence, CSV validation, and appraisal-history rendering
  into focused modules.
- Changed backup inspection to validate disposable copies, preventing SQLite
  sidecar files beside selected backups.

### Compatibility

- Schema v6 is the only supported database and full-backup format.
- The versioned 1.2 History CSV is the only supported CSV import format.
- Schema-v5 databases, schema-v5 backups, and earlier CSV layouts are rejected
  without mutation.
- `Ship` means the hull type. Pilot-assigned ship names are not stored.

The private `1.2.0-private.1` candidate migrated and verified the production
schema-v5 data before runtime schema-v5 support was removed. It was not published.
