// Stable persistence entry point; implementation is composed in database/facade.js.

// Database initialization is owned by database/lifecycle-service.js.

// Backup integrity and naming helpers are owned by database/backup-service.js.

// Atomic database copies are owned by database/backup-service.js.

// Backup schema inspection is owned by database/backup-service.js.
// Backup path and sidecar helpers are owned by database/backup-service.js.
// Transactional restore and rollback are owned by database/backup-service.js.
// Backup listing, retention, creation, and status are owned by database/backup-service.js.
// Connection shutdown is owned by database/lifecycle-service.js.
// Sensitive-storage hardening is owned by database/character-settings-repository.js.
// Character reads and upserts are owned by database/character-settings-repository.js.
// Atomic character deletion is owned by database/character-settings-repository.js.

// ── Settings ──────────────────────────────────────────────────────────────

// Settings reads and writes are owned by database/character-settings-repository.js.

// Inventory baseline ownership is in database/inventory-baseline-repository.js.
// ── Runs ──────────────────────────────────────────────────────────────────

// Repository methods are exposed by database/facade.js.

module.exports = require('./database/facade');
