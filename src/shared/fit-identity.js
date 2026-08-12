const fitting = require('./fitting');

function fingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function itemIdentity(item) {
  const typeIdentity = item.typeId == null
    ? `name:${String(item.name || '').trim().toLocaleLowerCase()}`
    : `type:${item.typeId}`;
  return `${item.section}:${typeIdentity}:${item.qty}`;
}

function createFitIdentity(fittingItems, implants) {
  const grouped = fitting.groupSnapshot(fittingItems, implants);
  if (!grouped.hull) return null;
  const entries = [itemIdentity(grouped.hull)];
  for (const section of fitting.DISPLAY_SECTIONS) {
    for (const item of grouped.sections[section.id]) entries.push(itemIdentity(item));
  }
  for (const implant of grouped.implants) entries.push(itemIdentity(implant));
  const signature = entries.sort().join('|');
  return Object.freeze({ signature, key: fingerprint(signature) });
}

module.exports = { createFitIdentity };
