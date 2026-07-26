function parseCsv(value, {
  maxRows = 50_001,
  maxColumns = 64,
  maxCellLength = 512 * 1024,
} = {}) {
  if (typeof value !== 'string') throw new TypeError('CSV input must be a string');

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let quoteClosed = false;

  function append(character) {
    cell += character;
    if (cell.length > maxCellLength) throw new TypeError('CSV cell is too large');
  }

  function pushCell() {
    row.push(cell);
    cell = '';
    quoteClosed = false;
    if (row.length > maxColumns) throw new TypeError('CSV contains too many columns');
  }

  function pushRow() {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new TypeError('CSV contains too many rows');
  }

  for (let index = 0; index < value.length; index++) {
    const character = value[index];

    if (inQuotes) {
      if (character === '"' && value[index + 1] === '"') {
        append('"');
        index++;
      } else if (character === '"') {
        inQuotes = false;
        quoteClosed = true;
      } else {
        append(character);
      }
      continue;
    }

    if (quoteClosed) {
      if (character === ',') {
        pushCell();
      } else if (character === '\r' || character === '\n') {
        pushRow();
        if (character === '\r' && value[index + 1] === '\n') index++;
      } else {
        throw new TypeError('CSV contains characters after a closing quote');
      }
      continue;
    }

    if (character === '"') {
      if (cell.length !== 0) throw new TypeError('CSV contains an unexpected quote');
      inQuotes = true;
    } else if (character === ',') {
      pushCell();
    } else if (character === '\r' || character === '\n') {
      pushRow();
      if (character === '\r' && value[index + 1] === '\n') index++;
    } else {
      append(character);
    }
  }

  if (inQuotes) throw new TypeError('CSV contains an unterminated quoted field');
  if (quoteClosed || cell.length > 0 || row.length > 0) pushRow();

  return rows;
}

module.exports = { parseCsv };
