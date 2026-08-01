const assert = require('node:assert/strict');
const test = require('node:test');

const statistics = require('../src/shared/statistics');

test('statistics presets resolve to inclusive local calendar dates', () => {
  const now = new Date(2026, 7, 2, 15, 30);
  const range = statistics.resolveDateRange({ preset: '7d' }, now);

  assert.equal(statistics.formatDateInput(range.start), '2026-07-27');
  assert.equal(statistics.formatDateInput(range.end), '2026-08-03');
  assert.equal(range.range_start, Math.floor(new Date(2026, 6, 27).getTime() / 1000));
  assert.equal(range.range_end, Math.floor(new Date(2026, 7, 3).getTime() / 1000));
  assert.deepEqual(statistics.defaultCustomDates(now), {
    from: '2026-07-04',
    to: '2026-08-02',
  });
});

test('custom statistics ranges include the complete through date', () => {
  const range = statistics.resolveDateRange({
    preset: 'custom',
    from: '2026-03-28',
    to: '2026-03-29',
  });

  assert.equal(statistics.formatDateInput(range.start), '2026-03-28');
  assert.equal(statistics.formatDateInput(range.end), '2026-03-30');
  assert.throws(() => statistics.resolveDateRange({
    preset: 'custom',
    from: '2026-08-03',
    to: '2026-08-02',
  }));
  assert.throws(() => statistics.resolveDateRange({ preset: 'unknown' }));
});

test('daily chart series fills inactive calendar days', () => {
  const series = statistics.createChartSeries([
    { day: '2026-08-01', total_runs: 2, survived: 2, net_isk: 100, total_loss: 0 },
    { day: '2026-08-03', total_runs: 1, survived: 0, net_isk: -50, total_loss: 50 },
  ], {
    start: new Date(2026, 7, 1),
    end: new Date(2026, 7, 4),
  });

  assert.equal(series.bucket, 'day');
  assert.deepEqual(series.rows.map(row => [row.day, row.total_runs, row.net_isk]), [
    ['2026-08-01', 2, 100],
    ['2026-08-02', 0, 0],
    ['2026-08-03', 1, -50],
  ]);
});

test('chart series uses seven-day buckets for ranges longer than 90 days', () => {
  const series = statistics.createChartSeries([
    { day: '2026-01-01', total_runs: 1, survived: 1, net_isk: 10, total_loss: 0 },
    { day: '2026-04-01', total_runs: 2, survived: 2, net_isk: 20, total_loss: 0 },
  ], {
    start: new Date(2026, 0, 1),
    end: new Date(2026, 3, 2),
  });

  assert.equal(series.bucket, 'week');
  assert.equal(series.rows.length, 13);
  assert.equal(series.rows.reduce((sum, row) => sum + row.total_runs, 0), 3);
  assert.equal(series.rows.reduce((sum, row) => sum + row.net_isk, 0), 30);
});
