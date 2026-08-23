const { createExactFitSnapshot } = require('../../shared/data-model-v6');
const { createFitIdentity } = require('../../shared/fit-identity');
const { signatureHash } = require('./v6-identities');

function createFitRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Fit repository requires a connection provider');
  }

  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function ensureIdentity(fitting, implants) {
    const identity = createFitIdentity(fitting, implants);
    if (!identity) return null;
    const connection = database();
    connection.prepare(`
      INSERT INTO fit_identities
        (algorithm_version, signature, signature_hash, hull_name)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(signature) DO UPDATE SET
        signature_hash = excluded.signature_hash,
        hull_name = excluded.hull_name,
        updated_at = strftime('%s','now')
    `).run(identity.signature, identity.key, identity.hull_name);
    return connection.prepare(`
      SELECT id, signature_hash AS fit_key, hull_name, display_name
      FROM fit_identities WHERE signature = ?
    `).get(identity.signature);
  }

  function ensureSnapshot(fitting, implants, hullName = null) {
    const snapshot = createExactFitSnapshot(fitting, implants, { hullName });
    if (!snapshot) return null;
    const connection = database();
    const identity = ensureIdentity(fitting, implants);
    const inserted = connection.prepare(`
      INSERT INTO fit_snapshots
        (format_version, signature, signature_hash, fit_identity_id, hull_name)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(signature) DO NOTHING
    `).run(
      snapshot.format_version,
      snapshot.signature,
      signatureHash(snapshot.signature),
      identity?.id || null,
      snapshot.hull_name
    );
    const stored = connection.prepare(`
      SELECT fs.id, fs.fit_identity_id, fi.signature_hash AS fit_key,
        fi.display_name AS fit_display_name
      FROM fit_snapshots fs
      LEFT JOIN fit_identities fi ON fi.id = fs.fit_identity_id
      WHERE fs.signature = ?
    `).get(snapshot.signature);
    if (!stored) throw new Error('Fit snapshot could not be stored');
    if (Number(stored.fit_identity_id || 0) !== Number(identity?.id || 0)) {
      throw new Error('Equivalent exact fit snapshot maps to conflicting fit identities');
    }
    if (inserted.changes === 1) {
      const insertItem = connection.prepare(`
        INSERT INTO fit_snapshot_items
          (snapshot_id, type_id, type_name, qty, slot)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertImplant = connection.prepare(`
        INSERT INTO fit_snapshot_implants
          (snapshot_id, type_id, type_name, qty, slot)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of snapshot.fitting) {
        insertItem.run(stored.id, item.type_id, item.type_name, item.qty, item.slot);
      }
      for (const implant of snapshot.implants) {
        insertImplant.run(
          stored.id, implant.type_id, implant.type_name, implant.qty, implant.slot
        );
      }
    }
    return stored;
  }

  function getIdentity(runId) {
    return database().prepare(`
      SELECT fi.id, fi.signature, fi.signature_hash AS fit_key,
        fi.hull_name, fi.display_name
      FROM runs r
      JOIN fit_snapshots fs ON fs.id = r.fit_snapshot_id
      JOIN fit_identities fi ON fi.id = fs.fit_identity_id
      WHERE r.id = ?
    `).get(runId) || null;
  }

  function setDisplayName(fitIdentityId, displayName) {
    const normalized = displayName == null || String(displayName).trim() === ''
      ? null
      : String(displayName).trim();
    const result = database().prepare(`
      UPDATE fit_identities
      SET display_name = ?, updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(normalized, fitIdentityId);
    if (result.changes !== 1) throw new Error('Fit identity not found');
    return database().prepare(`
      SELECT id, signature_hash AS fit_key, hull_name, display_name
      FROM fit_identities WHERE id = ?
    `).get(fitIdentityId);
  }

  return Object.freeze({ ensureIdentity, ensureSnapshot, getIdentity, setDisplayName });
}

module.exports = { createFitRepository };
