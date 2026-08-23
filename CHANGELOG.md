# Changelog

## 1.2.0 — 23 August 2026

### Highlights

- Replaced the run-storage model with normalized schema v6 and stable run UUIDs.
- Globally deduplicated exact fit snapshots while keeping canonical fit grouping
  and friendly names independent from captured history.
- Preserved immutable appraisal revisions and exposed appraisal history in Run Details.
- Preserved raw inventory text alongside normalized inventory snapshots and parse status.
- Replaced the old run CSV with the versioned 1.2 History format, including exact
  fits, inventory snapshots, appraisal history, tags, and killmail IDs.
- Split run querying, persistence, CSV validation, and appraisal-history rendering
  into focused modules.
- Changed backup inspection to validate disposable copies so selecting a backup
  cannot leave SQLite sidecar files beside it.

### Compatibility

- Schema v6 is the only supported database and full-backup format.
- The versioned 1.2 History CSV is the only supported CSV import format.
- Schema-v5 databases/backups and earlier CSV layouts are rejected without mutation.
- `Ship` continues to mean the hull type; pilot-assigned ship names are not stored.

The private `1.2.0-private.1` migration candidate was used to verify the production
migration before schema-v5 runtime support was removed. It was not a public release.
