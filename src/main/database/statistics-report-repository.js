const MAX_REPORT_ROWS = 500;
const MAX_OPTION_ROWS = 500;
const { combineCargoRunsByEncounter } = require('./statistics-cargo-encounters');

function createStatisticsReportRepository(getConnection) {
  if (typeof getConnection !== 'function') {
    throw new TypeError('Statistics report repository requires a connection provider');
  }

  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function buildWhere(request, { survivedOnly = false } = {}) {
    const clauses = [];
    const params = [];
    const add = (clause, value) => {
      clauses.push(clause);
      params.push(value);
    };
    if (request.character_id != null) add('r.character_id = ?', request.character_id);
    if (request.range_start != null) add('r.started_at >= ?', request.range_start);
    if (request.range_end != null) add('r.started_at < ?', request.range_end);
    if (request.filters?.tier) add('r.tier = ?', request.filters.tier);
    if (request.filters?.weather) add('r.weather = ?', request.filters.weather);
    if (request.filters?.hull_name) {
      add('r.hull_name = ? COLLATE NOCASE', request.filters.hull_name);
    }
    if (request.filters?.fit_identity_id != null) {
      add('fs.fit_identity_id = ?', request.filters.fit_identity_id);
    }
    if (survivedOnly) clauses.push("r.outcome = 'Survived'");
    else if (request.filters?.outcome) add('r.outcome = ?', request.filters.outcome);
    return {
      sql: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '',
      params,
    };
  }

  function runSelect() {
    return `
      SELECT r.id, r.encounter_id, r.tier, r.weather, r.outcome, r.duration,
        r.hull_name, r.ship_class, a.net_isk, a.total_loss,
        fs.fit_identity_id, fi.signature_hash AS fit_key,
        fi.hull_name AS fit_hull_name, fi.display_name AS fit_display_name
      FROM runs r
      JOIN appraisals a ON a.run_id = r.id AND a.is_current = 1
      LEFT JOIN fit_snapshots fs ON fs.id = r.fit_snapshot_id
      LEFT JOIN fit_identities fi ON fi.id = fs.fit_identity_id
    `;
  }

  function loadRunRows(request, options) {
    const where = buildWhere(request, options);
    return database().prepare(runSelect() + where.sql + ' ORDER BY r.id').all(...where.params);
  }

  function fitDimension(run) {
    const key = run.fit_key || 'unknown';
    const hullName = run.fit_hull_name || run.hull_name || 'Unknown ship';
    return {
      fit_identity_id: run.fit_identity_id == null ? null : Number(run.fit_identity_id),
      fit_key: key,
      hull_name: hullName,
      display_name: run.fit_display_name || null,
      label: run.fit_display_name || `${hullName} fit #${key}`,
      representative_run_id: Number(run.id),
    };
  }

  function hullDimension(run) {
    const hullName = run.hull_name || 'Unknown ship';
    const shipClass = run.ship_class || 'Unknown';
    return { hull_name: hullName, ship_class: shipClass, label: `${hullName} (${shipClass})` };
  }

  function dimensionValue(run, dimension, itemName = null) {
    if (dimension === 'tier') return run.tier || 'Unknown';
    if (dimension === 'weather') return run.weather || 'Unknown';
    if (dimension === 'outcome') return run.outcome;
    if (dimension === 'hull') return hullDimension(run);
    if (dimension === 'fit') return fitDimension(run);
    if (dimension === 'item') return itemName;
    throw new TypeError('Statistics report dimension is unsupported');
  }

  function dimensionKey(value) {
    if (value && typeof value === 'object') {
      if ('fit_identity_id' in value) return `fit:${value.fit_identity_id ?? 'unknown'}:${value.fit_key}`;
      if ('hull_name' in value) return `hull:${value.hull_name.toLocaleLowerCase()}:${value.ship_class}`;
    }
    return String(value ?? '').toLocaleLowerCase();
  }

  function dimensionsFor(run, groupBy, itemName = null) {
    return Object.fromEntries(groupBy.map(dimension => [
      dimension,
      dimensionValue(run, dimension, itemName),
    ]));
  }

  function groupKey(dimensions, groupBy) {
    return groupBy.map(dimension => dimensionKey(dimensions[dimension])).join('\u001f') || '__all__';
  }

  function createRunAggregate(dimensions) {
    return {
      dimensions,
      count: 0,
      survived: 0,
      died: 0,
      durationTotal: 0,
      durationMin: null,
      durationMax: null,
      netTotal: 0,
      deathLossTotal: 0,
      encounterIds: new Set(),
    };
  }

  function aggregateRunReport(request) {
    const groups = new Map();
    for (const run of loadRunRows(request)) {
      const dimensions = dimensionsFor(run, request.group_by);
      const key = groupKey(dimensions, request.group_by);
      if (!groups.has(key)) groups.set(key, createRunAggregate(dimensions));
      const group = groups.get(key);
      const duration = Number(run.duration) || 0;
      group.count++;
      group.encounterIds.add(Number(run.encounter_id));
      if (run.outcome === 'Survived') {
        group.survived++;
        group.netTotal += Number(run.net_isk) || 0;
      } else {
        group.died++;
        group.deathLossTotal += Number(run.total_loss) || 0;
      }
      group.durationTotal += duration;
      group.durationMin = group.durationMin == null ? duration : Math.min(group.durationMin, duration);
      group.durationMax = group.durationMax == null ? duration : Math.max(group.durationMax, duration);
      if (group.dimensions.fit) {
        group.dimensions.fit.representative_run_id = Math.max(
          group.dimensions.fit.representative_run_id,
          Number(run.id)
        );
      }
    }
    return [...groups.values()].map(group => {
      const available = {
        encounters: group.encounterIds.size,
        runs: group.count,
        survived: group.survived,
        died: group.died,
        survival_pct: group.count ? group.survived / group.count * 100 : 0,
        duration_avg: group.count ? group.durationTotal / group.count : null,
        duration_min: group.durationMin,
        duration_max: group.durationMax,
        net_avg: group.survived ? group.netTotal / group.survived : null,
        net_total: group.netTotal,
        death_loss_avg: group.died ? group.deathLossTotal / group.died : null,
        death_loss_total: group.deathLossTotal,
      };
      return {
        dimensions: group.dimensions,
        values: Object.fromEntries(request.metrics.map(metric => [metric, available[metric]])),
      };
    });
  }

  function loadObservedCargoRuns(request) {
    const where = buildWhere(request, { survivedOnly: true });
    const rows = database().prepare(`
      SELECT r.id, r.encounter_id, r.tier, r.weather, r.outcome, r.duration,
        r.hull_name, r.ship_class,
        fs.fit_identity_id, fi.signature_hash AS fit_key,
        fi.hull_name AS fit_hull_name, fi.display_name AS fit_display_name,
        snapshots.id AS snapshot_id, snapshots.phase, snapshots.parse_status,
        items.item_name, items.qty
      FROM runs r
      JOIN appraisals a ON a.run_id = r.id AND a.is_current = 1
      LEFT JOIN fit_snapshots fs ON fs.id = r.fit_snapshot_id
      LEFT JOIN fit_identities fi ON fi.id = fs.fit_identity_id
      LEFT JOIN inventory_snapshots snapshots
        ON snapshots.run_id = r.id
        AND snapshots.location = 'cargo'
        AND snapshots.phase IN ('before', 'after')
      LEFT JOIN inventory_snapshot_items items ON items.snapshot_id = snapshots.id
      ${where.sql}
      ORDER BY r.id, snapshots.id, items.id
    `).all(...where.params);
    const runs = new Map();
    for (const row of rows) {
      if (!runs.has(row.id)) {
        runs.set(row.id, {
          ...row,
          beforeObserved: false,
          afterObserved: false,
          before: new Map(),
          after: new Map(),
          names: new Map(),
        });
      }
      const run = runs.get(row.id);
      if (!row.snapshot_id || row.parse_status !== 'complete') continue;
      if (row.phase === 'before') run.beforeObserved = true;
      if (row.phase === 'after') run.afterObserved = true;
      if (!row.item_name) continue;
      const itemKey = String(row.item_name).trim().toLocaleLowerCase();
      const collection = row.phase === 'before' ? run.before : run.after;
      collection.set(itemKey, (collection.get(itemKey) || 0) + Number(row.qty || 0));
      if (row.phase === 'after' || !run.names.has(itemKey)) run.names.set(itemKey, row.item_name);
    }
    return [...runs.values()].filter(run => run.beforeObserved && run.afterObserved);
  }

  function gainsForRun(run) {
    const itemKeys = new Set([...run.before.keys(), ...run.after.keys()]);
    const gains = [];
    for (const itemKey of itemKeys) {
      const quantity = Math.max(0, (run.after.get(itemKey) || 0) - (run.before.get(itemKey) || 0));
      if (quantity > 0) gains.push({ itemKey, itemName: run.names.get(itemKey), quantity });
    }
    return gains;
  }

  function createDropAggregate(dimensions) {
    return {
      dimensions,
      observedRuns: 0,
      dropRuns: 0,
      totalQty: 0,
      minDrop: null,
      maxDrop: null,
    };
  }

  function addObservedDrop(group, quantity) {
    group.observedRuns++;
    if (quantity <= 0) return;
    group.dropRuns++;
    group.totalQty += quantity;
    group.minDrop = group.minDrop == null ? quantity : Math.min(group.minDrop, quantity);
    group.maxDrop = group.maxDrop == null ? quantity : Math.max(group.maxDrop, quantity);
  }

  function dropValues(group) {
    return {
      observed_runs: group.observedRuns,
      drop_runs: group.dropRuns,
      drop_rate: group.observedRuns ? group.dropRuns / group.observedRuns * 100 : 0,
      total_qty: group.totalQty,
      qty_per_run: group.observedRuns ? group.totalQty / group.observedRuns : 0,
      drop_min: group.minDrop,
      drop_max: group.maxDrop,
    };
  }

  function aggregateSelectedItem(request, runs) {
    const groups = new Map();
    const itemKey = request.filters.item_name.toLocaleLowerCase();
    for (const run of runs) {
      const dimensions = dimensionsFor(run, request.group_by);
      const key = groupKey(dimensions, request.group_by);
      if (!groups.has(key)) groups.set(key, createDropAggregate(dimensions));
      const quantity = Math.max(0, (run.after.get(itemKey) || 0) - (run.before.get(itemKey) || 0));
      addObservedDrop(groups.get(key), quantity);
      if (groups.get(key).dimensions.fit) {
        groups.get(key).dimensions.fit.representative_run_id = Math.max(
          groups.get(key).dimensions.fit.representative_run_id,
          Number(run.id)
        );
      }
    }
    return [...groups.values()];
  }

  function aggregateItems(request, runs) {
    const groups = new Map();
    const reportGroupBy = ['item', ...request.group_by];
    const populationGroupBy = request.group_by;
    const populations = new Map();
    for (const run of runs) {
      const dimensions = dimensionsFor(run, populationGroupBy);
      const key = groupKey(dimensions, populationGroupBy);
      populations.set(key, (populations.get(key) || 0) + 1);
      for (const gain of gainsForRun(run)) {
        const itemDimensions = dimensionsFor(run, reportGroupBy, gain.itemName);
        const itemKey = groupKey(itemDimensions, reportGroupBy);
        if (!groups.has(itemKey)) groups.set(itemKey, createDropAggregate(itemDimensions));
        const group = groups.get(itemKey);
        group.dropRuns++;
        group.totalQty += gain.quantity;
        group.minDrop = group.minDrop == null ? gain.quantity : Math.min(group.minDrop, gain.quantity);
        group.maxDrop = group.maxDrop == null ? gain.quantity : Math.max(group.maxDrop, gain.quantity);
        if (group.dimensions.fit) {
          group.dimensions.fit.representative_run_id = Math.max(
            group.dimensions.fit.representative_run_id,
            Number(run.id)
          );
        }
      }
    }
    for (const group of groups.values()) {
      const populationDimensions = Object.fromEntries(populationGroupBy.map(dimension => [
        dimension,
        group.dimensions[dimension],
      ]));
      group.observedRuns = populations.get(groupKey(populationDimensions, populationGroupBy)) || 0;
    }
    return [...groups.values()];
  }

  function aggregateDropReport(request) {
    const runs = combineCargoRunsByEncounter(loadObservedCargoRuns(request), request)
      .filter(run => gainsForRun(run).length > 0);
    const groups = request.filters.item_name
      ? aggregateSelectedItem(request, runs)
      : aggregateItems(request, runs);
    return groups.map(group => {
      const available = dropValues(group);
      return {
        dimensions: group.dimensions,
        values: Object.fromEntries(request.metrics.map(metric => [metric, available[metric]])),
      };
    });
  }

  function comparableDimension(value) {
    if (value && typeof value === 'object') return value.label || '';
    return String(value ?? '');
  }

  function sortRows(rows, request) {
    const { key, direction } = request.sort;
    const multiplier = direction === 'asc' ? 1 : -1;
    return rows.sort((left, right) => {
      const leftValue = key in left.values
        ? left.values[key]
        : comparableDimension(left.dimensions[key]);
      const rightValue = key in right.values
        ? right.values[key]
        : comparableDimension(right.dimensions[key]);
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      const comparison = typeof leftValue === 'string'
        ? leftValue.localeCompare(String(rightValue), undefined, { sensitivity: 'base' })
        : Number(leftValue) - Number(rightValue);
      if (comparison !== 0) return comparison * multiplier;
      return JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions));
    });
  }

  function getReport(request) {
    const rows = sortRows(
      request.mode === 'runs' ? aggregateRunReport(request) : aggregateDropReport(request),
      request
    );
    const resultGroupBy = request.mode === 'drops' && !request.filters.item_name
      ? ['item', ...request.group_by]
      : request.group_by;
    return {
      version: 1,
      mode: request.mode,
      group_by: [...resultGroupBy],
      metrics: [...request.metrics],
      population: request.mode === 'drops' ? 'survived_with_cargo_gain' : 'filtered_runs',
      truncated: rows.length > MAX_REPORT_ROWS,
      rows: rows.slice(0, MAX_REPORT_ROWS),
    };
  }

  function getOptions(scope) {
    const request = { ...scope, filters: {} };
    const runs = loadRunRows(request);
    const hulls = new Map();
    const fits = new Map();
    for (const run of runs) {
      const hull = hullDimension(run);
      hulls.set(dimensionKey(hull), hull);
      const fit = fitDimension(run);
      if (fit.fit_identity_id != null) fits.set(fit.fit_identity_id, fit);
    }
    const items = new Map();
    for (const run of loadObservedCargoRuns(request)) {
      for (const gain of gainsForRun(run)) items.set(gain.itemKey, gain.itemName);
    }
    return {
      items: [...items.values()].sort((left, right) => left.localeCompare(right)).slice(0, MAX_OPTION_ROWS),
      hulls: [...hulls.values()].sort((left, right) => left.label.localeCompare(right.label)).slice(0, MAX_OPTION_ROWS),
      fits: [...fits.values()].sort((left, right) => left.label.localeCompare(right.label)).slice(0, MAX_OPTION_ROWS),
      truncated: items.size > MAX_OPTION_ROWS || hulls.size > MAX_OPTION_ROWS || fits.size > MAX_OPTION_ROWS,
    };
  }

  return Object.freeze({ getOptions, getReport });
}

module.exports = { MAX_REPORT_ROWS, createStatisticsReportRepository };
