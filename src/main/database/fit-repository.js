const { createFitIdentity } = require('../../shared/fit-identity');

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
      INSERT INTO fit_identities (signature, signature_hash, hull_name)
      VALUES (?, ?, ?)
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

  function getIdentity(runId) {
    return database().prepare(`
      SELECT fi.id, fi.signature, fi.signature_hash AS fit_key,
        fi.hull_name, fi.display_name
      FROM runs r
      JOIN fit_identities fi ON fi.id = r.fit_identity_id
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

  return Object.freeze({ ensureIdentity, getIdentity, setDisplayName });
}

module.exports = { createFitRepository };
