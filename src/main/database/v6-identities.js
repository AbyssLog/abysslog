const crypto = require('node:crypto');

const MIGRATED_RUN_NAMESPACE = 'bd7f9b84-baf3-5bc7-8e90-72546a2ff147';

function uuidBytes(value) {
  const compact = String(value).replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new TypeError('UUID namespace is invalid');
  return Buffer.from(compact, 'hex');
}

function formatUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join('-');
}

function uuidV5(namespace, name) {
  const digest = crypto.createHash('sha1')
    .update(uuidBytes(namespace))
    .update(String(name), 'utf8')
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return formatUuid(digest);
}

function createMigratedRunUid(run) {
  if (
    !run
    || !Number.isSafeInteger(Number(run.id))
    || !Number.isSafeInteger(Number(run.character_id))
    || !Number.isSafeInteger(Number(run.started_at))
  ) {
    throw new TypeError('Migrated run identity is invalid');
  }
  return uuidV5(
    MIGRATED_RUN_NAMESPACE,
    `${Number(run.character_id)}:${Number(run.started_at)}:${Number(run.id)}`
  );
}

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
  MIGRATED_RUN_NAMESPACE,
  createMigratedRunUid,
  createNewRunUid,
  signatureHash,
  uuidV5,
};
