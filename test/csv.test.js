const assert = require('node:assert/strict');
const test = require('node:test');

const { parseCsv } = require('../src/shared/csv');

test('CSV parser preserves quoted commas, escaped quotes, and multiline cells', () => {
  const csv = [
    'id,cargo,notes',
    '1,"Tritanium, 2\r\nPLEX, 1","A ""quoted"" note"',
    '2,"","plain"',
  ].join('\r\n');

  assert.deepEqual(parseCsv(csv), [
    ['id', 'cargo', 'notes'],
    ['1', 'Tritanium, 2\r\nPLEX, 1', 'A "quoted" note'],
    ['2', '', 'plain'],
  ]);
  assert.deepEqual(parseCsv('""'), [['']]);
  assert.deepEqual(parseCsv('a,'), [['a', '']]);
});

test('CSV parser rejects malformed or excessive input', () => {
  assert.throws(() => parseCsv('"unterminated'), /unterminated/);
  assert.throws(() => parseCsv('prefix"quote'), /unexpected quote/);
  assert.throws(() => parseCsv('"closed"suffix'), /characters after/);
  assert.throws(() => parseCsv('a,b', { maxColumns: 1 }), /too many columns/);
  assert.throws(() => parseCsv('a\nb', { maxRows: 1 }), /too many rows/);
  assert.throws(() => parseCsv('abcd', { maxCellLength: 3 }), /cell is too large/);
});
