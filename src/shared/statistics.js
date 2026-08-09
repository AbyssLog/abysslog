(function exposeStatistics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AbyssStatistics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
  const MAX_CHART_POINTS = 260;

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addLocalDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateInput(value, label = 'Date') {
    if (typeof value !== 'string') throw new TypeError(`${label} is required`);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new TypeError(`${label} is invalid`);
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (formatDateInput(date) !== value) throw new TypeError(`${label} is invalid`);
    return date;
  }

  function toEpochSeconds(date) {
    return Math.floor(date.getTime() / 1000);
  }

  function formatDisplayDate(date) {
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function resolveDateRange({ preset = 'all', from = '', to = '' } = {}, now = new Date()) {
    const today = startOfLocalDay(now);
    const tomorrow = addLocalDays(today, 1);
    let start = null;
    let end = null;
    let label = 'All time';

    if (preset === 'hour') {
      start = new Date(now.getTime() - 60 * 60 * 1000);
      end = new Date(now.getTime());
      label = 'Last hour';
    } else if (preset === 'today') {
      start = today;
      end = tomorrow;
      label = 'Today';
    } else if (preset === '7d' || preset === '30d' || preset === '90d') {
      const days = Number(preset.slice(0, -1));
      start = addLocalDays(today, -(days - 1));
      end = tomorrow;
      label = `Last ${days} days`;
    } else if (preset === 'month') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      label = 'This month';
    } else if (preset === 'custom') {
      start = parseDateInput(from, 'From date');
      const through = parseDateInput(to, 'Through date');
      if (start > through) throw new TypeError('From date must not be after through date');
      end = addLocalDays(through, 1);
      label = `${formatDisplayDate(start)} – ${formatDisplayDate(through)}`;
    } else if (preset !== 'all') {
      throw new TypeError('Date range is invalid');
    }

    return {
      preset,
      start,
      end,
      range_start: start ? toEpochSeconds(start) : undefined,
      range_end: end ? toEpochSeconds(end) : undefined,
      label,
    };
  }

  function defaultCustomDates(now = new Date()) {
    const today = startOfLocalDay(now);
    return {
      from: formatDateInput(addLocalDays(today, -29)),
      to: formatDateInput(today),
    };
  }

  function calendarDayCount(start, end) {
    const startStamp = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endStamp = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.round((endStamp - startStamp) / MILLISECONDS_PER_DAY));
  }

  function emptyPoint(day) {
    return { day, total_runs: 0, survived: 0, net_isk: 0, total_loss: 0 };
  }

  function fillDailySeries(rows, start, end) {
    const byDay = new Map(rows.map(row => [row.day, row]));
    const result = [];
    for (let date = startOfLocalDay(start); date < end; date = addLocalDays(date, 1)) {
      const day = formatDateInput(date);
      result.push(byDay.get(day) || emptyPoint(day));
    }
    return result;
  }

  function aggregatePeriods(rows, start, end, bucketDays) {
    const dayCount = calendarDayCount(start, end);
    const result = Array.from(
      { length: Math.ceil(dayCount / bucketDays) },
      (_unused, index) => emptyPoint(formatDateInput(addLocalDays(start, index * bucketDays)))
    );
    for (const row of rows) {
      const date = parseDateInput(row.day, 'Statistics day');
      const dayOffset = calendarDayCount(start, date);
      if (date < start || date >= end || dayOffset >= dayCount) continue;
      const summary = result[Math.floor(dayOffset / bucketDays)];
      summary.total_runs += row.total_runs;
      summary.survived += row.survived;
      summary.net_isk += row.net_isk;
      summary.total_loss += row.total_loss;
    }
    return result;
  }

  function createChartSeries(rows, { start, end, firstRun, lastRun }) {
    const first = start || (firstRun == null ? null : startOfLocalDay(new Date(firstRun * 1000)));
    const afterLast = end || (lastRun == null
      ? null
      : addLocalDays(startOfLocalDay(new Date(lastRun * 1000)), 1));
    if (!first || !afterLast || first >= afterLast) return { rows: [], bucket: 'day' };

    const dayCount = calendarDayCount(first, afterLast);
    if (dayCount <= 90) {
      return { rows: fillDailySeries(rows, first, afterLast), bucket: 'day', bucketDays: 1 };
    }
    const bucketDays = Math.max(
      7,
      Math.ceil(dayCount / (MAX_CHART_POINTS * 7)) * 7
    );
    return {
      rows: aggregatePeriods(rows, first, afterLast, bucketDays),
      bucket: bucketDays === 7 ? 'week' : 'period',
      bucketDays,
    };
  }

  return {
    addLocalDays,
    createChartSeries,
    defaultCustomDates,
    formatDateInput,
    parseDateInput,
    resolveDateRange,
    startOfLocalDay,
  };
});
