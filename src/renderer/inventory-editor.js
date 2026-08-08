(function inventoryEditorModule(root, factory) {
  const runTracking = typeof module === 'object' && module.exports
    ? require('../shared/run-tracking')
    : root?.AbyssRunTracking;
  const api = factory(runTracking);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssInventoryEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, runTracking => {
  const MAX_ITEM_QUANTITY = 1_000_000_000;
  const instances = new Map();

  if (!runTracking?.parseInventoryPaste || !runTracking?.diffInventoryPastes) {
    throw new Error('Inventory parsing is unavailable');
  }

  function formatInventoryItems(items) {
    if (!Array.isArray(items)) throw new TypeError('Inventory items must be an array');
    return items
      .filter(item => item && typeof item.name === 'string' && item.name.trim())
      .map(item => {
        const quantity = Number(item.qty);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_ITEM_QUANTITY) {
          throw new RangeError(`Inventory quantity for ${item.name} is invalid`);
        }
        return `${item.name.trim()}\t${quantity}`;
      })
      .join('\n');
  }

  function inspectInventory(raw) {
    const items = runTracking.parseInventoryPaste(raw || '');
    return {
      items,
      itemTypes: items.length,
      totalUnits: items.reduce((total, item) => total + item.qty, 0),
    };
  }

  function compareInventory(beforeRaw, afterRaw) {
    if (!(afterRaw || '').trim()) return { gained: [], consumed: [] };
    return runTracking.diffInventoryPastes(beforeRaw || '', afterRaw || '');
  }

  function resolveDroneAfterSnapshot(beforeRaw, afterRaw, outcome) {
    const before = typeof beforeRaw === 'string' ? beforeRaw : '';
    const after = typeof afterRaw === 'string' ? afterRaw : '';
    const usesFallback = outcome === 'Survived' && !after.trim() && Boolean(before.trim());
    return { text: usesFallback ? before : after, usesFallback };
  }

  function createElement(tagName, className, textContent = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
  }

  function resolveTextarea(target) {
    if (typeof target === 'string') return document.getElementById(target);
    return target;
  }

  function setStatus(instance, message = '', type = '') {
    instance.status.textContent = message;
    instance.status.className = `inventory-editor-status${type ? ` ${type}` : ''}`;
    instance.status.hidden = !message;
  }

  function updateSummary(instance, items) {
    const totalUnits = items.reduce((total, item) => total + item.qty, 0);
    if (items.length === 0) {
      instance.summary.textContent = 'No items';
      return;
    }
    const typeLabel = items.length === 1 ? 'item type' : 'item types';
    const unitLabel = totalUnits === 1 ? 'unit' : 'units';
    instance.summary.textContent = `${items.length} ${typeLabel} · ${totalUnits.toLocaleString()} ${unitLabel}`;
  }

  function readComparison(instance) {
    if (!instance.compareWith || !instance.textarea.value.trim()) return null;
    const comparison = instances.get(instance.compareWith);
    const comparisonTextarea = comparison?.textarea || document.getElementById(instance.compareWith);
    if (!comparisonTextarea) return null;
    try {
      return {
        beforeText: comparisonTextarea.value,
        quantities: new Map(
          runTracking.parseInventoryPaste(comparisonTextarea.value || '')
            .map(item => [item.name, item.qty])
        ),
      };
    } catch {
      return null;
    }
  }

  function createDeltaBadge(item, comparison) {
    if (!comparison) return null;
    const delta = item.qty - (comparison.quantities.get(item.name) || 0);
    if (delta === 0) return null;
    const badge = createElement(
      'span',
      `inventory-item-delta ${delta > 0 ? 'gained' : 'consumed'}`,
      `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}`
    );
    badge.title = delta > 0 ? 'Quantity gained' : 'Quantity consumed';
    return badge;
  }

  function createItemRow(instance, item, index, comparison) {
    const row = createElement('div', 'inventory-item-row');
    row.dataset.inventoryIndex = String(index);
    row.setAttribute('role', 'listitem');

    const marker = createElement('span', 'inventory-item-marker');
    marker.setAttribute('aria-hidden', 'true');

    const name = createElement('input', 'inventory-item-name');
    name.type = 'text';
    name.value = item.name;
    name.maxLength = 256;
    name.readOnly = instance.readOnly;
    name.dataset.inventoryField = 'name';
    name.setAttribute('aria-label', `Item ${index + 1} name`);

    const quantityWrap = createElement('label', 'inventory-item-quantity');
    quantityWrap.append(createElement('span', '', 'Qty'));
    const quantity = createElement('input');
    quantity.type = 'number';
    quantity.min = '1';
    quantity.max = String(MAX_ITEM_QUANTITY);
    quantity.step = '1';
    quantity.value = String(item.qty);
    quantity.readOnly = instance.readOnly;
    quantity.dataset.inventoryField = 'quantity';
    quantity.setAttribute('aria-label', `${item.name} quantity`);
    quantityWrap.append(quantity);

    row.append(marker, name, quantityWrap);
    const deltaBadge = createDeltaBadge(item, comparison);
    if (deltaBadge) row.append(deltaBadge);

    if (!instance.readOnly) {
      const remove = createElement('button', 'inventory-item-remove', '×');
      remove.type = 'button';
      remove.dataset.inventoryCommand = 'remove';
      remove.setAttribute('aria-label', `Remove ${item.name}`);
      row.append(remove);
    }
    return row;
  }

  function renderDiffSummary(instance, comparison) {
    instance.diff.replaceChildren();
    instance.diff.hidden = true;
    if (!comparison) return;

    const changes = compareInventory(comparison.beforeText, instance.textarea.value);
    if (!changes.gained.length && !changes.consumed.length) return;

    if (changes.gained.length) {
      instance.diff.append(createElement(
        'span',
        'inventory-diff-pill gained',
        `+ ${changes.gained.length} gained`
      ));
    }
    if (changes.consumed.length) {
      instance.diff.append(createElement(
        'span',
        'inventory-diff-pill consumed',
        `− ${changes.consumed.length} consumed`
      ));
    }
    instance.diff.hidden = false;
  }

  function render(instance) {
    let snapshot;
    try {
      snapshot = inspectInventory(instance.textarea.value);
    } catch (error) {
      const rawView = instance.root.dataset.inventoryView === 'raw';
      instance.list.replaceChildren();
      instance.list.hidden = true;
      instance.empty.hidden = rawView;
      instance.raw.hidden = !rawView;
      instance.textarea.hidden = !rawView;
      instance.toggleRaw.textContent = rawView ? 'Show items' : 'View raw';
      instance.diff.replaceChildren();
      instance.diff.hidden = true;
      instance.summary.textContent = 'Could not parse items';
      setStatus(instance, error?.message || 'The inventory text could not be parsed.', 'error');
      return;
    }

    const comparison = readComparison(instance);
    instance.list.replaceChildren(
      ...snapshot.items.map((item, index) => createItemRow(instance, item, index, comparison))
    );
    updateSummary(instance, snapshot.items);
    renderDiffSummary(instance, comparison);

    const hasItems = snapshot.items.length > 0;
    const rawView = instance.root.dataset.inventoryView === 'raw';
    instance.list.hidden = !hasItems || rawView;
    instance.empty.hidden = hasItems || rawView;
    instance.raw.hidden = !rawView;
    instance.textarea.hidden = !rawView;
    instance.toggleRaw.textContent = rawView ? 'Show items' : 'View raw';

    if (instance.textarea.value.trim() && !hasItems) {
      setStatus(instance, 'No recognizable items found. Check the raw text and try again.', 'warning');
    } else if (instance.status.dataset.transient !== 'true') {
      setStatus(instance);
    }
  }

  function refreshDependents(sourceId) {
    for (const instance of instances.values()) {
      if (instance.compareWith === sourceId) render(instance);
    }
  }

  function dispatchInventoryInput(instance) {
    instance.internalUpdate = true;
    instance.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    instance.internalUpdate = false;
    refreshDependents(instance.textarea.id);
  }

  function quantityFromInput(input) {
    const quantity = Number(input?.value);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return 1;
    return Math.min(quantity, MAX_ITEM_QUANTITY);
  }

  function readRows(instance) {
    return [...instance.list.querySelectorAll('.inventory-item-row')]
      .map(row => ({
        name: row.querySelector('[data-inventory-field="name"]')?.value.trim() || '',
        qty: quantityFromInput(row.querySelector('[data-inventory-field="quantity"]')),
      }))
      .filter(item => item.name);
  }

  function writeRows(instance) {
    instance.status.dataset.transient = 'false';
    const items = readRows(instance);
    instance.textarea.value = formatInventoryItems(items);
    updateSummary(instance, items);
    dispatchInventoryInput(instance);
  }

  function appendBlankRow(instance) {
    const existing = readRows(instance);
    const row = createItemRow(instance, { name: '', qty: 1 }, existing.length, null);
    instance.empty.hidden = true;
    instance.list.hidden = false;
    instance.list.append(row);
    row.querySelector('[data-inventory-field="name"]')?.focus();
  }

  function showPastePrompt(instance) {
    instance.root.focus();
    instance.status.dataset.transient = 'true';
    setStatus(instance, 'Press Ctrl+V to paste the inventory currently on your clipboard.', 'info');
  }

  async function pasteFromClipboard(instance) {
    try {
      if (!navigator.clipboard?.readText) {
        showPastePrompt(instance);
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        instance.root.focus();
        instance.status.dataset.transient = 'true';
        setStatus(instance, 'Clipboard is empty or does not contain plain text.', 'info');
        return;
      }
      setValue(instance.textarea, text, { emit: true, announce: true });
    } catch {
      showPastePrompt(instance);
    }
  }

  function handleCommand(instance, command) {
    if (command === 'paste') {
      void pasteFromClipboard(instance);
    } else if (command === 'add') {
      appendBlankRow(instance);
    } else if (command === 'clear') {
      setValue(instance.textarea, '', { emit: true });
      instance.root.focus();
    } else if (command === 'raw') {
      const rawView = instance.root.dataset.inventoryView === 'raw';
      instance.root.dataset.inventoryView = rawView ? 'items' : 'raw';
      render(instance);
      if (!rawView) instance.textarea.focus();
    } else if (command === 'remove') {
      return false;
    }
    return true;
  }

  function buildToolbar(instance) {
    const toolbar = createElement('div', 'inventory-editor-toolbar');
    instance.summary = createElement('div', 'inventory-editor-summary', 'No items');
    toolbar.append(instance.summary);

    const actions = createElement('div', 'inventory-editor-actions');
    if (!instance.readOnly) {
      const paste = createElement('button', 'inventory-editor-button primary', 'Paste Clipboard');
      paste.type = 'button';
      paste.dataset.inventoryCommand = 'paste';
      const add = createElement('button', 'inventory-editor-button', '+ Add item');
      add.type = 'button';
      add.dataset.inventoryCommand = 'add';
      const clear = createElement('button', 'inventory-editor-button', 'Clear');
      clear.type = 'button';
      clear.dataset.inventoryCommand = 'clear';
      actions.append(paste, add, clear);
    }
    instance.toggleRaw = createElement('button', 'inventory-editor-button', 'View raw');
    instance.toggleRaw.type = 'button';
    instance.toggleRaw.dataset.inventoryCommand = 'raw';
    actions.append(instance.toggleRaw);
    toolbar.append(actions);
    return toolbar;
  }

  function initializeOne(textarea) {
    if (!textarea?.id) return null;
    const existing = instances.get(textarea.id);
    if (existing?.textarea === textarea) return existing;
    if (existing) instances.delete(textarea.id);

    const originalParent = textarea.parentNode;
    const instance = {
      textarea,
      compareWith: textarea.dataset.inventoryCompare || '',
      readOnly: textarea.readOnly,
      internalUpdate: false,
    };
    const rootElement = createElement('div', 'inventory-editor');
    rootElement.dataset.inventoryFor = textarea.id;
    rootElement.dataset.inventoryView = 'items';
    rootElement.tabIndex = instance.readOnly ? -1 : 0;
    rootElement.setAttribute('role', 'group');
    rootElement.setAttribute('aria-label', textarea.getAttribute('aria-label') || textarea.labels?.[0]?.textContent?.trim() || 'Inventory contents');
    instance.root = rootElement;

    const toolbar = buildToolbar(instance);
    instance.list = createElement('div', 'inventory-item-list');
    instance.list.setAttribute('role', 'list');
    instance.empty = createElement('div', 'inventory-editor-empty');
    const emptyTitle = createElement('div', 'inventory-editor-empty-title', 'Paste an EVE inventory list');
    const emptyHelp = createElement(
      'div',
      'inventory-editor-empty-help',
      instance.readOnly ? 'No inventory was recorded.' : 'Copy the cargo hold or drone bay in EVE, then paste it here.'
    );
    instance.empty.append(emptyTitle, emptyHelp);
    if (!instance.readOnly) {
      const emptyPaste = createElement('button', 'inventory-editor-drop-target', 'Paste from clipboard');
      emptyPaste.type = 'button';
      emptyPaste.dataset.inventoryCommand = 'paste';
      instance.empty.append(emptyPaste);
    }

    instance.diff = createElement('div', 'inventory-diff-summary');
    instance.diff.hidden = true;
    instance.raw = createElement('div', 'inventory-editor-raw');
    instance.raw.hidden = true;
    textarea.hidden = true;
    instance.status = createElement('div', 'inventory-editor-status');
    instance.status.id = `${textarea.id}InventoryStatus`;
    instance.status.setAttribute('role', 'status');
    instance.status.setAttribute('aria-live', 'polite');
    instance.status.hidden = true;
    rootElement.setAttribute('aria-describedby', instance.status.id);
    rootElement.append(toolbar, instance.list, instance.empty, instance.diff, instance.raw, instance.status);

    originalParent.insertBefore(rootElement, textarea);
    instance.raw.append(textarea);
    instances.set(textarea.id, instance);

    rootElement.addEventListener('click', event => {
      const control = event.target.closest('[data-inventory-command]');
      if (!control || !rootElement.contains(control)) return;
      event.preventDefault();
      const command = control.dataset.inventoryCommand;
      if (command === 'remove') {
        control.closest('.inventory-item-row')?.remove();
        writeRows(instance);
        render(instance);
        return;
      }
      handleCommand(instance, command);
    });

    rootElement.addEventListener('paste', event => {
      if (instance.readOnly || event.target.closest('input, textarea')) return;
      const text = event.clipboardData?.getData('text/plain') || '';
      if (!text.trim()) return;
      event.preventDefault();
      setValue(textarea, text, { emit: true, announce: true });
    });

    instance.list.addEventListener('input', event => {
      if (!event.target.matches('[data-inventory-field]')) return;
      writeRows(instance);
    });
    instance.list.addEventListener('change', event => {
      if (!event.target.matches('[data-inventory-field]')) return;
      writeRows(instance);
      render(instance);
    });
    textarea.addEventListener('input', () => {
      if (instance.internalUpdate) return;
      instance.status.dataset.transient = 'false';
      render(instance);
      refreshDependents(textarea.id);
    });

    render(instance);
    return instance;
  }

  function initialize(scope = document) {
    const textareas = [];
    if (scope.matches?.('textarea[data-inventory-editor]')) textareas.push(scope);
    textareas.push(...scope.querySelectorAll('textarea[data-inventory-editor]'));
    return textareas.map(initializeOne).filter(Boolean);
  }

  function setValue(target, raw, options = {}) {
    const textarea = resolveTextarea(target);
    if (!textarea) return false;
    textarea.value = typeof raw === 'string' ? raw : '';
    const instance = instances.get(textarea.id);
    if (instance) {
      instance.status.dataset.transient = options.announce ? 'true' : 'false';
      render(instance);
      if (options.announce) {
        try {
          const snapshot = inspectInventory(textarea.value);
          const label = snapshot.itemTypes === 1 ? 'item type' : 'item types';
          setStatus(instance, `Pasted ${snapshot.itemTypes} ${label}.`, 'success');
        } catch {
          // render() already exposes the parsing error and raw-text escape hatch.
        }
      }
      if (options.emit) dispatchInventoryInput(instance);
      else refreshDependents(textarea.id);
    } else if (options.emit) {
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  function refresh(target) {
    const textarea = resolveTextarea(target);
    const instance = textarea ? instances.get(textarea.id) : null;
    if (!instance) return false;
    render(instance);
    return true;
  }

  return {
    compareInventory,
    resolveDroneAfterSnapshot,
    formatInventoryItems,
    initialize,
    inspectInventory,
    refresh,
    setValue,
  };
});
