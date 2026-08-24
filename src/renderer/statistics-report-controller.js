(function initStatisticsReportController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./statistics-report-markup'));
  } else {
    root.AbyssStatisticsReportController = factory(root.AbyssStatisticsReportMarkup);
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createModule(markup) {
  function createStatisticsReportController({
    document,
    api,
    reporting,
    getActiveCharacterId,
    formatIsk,
    formatDuration,
    escapeHtml,
    onDrillThrough,
  }) {
    if (!document || !api?.runs || !reporting) {
      throw new Error('Statistics report controller requires document, APIs, and definitions');
    }
    for (const dependency of [
      getActiveCharacterId, formatIsk, formatDuration, escapeHtml, onDrillThrough,
    ]) {
      if (typeof dependency !== 'function') {
        throw new TypeError('Statistics report controller dependencies must be functions');
      }
    }

    let initialized = false;
    let renderGeneration = 0;
    let currentScope = {};
    let currentHistory = { filters: {}, label: null };
    let sort = { key: 'tier', direction: 'asc' };
    let lastRequest = null;
    let lastReport = null;

    const byId = id => document.getElementById(id);

    function optionHtml(value, label) {
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }

    function populateStaticControls() {
      const preset = byId('statsReportPreset');
      preset.innerHTML = reporting.PRESETS.map(entry => optionHtml(entry.id, entry.label)).join('')
        + optionHtml('custom', 'Custom report');
      byId('statsReportMode').innerHTML = Object.entries(reporting.MODES)
        .map(([value, definition]) => optionHtml(value, definition.label)).join('');
      byId('statsReportTier').innerHTML = optionHtml('', 'Any tier')
        + ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'Unknown']
          .map(value => optionHtml(value, value)).join('');
      byId('statsReportWeather').innerHTML = optionHtml('', 'Any weather')
        + ['Electrical', 'Dark', 'Exotic', 'Firestorm', 'Gamma', 'Unknown']
          .map(value => optionHtml(value, value)).join('');
      byId('statsReportOutcome').innerHTML = optionHtml('', 'Any outcome')
        + optionHtml('Survived', 'Survived') + optionHtml('Died', 'Died');
    }

    function selectedMetrics() {
      return [...document.querySelectorAll('[name="stats-report-metric"]:checked')]
        .map(input => input.value);
    }

    function renderModeControls({ groupBy = null, metrics = null } = {}) {
      const mode = byId('statsReportMode').value;
      const definition = reporting.MODES[mode];
      const previousGroups = groupBy || [
        byId('statsReportGroupPrimary')?.value || '',
        byId('statsReportGroupSecondary')?.value || '',
      ];
      const groupOptions = optionHtml('', 'None') + definition.dimensions
        .map(dimension => optionHtml(dimension, reporting.DIMENSIONS[dimension].label)).join('');
      for (const [index, id] of ['statsReportGroupPrimary', 'statsReportGroupSecondary'].entries()) {
        const select = byId(id);
        select.innerHTML = groupOptions;
        select.value = definition.dimensions.includes(previousGroups[index])
          ? previousGroups[index]
          : '';
      }
      const selected = new Set(metrics || selectedMetrics());
      byId('statsReportMetrics').innerHTML = definition.metrics.map(metric => {
        const checked = selected.has(metric) ? ' checked' : '';
        return `<label class="stats-report-metric"><input type="checkbox" `
          + `name="stats-report-metric" value="${escapeHtml(metric)}" `
          + `data-change-action="stats-report-definition"${checked}> `
          + `${escapeHtml(reporting.METRICS[metric].label)}</label>`;
      }).join('');
      byId('statsReportOutcomeField').hidden = mode !== 'runs';
      byId('statsReportItemField').hidden = mode !== 'drops';
    }

    function clearFilters() {
      for (const id of [
        'statsReportTier', 'statsReportWeather', 'statsReportOutcome',
        'statsReportHull', 'statsReportFit', 'statsReportItem',
      ]) {
        if (byId(id)) byId(id).value = '';
      }
    }

    function applyPreset(presetId, { clear = false } = {}) {
      const preset = reporting.PRESETS.find(entry => entry.id === presetId)
        || reporting.PRESETS[0];
      if (clear) clearFilters();
      byId('statsReportPreset').value = preset.id;
      byId('statsReportMode').value = preset.mode;
      sort = { ...preset.sort };
      renderModeControls({ groupBy: preset.group_by, metrics: preset.metrics });
    }

    function initialize() {
      if (initialized) return;
      byId('statsReportMount').innerHTML = markup.builderHtml();
      populateStaticControls();
      applyPreset(reporting.PRESETS[0].id);
      initialized = true;
    }

    function preserveSelect(select, html) {
      const value = select.value;
      select.innerHTML = html;
      if ([...select.options].some(option => option.value === value)) select.value = value;
    }

    async function loadOptions(scope, generation) {
      const options = await api.runs.getStatisticsReportOptions(scope);
      if (generation !== renderGeneration) return;
      preserveSelect(
        byId('statsReportHull'),
        optionHtml('', 'Any hull') + options.hulls.map(hull =>
          optionHtml(hull.hull_name, hull.label)
        ).join('')
      );
      preserveSelect(
        byId('statsReportFit'),
        optionHtml('', 'Any fit') + options.fits.map(fit =>
          optionHtml(fit.fit_identity_id, fit.label)
        ).join('')
      );
      byId('statsReportItemOptions').innerHTML = options.items
        .map(item => optionHtml(item, item)).join('');
      byId('statsReportOptionNote').textContent = options.truncated
        ? 'Some filter options are omitted; type an exact item name if needed.'
        : '';
    }

    function buildFilters(mode) {
      const filters = {};
      const values = {
        tier: byId('statsReportTier').value,
        weather: byId('statsReportWeather').value,
        hull_name: byId('statsReportHull').value,
        fit_identity_id: byId('statsReportFit').value,
        outcome: mode === 'runs' ? byId('statsReportOutcome').value : '',
        item_name: mode === 'drops' ? byId('statsReportItem').value.trim() : '',
      };
      for (const [key, value] of Object.entries(values)) {
        if (value !== '') filters[key] = key === 'fit_identity_id' ? Number(value) : value;
      }
      return filters;
    }

    function buildRequest() {
      const mode = byId('statsReportMode').value;
      const groupBy = [
        byId('statsReportGroupPrimary').value,
        byId('statsReportGroupSecondary').value,
      ].filter(Boolean);
      const metrics = selectedMetrics();
      const filters = buildFilters(mode);
      const sortableDimensions = mode === 'drops' && !filters.item_name
        ? ['item', ...groupBy]
        : groupBy;
      if (![...sortableDimensions, ...metrics].includes(sort.key)) {
        sort = { key: metrics[0] || groupBy[0], direction: 'desc' };
      }
      return reporting.validateReportRequest({
        version: reporting.REPORT_VERSION,
        mode,
        ...currentScope,
        filters,
        group_by: groupBy,
        metrics,
        sort,
      });
    }

    function formatMetric(metric, value) {
      if (value == null) return '—';
      const format = reporting.METRICS[metric].format;
      if (format === 'integer') return Math.round(value).toLocaleString();
      if (format === 'percent') return `${Number(value).toFixed(1).replace(/\.0$/, '')}%`;
      if (format === 'duration') return formatDuration(Math.round(value));
      if (format === 'isk') return formatIsk(Number(value));
      return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function dimensionLabel(dimension, value) {
      if (value && typeof value === 'object') return value.label;
      return String(value ?? '—');
    }

    function dimensionHtml(dimension, value) {
      if (dimension === 'tier') {
        return `<span class="badge tier">${escapeHtml(dimensionLabel(dimension, value))}</span>`;
      }
      if (dimension === 'weather') {
        return `<span class="badge weather">${escapeHtml(dimensionLabel(dimension, value))}</span>`;
      }
      if (dimension === 'fit' && value?.representative_run_id) {
        const setup = `<button type="button" class="analytics-fit-link" data-action="show-ship-setup" `
          + `data-run-id="${escapeHtml(value.representative_run_id)}" data-return-modal="none">`
          + `${escapeHtml(value.label)}</button>`;
        const naming = value.fit_identity_id == null ? ''
          : ` <button type="button" class="stats-fit-name-button" data-action="edit-fit-name" `
            + `data-fit-identity-id="${escapeHtml(value.fit_identity_id)}" `
            + `data-fit-display-name="${escapeHtml(value.display_name || '')}" `
            + `data-fit-hull-name="${escapeHtml(value.hull_name)}">`
            + `${value.display_name ? 'Rename' : 'Name fit'}</button>`;
        return setup + naming;
      }
      if (dimension === 'hull' && value) {
        return `${escapeHtml(value.hull_name)} <span class="stats-group-detail">`
          + `(${escapeHtml(value.ship_class)})</span>`;
      }
      return escapeHtml(dimensionLabel(dimension, value));
    }

    function sortHeader(key, label) {
      const active = sort.key === key;
      const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
      const className = reporting.METRICS[key] ? ' class="stat-number"' : '';
      return `<th${className} aria-sort="${ariaSort}"><button type="button" class="table-sort" `
        + `data-action="stats-report-sort" data-report-sort-key="${escapeHtml(key)}">`
        + `${escapeHtml(label)}</button></th>`;
    }

    function renderTable(report) {
      if (!report.rows.length) return '<div class="empty-state">No report rows match these filters</div>';
      let html = '<div class="table-scroll"><table class="data-table analytics-table stats-report-table">'
        + '<thead><tr>';
      for (const dimension of report.group_by) {
        html += sortHeader(dimension, reporting.DIMENSIONS[dimension].label);
      }
      for (const metric of report.metrics) {
        html += sortHeader(metric, reporting.METRICS[metric].label);
      }
      html += '<th><span class="sr-only">Actions</span></th></tr></thead><tbody>';
      for (const [rowIndex, row] of report.rows.entries()) {
        html += '<tr>';
        for (const dimension of report.group_by) {
          html += `<td>${dimensionHtml(dimension, row.dimensions[dimension])}</td>`;
        }
        for (const metric of report.metrics) {
          const value = row.values[metric];
          const numericClass = reporting.METRICS[metric].format === 'isk'
            ? (Number(value) >= 0 ? ' positive' : ' negative') : '';
          html += `<td class="stat-number${numericClass}">${escapeHtml(formatMetric(metric, value))}</td>`;
        }
        html += `<td><button type="button" class="btn sm ghost" `
          + `data-action="stats-report-drill-through" data-report-row="${rowIndex}">View runs</button></td>`;
        html += '</tr>';
      }
      return `${html}</tbody></table></div>`;
    }

    function setError(message = '') {
      const element = byId('statsReportError');
      element.hidden = !message;
      element.textContent = message;
    }

    async function run() {
      const generation = ++renderGeneration;
      const characterId = getActiveCharacterId();
      setError();
      byId('statsReportResults').innerHTML = '<div class="empty-state">Building report…</div>';
      let request;
      try {
        request = buildRequest();
      } catch (error) {
        setError(error.message);
        byId('statsReportResults').innerHTML = '';
        return;
      }
      try {
        const report = await api.runs.getStatisticsReport(request);
        if (generation !== renderGeneration || getActiveCharacterId() !== characterId) return;
        lastRequest = request;
        lastReport = report;
        byId('statsReportSummary').textContent = `${report.rows.length.toLocaleString()} report row`
          + `${report.rows.length === 1 ? '' : 's'}`
          + (report.mode === 'drops'
            ? ' · Drop rates use survived runs where any cargo loot was gained'
            : '')
          + (report.truncated ? ' · Results truncated' : '');
        byId('statsReportResults').innerHTML = renderTable(report);
      } catch (error) {
        if (generation !== renderGeneration) return;
        setError(error.message || 'Could not build the report');
        byId('statsReportResults').innerHTML = '';
      }
    }

    async function render({ scope, history }) {
      initialize();
      byId('statsReportSection').hidden = false;
      currentScope = { ...scope };
      currentHistory = history || { filters: {}, label: null };
      const generation = ++renderGeneration;
      try {
        await loadOptions(currentScope, generation);
        if (generation !== renderGeneration) return;
      } catch (error) {
        if (generation === renderGeneration) setError(error.message || 'Could not load report options');
        return;
      }
      return run();
    }

    function hide() {
      renderGeneration++;
      const section = byId('statsReportSection');
      if (section) section.hidden = true;
    }

    function handlePreset(presetId) {
      if (presetId === 'custom') return undefined;
      applyPreset(presetId, { clear: false });
      return run();
    }

    function handleMode(mode) {
      const preset = reporting.PRESETS.find(entry => entry.mode === mode);
      applyPreset(preset?.id || reporting.PRESETS[0].id, { clear: false });
      return run();
    }

    function handleDefinitionChange(element = null) {
      byId('statsReportPreset').value = 'custom';
    }

    function reset() {
      applyPreset(reporting.PRESETS[0].id, { clear: true });
      return run();
    }

    function sortReport(element) {
      const key = element.dataset.reportSortKey;
      if (sort.key === key) sort.direction = sort.direction === 'asc' ? 'desc' : 'asc';
      else sort = { key, direction: 'desc' };
      return run();
    }

    function addDimensionFilter(filters, labels, dimension, value) {
      if (dimension === 'tier') filters.tier = value;
      if (dimension === 'weather') filters.weather = value;
      if (dimension === 'outcome') filters.outcome = value;
      if (dimension === 'hull') {
        filters.hull_name = value.hull_name;
        filters.ship_class = value.ship_class;
      }
      if (dimension === 'fit' && value.fit_identity_id != null) {
        filters.fit_identity_id = value.fit_identity_id;
      }
      if (dimension === 'item') filters.drop_item_name = value;
      labels.push(`${reporting.DIMENSIONS[dimension].label}: ${dimensionLabel(dimension, value)}`);
    }

    function filterLabel(key, value) {
      if (key === 'tier') return `Tier: ${value}`;
      if (key === 'weather') return `Weather: ${value}`;
      if (key === 'outcome') return `Outcome: ${value}`;
      if (key === 'hull_name') return `Hull: ${value}`;
      if (key === 'item_name') return `Drop: ${value}`;
      if (key === 'fit_identity_id') {
        return `Fit: ${byId('statsReportFit').selectedOptions[0]?.textContent || value}`;
      }
      return `${key}: ${value}`;
    }

    function openHistory(element) {
      if (!lastRequest || !lastReport) return undefined;
      const row = lastReport.rows[Number(element.dataset.reportRow)];
      if (!row) return undefined;
      const filters = { ...currentHistory.filters };
      const labels = currentHistory.label ? [currentHistory.label] : [];
      for (const [key, value] of Object.entries(lastRequest.filters)) {
        if (key === 'item_name') filters.drop_item_name = value;
        else filters[key] = value;
        labels.push(filterLabel(key, value));
      }
      for (const dimension of lastReport.group_by) {
        addDimensionFilter(filters, labels, dimension, row.dimensions[dimension]);
      }
      return onDrillThrough({ filters, labels: [...new Set(labels)] });
    }

    return Object.freeze({
      handleDefinitionChange,
      handleMode,
      handlePreset,
      hide,
      openHistory,
      render,
      reset,
      run,
      sort: sortReport,
    });
  }

  return Object.freeze({ createStatisticsReportController });
});
