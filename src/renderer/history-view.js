(function initHistoryView(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssHistoryView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createHistoryViewModule() {
  function createHistoryView({
    document,
    api,
    getActiveCharacterId,
    formatIsk,
    formatDuration,
    escapeHtml,
  }) {
    if (!document || !api?.runs) {
      throw new Error('History view requires document and run APIs');
    }
    if (
      typeof getActiveCharacterId !== 'function'
      || typeof formatIsk !== 'function'
      || typeof formatDuration !== 'function'
      || typeof escapeHtml !== 'function'
    ) {
      throw new TypeError('History view formatter dependencies must be functions');
    }

    let renderGeneration = 0;
    let sortColumn = 'started_at';
    let sortDirection = 'desc';

    function dateBoundary(value, addDay = false) {
      if (!value) return undefined;
      const date = new Date(value + 'T00:00:00');
      if (Number.isNaN(date.getTime())) throw new Error('History date range is invalid');
      if (addDay) date.setDate(date.getDate() + 1);
      return Math.floor(date.getTime() / 1000);
    }

    function getFilters(characterId) {
      const dateFrom = dateBoundary(document.getElementById('historyDateFrom').value);
      const dateTo = dateBoundary(document.getElementById('historyDateTo').value, true);
      if (dateFrom != null && dateTo != null && dateTo <= dateFrom) {
        throw new Error('History end date must not be before its start date');
      }
      return {
        character_id: characterId || undefined,
        tier: document.getElementById('filterTier').value || undefined,
        weather: document.getElementById('filterWeather').value || undefined,
        outcome: document.getElementById('filterOutcome').value || undefined,
        search: document.getElementById('historySearch').value.trim() || undefined,
        date_from: dateFrom,
        date_to: dateTo,
        ship: document.getElementById('historyShip').value.trim() || undefined,
        tag: document.getElementById('historyTag').value.trim() || undefined,
      };
    }

    function sortRuns(runs) {
      return runs.sort((left, right) => {
        let leftValue = left[sortColumn];
        let rightValue = right[sortColumn];
        if (typeof leftValue === 'string') leftValue = leftValue.toLocaleLowerCase();
        if (typeof rightValue === 'string') rightValue = rightValue.toLocaleLowerCase();
        if (leftValue === rightValue) return 0;
        const comparison = leftValue > rightValue ? 1 : -1;
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    function contextHtml(run) {
      const parts = [];
      if (run.system_name) {
        parts.push('<span class="history-context-system">' + escapeHtml(run.system_name) + '</span>');
      }
      for (const tag of run.tags || []) {
        parts.push('<span class="history-tag">' + escapeHtml(tag) + '</span>');
      }
      for (const item of run.matching_items || []) {
        const label = item.type === 'gained'
          ? 'Loot'
          : item.type === 'consumed' ? 'Used' : 'Lost';
        parts.push(
          '<span class="history-match history-match-' + escapeHtml(item.type) + '">'
          + label + ': ' + escapeHtml(item.item_name) + '</span>'
        );
      }
      return parts.length ? parts.join(' ') : '<span class="history-empty-context">—</span>';
    }

    function tableHtml(runs) {
      const columns = [
        ['started_at', 'Date'],
        ['tier', 'Tier'],
        ['weather', 'Weather'],
        ['ship_name', 'Ship'],
        ['duration', 'Duration'],
        ['outcome', 'Outcome'],
        ['net_isk', 'Net ISK'],
        ['total_loss', 'Total Loss'],
        ['_context', 'Context'],
        ['_detail', ''],
      ];
      let html = '<div class="table-scroll"><table class="data-table history-table"><thead><tr>';
      for (const [key, label] of columns) {
        if (key === '_detail' || key === '_context') {
          html += '<th>' + label + '</th>';
          continue;
        }
        const className = sortColumn === key
          ? (sortDirection === 'asc' ? 'sort-asc' : 'sort-desc')
          : '';
        const ariaSort = sortColumn === key
          ? (sortDirection === 'asc' ? 'ascending' : 'descending')
          : 'none';
        html += '<th class="' + className + '" aria-sort="' + ariaSort + '">'
          + '<button class="table-sort" data-action="sort-history" data-sort-column="'
          + escapeHtml(key) + '">' + escapeHtml(label) + '</button></th>';
      }
      html += '</tr></thead><tbody>';

      for (const run of runs) {
        const date = new Date(run.started_at * 1000);
        const ship = run.ship_name || run.ship_class || '—';
        const shipContext = run.ship_name && run.ship_class
          ? '<div class="history-ship-class">' + escapeHtml(run.ship_class) + '</div>'
          : '';
        html += '<tr>'
          + '<td class="mono">' + date.toLocaleDateString() + ' '
          + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</td>'
          + '<td><span class="badge tier">' + escapeHtml(run.tier || '—') + '</span></td>'
          + '<td><span class="badge weather">' + escapeHtml(run.weather || '—') + '</span></td>'
          + '<td class="history-ship">' + escapeHtml(ship) + shipContext + '</td>'
          + '<td class="mono">' + formatDuration(run.duration) + '</td>'
          + '<td><span class="badge ' + (run.outcome === 'Survived' ? 'survived' : 'died')
          + '">' + escapeHtml(run.outcome) + '</span></td>'
          + '<td class="' + (run.outcome === 'Survived'
            ? (run.net_isk >= 0 ? 'positive' : 'negative') : '') + '">'
          + (run.outcome === 'Survived'
            ? (run.net_isk >= 0 ? '+' : '') + formatIsk(run.net_isk) : '—') + '</td>'
          + '<td class="' + (run.outcome === 'Died' ? 'negative' : 'mono') + '">'
          + (run.outcome === 'Died' ? '−' + formatIsk(run.total_loss) : '—') + '</td>'
          + '<td class="history-context">' + contextHtml(run) + '</td>'
          + '<td><button class="btn sm ghost" data-action="show-run-detail" data-run-id="'
          + escapeHtml(run.id) + '">Detail</button></td></tr>';
      }
      return html + '</tbody></table></div>';
    }

    async function render() {
      const generation = ++renderGeneration;
      const characterId = getActiveCharacterId();
      const content = document.getElementById('historyContent');
      const error = document.getElementById('historyFilterError');
      let filters;
      try {
        filters = getFilters(characterId);
      } catch (rangeError) {
        error.textContent = rangeError.message;
        error.hidden = false;
        content.innerHTML = '';
        return;
      }
      error.hidden = true;
      const runs = await api.runs.getAll(filters);
      if (generation !== renderGeneration || getActiveCharacterId() !== characterId) return;

      document.getElementById('historyResultSummary').textContent =
        runs.length + (runs.length === 1 ? ' run' : ' runs');
      if (!runs.length) {
        content.innerHTML = '<div class="empty-state">No runs match these filters</div>';
        return;
      }
      content.innerHTML = tableHtml(sortRuns(runs));
    }

    function sort(column) {
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = 'desc';
      }
      return render();
    }

    return Object.freeze({ render, sort, getFilters });
  }

  return Object.freeze({ createHistoryView });
});
