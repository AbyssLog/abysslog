(function exposeFitting(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssFitting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DISPLAY_SECTIONS = Object.freeze([
    Object.freeze({ id: 'high', label: 'High Slots' }),
    Object.freeze({ id: 'medium', label: 'Medium Slots' }),
    Object.freeze({ id: 'low', label: 'Low Slots' }),
    Object.freeze({ id: 'rig', label: 'Rigs' }),
    Object.freeze({ id: 'subsystem', label: 'Subsystems' }),
    Object.freeze({ id: 'drone', label: 'Drone Bay' }),
    Object.freeze({ id: 'other', label: 'Other Fitted Items' }),
  ]);

  const EFT_MODULE_SECTION_ORDER = Object.freeze([
    'low',
    'medium',
    'high',
    'rig',
    'subsystem',
  ]);

  function cleanLine(value, fallback = '') {
    const line = String(value ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return line || fallback;
  }

  function normalizeQuantity(value) {
    const quantity = Number(value);
    return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
  }

  function classifySlot(slot) {
    const value = String(slot || '');
    if (value === 'hull') return 'hull';
    if (/^HiSlot\d+$/.test(value)) return 'high';
    if (/^MedSlot\d+$/.test(value)) return 'medium';
    if (/^LoSlot\d+$/.test(value)) return 'low';
    if (/^RigSlot\d+$/.test(value)) return 'rig';
    if (/^SubSystemSlot\d+$/.test(value)) return 'subsystem';
    if (value === 'DroneBay') return 'drone';
    return 'other';
  }

  function slotIndex(slot) {
    const match = String(slot || '').match(/(\d+)$/);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  }

  function groupItems(items, sectionForItem) {
    const groups = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const section = sectionForItem(item);
      const name = cleanLine(item?.type_name, `Type ${item?.type_id || 'unknown'}`);
      const identity = item?.type_id || name.toLocaleLowerCase();
      const key = `${section}:${identity}`;
      const quantity = normalizeQuantity(item?.qty);
      const index = slotIndex(item?.slot);
      const existing = groups.get(key);
      if (existing) {
        existing.qty += quantity;
        existing.firstSlot = Math.min(existing.firstSlot, index);
      } else {
        groups.set(key, {
          section,
          typeId: item?.type_id || null,
          name,
          qty: quantity,
          firstSlot: index,
        });
      }
    }
    return [...groups.values()].sort((left, right) =>
      left.firstSlot - right.firstSlot
      || left.name.localeCompare(right.name)
    );
  }

  function groupSnapshot(fitting, implants) {
    const fittingGroups = groupItems(fitting, item => classifySlot(item?.slot));
    const implantGroups = groupItems(
      (Array.isArray(implants) ? implants : []).map(item => ({
        ...item,
        qty: item?.qty ?? 1,
      })),
      () => 'implant'
    );
    const hull = fittingGroups.find(item => item.section === 'hull') || null;
    const sections = {};
    for (const definition of DISPLAY_SECTIONS) {
      sections[definition.id] = fittingGroups.filter(
        item => item.section === definition.id
      );
    }

    return {
      hull,
      sections,
      implants: implantGroups,
    };
  }

  function sumQuantities(items) {
    return items.reduce((total, item) => total + item.qty, 0);
  }

  function summarizeSnapshot(fitting, implants) {
    const grouped = groupSnapshot(fitting, implants);
    const fittedItemCount = DISPLAY_SECTIONS
      .filter(section => section.id !== 'drone')
      .reduce(
        (total, section) => total + sumQuantities(grouped.sections[section.id]),
        0
      );
    return {
      fittedItemCount,
      droneCount: sumQuantities(grouped.sections.drone),
      implantCount: sumQuantities(grouped.implants),
      unclassifiedCount: sumQuantities(grouped.sections.other),
    };
  }

  function repeatModuleLines(items) {
    const lines = [];
    for (const item of items) {
      for (let index = 0; index < item.qty; index++) lines.push(item.name);
    }
    return lines;
  }

  function quantityLines(items) {
    return items.map(item => `${item.name} x${item.qty}`);
  }

  function createRunFitName(run) {
    const parts = ['AbyssLog'];
    if (run?.tier && run.tier !== 'Unknown') parts.push(cleanLine(run.tier));
    if (run?.weather && run.weather !== 'Unknown') parts.push(cleanLine(run.weather));
    const startedAt = Number(run?.started_at);
    if (Number.isFinite(startedAt) && startedAt > 0) {
      parts.push(new Date(startedAt * 1000).toISOString().slice(0, 10));
    }
    return parts.join(' ');
  }

  function createEftExport(run) {
    const grouped = groupSnapshot(run?.fitting, run?.implants);
    const shipName = cleanLine(grouped.hull?.name || run?.ship_name);
    if (!shipName) throw new Error('The captured ship hull is unavailable');

    const moduleRacks = [];
    for (const section of EFT_MODULE_SECTION_ORDER) {
      const lines = repeatModuleLines(grouped.sections[section]);
      if (lines.length > 0) moduleRacks.push(lines.join('\n'));
    }

    const exportSections = [];
    if (moduleRacks.length > 0) exportSections.push(moduleRacks.join('\n\n'));
    const droneLines = quantityLines(grouped.sections.drone);
    if (droneLines.length > 0) exportSections.push(droneLines.join('\n'));
    const implantLines = quantityLines(grouped.implants);
    if (implantLines.length > 0) exportSections.push(implantLines.join('\n'));

    const fitName = cleanLine(createRunFitName(run), 'AbyssLog');
    const header = `[${shipName}, ${fitName}]`;
    const text = exportSections.length > 0
      ? `${header}\n\n${exportSections.join('\n\n\n')}`
      : header;

    return {
      text,
      fitName,
      omittedItemCount: sumQuantities(grouped.sections.other),
      ...summarizeSnapshot(run?.fitting, run?.implants),
    };
  }

  return Object.freeze({
    DISPLAY_SECTIONS,
    classifySlot,
    createEftExport,
    createRunFitName,
    groupSnapshot,
    summarizeSnapshot,
  });
});
