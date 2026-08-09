(function exposeShipGroups(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssShipGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const FRIGATE_GROUPS = new Set([25, 324, 830, 831, 834, 893, 1022, 1283, 1527]);
  const DESTROYER_GROUPS = new Set([420, 541, 1305, 1534]);
  const CRUISER_GROUPS = new Set([26, 358, 832, 833, 894, 906, 1972]);

  function classifyShipByGroup(groupId) {
    if (!Number.isSafeInteger(groupId)) return 'Unknown';
    if (FRIGATE_GROUPS.has(groupId)) return 'Frigate';
    if (DESTROYER_GROUPS.has(groupId)) return 'Destroyer';
    if (CRUISER_GROUPS.has(groupId)) return 'Cruiser';
    return 'Unknown';
  }

  return { classifyShipByGroup };
});
