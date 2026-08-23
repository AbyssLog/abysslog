const crypto = require('node:crypto');

function createNewRunUid(randomUuid = crypto.randomUUID) {
  if (typeof randomUuid !== 'function') throw new TypeError('UUID generator is invalid');
  const value = randomUuid();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError('Generated run UUID is invalid');
  }
  return value.toLowerCase();
}

function signatureHash(signature) {
  if (typeof signature !== 'string' || !signature) {
    throw new TypeError('Snapshot signature is required');
  }
  return crypto.createHash('sha256').update(signature, 'utf8').digest('hex');
}

module.exports = {
  createNewRunUid,
  signatureHash,
};
