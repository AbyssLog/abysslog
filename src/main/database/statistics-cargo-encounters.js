function combineCargoRunsByEncounter(runs, request) {
  if (
    request.character_id != null
    || request.group_by.includes('hull')
    || request.group_by.includes('fit')
    || request.filters.hull_name
    || request.filters.fit_identity_id != null
  ) return runs;
  const encounters = new Map();
  for (const run of runs) {
    const encounterId = Number(run.encounter_id);
    if (!encounters.has(encounterId)) {
      encounters.set(encounterId, {
        ...run,
        before: new Map(),
        after: new Map(),
        names: new Map(),
      });
    }
    const encounter = encounters.get(encounterId);
    encounter.id = Math.max(Number(encounter.id), Number(run.id));
    for (const [key, quantity] of run.before) {
      encounter.before.set(key, (encounter.before.get(key) || 0) + quantity);
    }
    for (const [key, quantity] of run.after) {
      encounter.after.set(key, (encounter.after.get(key) || 0) + quantity);
    }
    for (const [key, name] of run.names) encounter.names.set(key, name);
  }
  return [...encounters.values()];
}

module.exports = { combineCargoRunsByEncounter };
