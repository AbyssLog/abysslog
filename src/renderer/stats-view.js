(function initStatsView(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AbyssStatsView = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function createStatsViewModule() {
  function createStatsView({
    document,
    api,
    statistics,
    getActiveCharacterId,
    formatIsk,
    formatDuration,
    escapeHtml,
  }) {
    if (!document || !api?.runs || !statistics) {
      throw new Error('Stats view requires document, run APIs, and statistics helpers');
    }
    if (
      typeof getActiveCharacterId !== 'function'
      || typeof formatIsk !== 'function'
      || typeof formatDuration !== 'function'
      || typeof escapeHtml !== 'function'
    ) {
      throw new TypeError('Stats view formatter dependencies must be functions');
    }

  let statsRenderGeneration = 0;

  function handleStatsRangeChange() {
    const preset = document.getElementById('statsRangePreset').value;
    const customRange = document.getElementById('statsCustomRange');
    const from = document.getElementById('statsDateFrom');
    const to = document.getElementById('statsDateTo');
    const isCustom = preset === 'custom';
    customRange.hidden = !isCustom;
    if (isCustom && (!from.value || !to.value)) {
      const defaults = statistics.defaultCustomDates();
      from.value ||= defaults.from;
      to.value ||= defaults.to;
    }
    return renderStats();
  }

  function getSelectedStatsRange() {
    return statistics.resolveDateRange({
      preset: document.getElementById('statsRangePreset').value,
      from: document.getElementById('statsDateFrom').value,
      to: document.getElementById('statsDateTo').value,
    });
  }

  function createStatsFilters(range, characterId) {
    const filters = {};
    if (characterId) filters.character_id = characterId;
    if (range.range_start !== undefined) filters.range_start = range.range_start;
    if (range.range_end !== undefined) filters.range_end = range.range_end;
    return filters;
  }

  async function renderStats() {
    const generation = ++statsRenderGeneration;
    const characterId = getActiveCharacterId();
    const el = document.getElementById('statsContent');
    const filterError = document.getElementById('statsFilterError');
    let range;
    try {
      range = getSelectedStatsRange();
    } catch (error) {
      filterError.textContent = error instanceof Error ? error.message : 'Date range is invalid';
      filterError.hidden = false;
      el.innerHTML = '';
      return;
    }
    filterError.hidden = true;
    document.getElementById('statsRangeSummary').textContent = range.label;
    const filters = createStatsFilters(range, characterId);
    const [stats, daily] = await Promise.all([
      api.runs.getStats(filters),
      api.runs.getDailyStats(filters)
    ]);
    if (generation !== statsRenderGeneration || getActiveCharacterId() !== characterId) return;
    const o = stats.overall;

    if (!o || o.total_runs === 0) {
      const message = range.preset === 'all' ? 'No runs logged yet' : 'No runs in selected period';
      el.innerHTML = `<div class="empty-state">${message}</div>`;
      return;
    }

    const survRate = o.total_runs > 0 ? Math.round(o.survived / o.total_runs * 100) : 0;
    const chart = statistics.createChartSeries(daily, {
      start: range.start,
      end: range.end,
      firstRun: o.first_run,
      lastRun: o.last_run,
    });
    const chartTitle = chart.bucket === 'day'
      ? 'Daily Activity'
      : chart.bucket === 'week' ? 'Weekly Activity' : `${chart.bucketDays}-Day Activity`;
    const chartNote = chart.bucket === 'day'
      ? 'Daily totals; inactive days are shown as zero'
      : `${chart.bucketDays}-day totals; inactive days are included`;

    let html = `<div class="stat-grid">
      <div class="stat-card"><div class="stat-card-label">Total Runs</div><div class="stat-card-value cyan">${o.total_runs}</div></div>
      <div class="stat-card"><div class="stat-card-label">Survival Rate</div><div class="stat-card-value green">${survRate}%</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Survival Duration</div><div class="stat-card-value">${formatDuration(Math.round(o.avg_duration_survived || 0))}</div></div>
      <div class="stat-card"><div class="stat-card-label">Net / Hour</div><div class="stat-card-value ${stats.iskPerHour >= 0 ? 'gold' : 'red'}">${formatIsk(stats.iskPerHour)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Total Net</div><div class="stat-card-value ${o.total_net_isk >= 0 ? 'green' : 'red'}">${formatIsk(o.total_net_isk || 0)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Net / Run</div><div class="stat-card-value ${(o.avg_net_isk || 0) >= 0 ? 'green' : 'red'}">${formatIsk(o.avg_net_isk || 0)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Avg Death Loss</div><div class="stat-card-value red">${formatIsk(o.avg_loss || 0)}</div></div>
      <div class="stat-card"><div class="stat-card-label">Total Death Losses</div><div class="stat-card-value red">${formatIsk(o.total_loss || 0)}</div></div>
    </div>`;

    // Daily chart - always shown
    html += `<div class="section-title">${chartTitle}</div>
      <div class="stats-chart-note">${chartNote}</div>
      <div id="dailyChart" style="background:var(--panel);border:1px solid var(--border);padding:16px;margin-bottom:16px"></div>`;

    if (stats.byTier.length) {
      html += `<div class="section-title">By Tier</div>
      <table class="data-table" style="margin-bottom:16px"><thead><tr>
        <th>Tier</th><th>Runs</th><th>Survived</th><th>Died</th><th>Survival %</th><th>Avg Survival Duration</th><th>Avg Net</th>
      </tr></thead><tbody>`;
      for (const t of stats.byTier) {
        const sr = t.total_runs > 0 ? Math.round(t.survived / t.total_runs * 100) : 0;
        html += `<tr>
          <td><span class="badge tier">${escapeHtml(t.tier || '-')}</span></td>
          <td>${t.total_runs}</td>
          <td style="color:var(--green)">${t.survived}</td>
          <td style="color:var(--red)">${t.total_runs - t.survived}</td>
          <td>${sr}%</td>
          <td class="mono">${formatDuration(Math.round(t.avg_duration || 0))}</td>
          <td class="${(t.avg_net_isk || 0) >= 0 ? 'positive' : 'negative'}">${formatIsk(t.avg_net_isk || 0)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    if (stats.byWeather.length) {
      html += `<div class="section-title">By Weather</div>
      <table class="data-table"><thead><tr>
        <th>Weather</th><th>Runs</th><th>Survived</th><th>Died</th><th>Survival %</th><th>Avg Net</th>
      </tr></thead><tbody>`;
      for (const w of stats.byWeather) {
        const sr = w.total_runs > 0 ? Math.round(w.survived / w.total_runs * 100) : 0;
        html += `<tr>
          <td><span class="badge weather">${escapeHtml(w.weather || '-')}</span></td>
          <td>${w.total_runs}</td>
          <td style="color:var(--green)">${w.survived}</td>
          <td style="color:var(--red)">${w.total_runs - w.survived}</td>
          <td>${sr}%</td>
          <td class="${(w.avg_net_isk || 0) >= 0 ? 'positive' : 'negative'}">${formatIsk(w.avg_net_isk || 0)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    el.innerHTML = html;

    // Render chart after DOM is set
    renderDailyChart(chart.rows, chart.bucket, chart.bucketDays);
  }

  function renderDailyChart(daily, bucket = 'day', bucketDays = 1) {
    const container = document.getElementById('dailyChart');
    if (!container) return;
    if (!daily || daily.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted);font-size:11px;letter-spacing:2px;text-transform:uppercase">No data yet</div>';
      return;
    }
    if (daily.length === 1) {
      // Pad with a zero day before so the single point renders as a bar rather than a flat line
      daily = [{ day: '', total_runs: 0, net_isk: 0, total_loss: 0, survived: 0 }, ...daily];
    }

    const W = container.clientWidth - 32;
    const H = 200;
    const PAD = { top: 10, right: 16, bottom: 36, left: 64 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    // Data ranges
    const maxRuns = Math.max(...daily.map(d => d.total_runs), 1);
    const maxIsk = Math.max(...daily.map(d => Math.abs(d.net_isk)), 1);

    const n = daily.length;
    const barW = Math.max(2, Math.floor(cw / n) - 2);

    // Build SVG
    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
      <defs>
        <linearGradient id="iskGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#66bb6a" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#66bb6a" stop-opacity="0.1"/>
        </linearGradient>
        <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ef5350" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="#ef5350" stop-opacity="0.8"/>
        </linearGradient>
      </defs>
      <g transform="translate(${PAD.left},${PAD.top})">`;

    // Y axis gridlines (ISK) - 4 lines
    for (let i = 0; i <= 4; i++) {
      const y = Math.round(ch * (1 - i / 4));
      const val = (maxIsk * i / 4);
      const label = formatIsk(val);
      svg += `<line x1="0" y1="${y}" x2="${cw}" y2="${y}" stroke="#1e2d3d" stroke-width="1"/>`;
      svg += `<text x="-6" y="${y + 4}" fill="#2a4a6a" font-size="10" text-anchor="end" font-family="Consolas,monospace">${label}</text>`;
    }

    // Zero line
    const zeroY = ch;
    svg += `<line x1="0" y1="${zeroY}" x2="${cw}" y2="${zeroY}" stroke="#2a4060" stroke-width="1"/>`;

    // ISK and loss area paths
    let iskPath = '', lossPath = '';

    daily.forEach((d, i) => {
      const x = Math.round((i + 0.5) * cw / n);
      const iskY = d.net_isk >= 0
        ? Math.round(ch - (d.net_isk / maxIsk) * ch)
        : ch;
      const lossY = d.net_isk < 0
        ? Math.round(ch - (Math.abs(d.net_isk) / maxIsk) * ch)
        : ch;

      if (i === 0) {
        iskPath = `M${x},${iskY}`;
        lossPath = `M${x},${lossY}`;
      } else {
        iskPath += ` L${x},${iskY}`;
        lossPath += ` L${x},${lossY}`;
      }
    });

    // Close the area fills at the zero line.
    const lastX = Math.round((daily.length - 0.5) * cw / n);
    const firstX = Math.round(0.5 * cw / n);
    const hasLoss = daily.some(d => d.net_isk < 0);
    svg += `<path d="${iskPath} L${lastX},${ch} L${firstX},${ch} Z" fill="url(#iskGrad)" opacity="0.7"/>`;
    if (hasLoss) {
      svg += `<path d="${lossPath} L${lastX},${ch} L${firstX},${ch} Z" fill="url(#lossGrad)" opacity="0.7"/>`;
    }

    // Run count bars are painted before the ISK lines so the lines remain visible.
    daily.forEach((d, i) => {
      const x = Math.round(i * cw / n + (cw / n - barW) / 2);
      const barH = Math.round((d.total_runs / maxRuns) * (ch * 0.25));
      const y = ch - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="#4fc3f7" opacity="0.25" rx="1"/>`;
    });

    svg += `<path d="${iskPath}" fill="none" stroke="#66bb6a" stroke-width="1.5"/>`;
    if (hasLoss) {
      svg += `<path d="${lossPath}" fill="none" stroke="#ef5350" stroke-width="1.5"/>`;
    }

    // Fit date labels to the available width regardless of the selected range.
    const maxLabels = Math.max(2, Math.floor(cw / 48));
    const labelEvery = Math.max(1, Math.ceil(daily.length / maxLabels));
    daily.forEach((d, i) => {
      if (i % labelEvery !== 0 && i !== daily.length - 1) return;
      const x = Math.round((i + 0.5) * cw / n);
      const dateStr = d.day.slice(5); // MM-DD
      svg += `<text x="${x}" y="${ch + 20}" fill="#2a4a6a" font-size="10" text-anchor="middle" font-family="Consolas,monospace">${dateStr}</text>`;
    });

    // Tooltip hit areas (title tag for native hover)
    daily.forEach((d, i) => {
      const x = Math.round(i * cw / n);
      const w = Math.round(cw / n);
      const iskStr = d.net_isk >= 0 ? '+' + formatIsk(d.net_isk) : '-' + formatIsk(Math.abs(d.net_isk));
      const period = bucket === 'day'
        ? d.day
        : bucket === 'week' ? `Week of ${d.day}` : `${bucketDays}-day period from ${d.day}`;
      const title = `${period}  |  ${d.total_runs} runs  |  Net: ${iskStr}`;
      svg += `<rect x="${x}" y="0" width="${w}" height="${ch}" fill="transparent"><title>${title}</title></rect>`;
    });

    // Legend
    svg += `<circle cx="${cw - 120}" cy="-4" r="4" fill="#66bb6a"/>
      <text x="${cw - 112}" y="0" fill="#5a7a9a" font-size="10" font-family="Consolas,monospace">Net</text>
      <rect x="${cw - 54}" y="-8" width="8" height="8" fill="#4fc3f7" opacity="0.4" rx="1"/>
      <text x="${cw - 42}" y="0" fill="#5a7a9a" font-size="10" font-family="Consolas,monospace">Runs</text>`;

    svg += `</g></svg>`;
    container.innerHTML = svg;
  }
    return Object.freeze({
      handleRangeChange: handleStatsRangeChange,
      render: renderStats,
      getSelectedRange: getSelectedStatsRange,
      createFilters: createStatsFilters,
      renderDailyChart,
    });
  }

  return Object.freeze({ createStatsView });
});