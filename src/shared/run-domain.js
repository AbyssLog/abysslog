(function exposeRunDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssRunDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TIERS = Object.freeze(['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  const WEATHERS = Object.freeze(['Electrical', 'Dark', 'Exotic', 'Firestorm', 'Gamma']);
  const OUTCOMES = Object.freeze(['Survived', 'Died']);
  const SHIP_CLASSES = Object.freeze(['Frigate', 'Destroyer', 'Cruiser', 'Unknown']);

  return Object.freeze({
    OUTCOMES,
    REPORT_TIERS: Object.freeze([...TIERS, 'Unknown']),
    REPORT_WEATHERS: Object.freeze([...WEATHERS, 'Unknown']),
    SHIP_CLASSES,
    TIERS,
    WEATHERS,
  });
});
