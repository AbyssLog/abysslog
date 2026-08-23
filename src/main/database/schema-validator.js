function tableColumns(connection, tableName) {
  return new Set(connection.pragma(`table_info(${tableName})`).map(column => column.name));
}

function getSchemaIssues(connection, contract) {
  const issues = [];
  const objects = connection.prepare(`
    SELECT type, name FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'
  `).all();
  const namesByType = new Map([
    ['table', new Set()],
    ['index', new Set()],
    ['trigger', new Set()],
  ]);
  for (const object of objects) namesByType.get(object.type)?.add(object.name);

  const expectedTables = Object.keys(contract.tables);
  const actualTables = namesByType.get('table');
  for (const table of expectedTables) {
    if (!actualTables.has(table)) {
      issues.push(`missing table ${table}`);
      continue;
    }
    const expectedColumns = new Set(contract.tables[table]);
    const actualColumns = tableColumns(connection, table);
    const missing = [...expectedColumns].filter(column => !actualColumns.has(column));
    const unexpected = [...actualColumns].filter(column => !expectedColumns.has(column));
    if (missing.length || unexpected.length) {
      issues.push(
        `invalid columns for ${table}`
        + (missing.length ? `; missing ${missing.join(', ')}` : '')
        + (unexpected.length ? `; unexpected ${unexpected.join(', ')}` : '')
      );
    }
  }
  const unexpectedTables = [...actualTables].filter(table => !expectedTables.includes(table));
  if (unexpectedTables.length) issues.push(`unexpected tables ${unexpectedTables.join(', ')}`);

  for (const [table, expectedFragments] of Object.entries(contract.tableSqlIncludes || {})) {
    if (!actualTables.has(table)) continue;
    const definition = connection.prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?"
    ).get(table);
    const normalizedSql = definition?.sql?.replace(/\s+/g, ' ').toUpperCase() || '';
    if (expectedFragments.some(fragment => !normalizedSql.includes(fragment.toUpperCase()))) {
      issues.push(`invalid definition for ${table}`);
    }
  }

  for (const [index, expected] of Object.entries(contract.indexes)) {
    if (!namesByType.get('index').has(index)) {
      issues.push(`missing index ${index}`);
      continue;
    }
    const listed = connection.pragma(`index_list(${expected.table})`)
      .find(candidate => candidate.name === index);
    const columns = connection.pragma(`index_info(${index})`).map(column => column.name);
    if (
      !listed
      || Boolean(listed.unique) !== expected.unique
      || Boolean(listed.partial) !== expected.partial
      || columns.length !== expected.columns.length
      || columns.some((column, position) => column !== expected.columns[position])
    ) {
      issues.push(`invalid index ${index}`);
    }
  }
  for (const [trigger, expected] of Object.entries(contract.triggers)) {
    if (!namesByType.get('trigger').has(trigger)) {
      issues.push(`missing trigger ${trigger}`);
      continue;
    }
    const definition = connection.prepare(
      "SELECT tbl_name, sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?"
    ).get(trigger);
    const normalizedSql = definition?.sql?.replace(/\s+/g, ' ').toUpperCase() || '';
    if (
      definition?.tbl_name !== expected.table
      || !normalizedSql.includes(`BEFORE ${expected.event} ON ${expected.table}`.toUpperCase())
      || !normalizedSql.includes(`RAISE(ABORT, '${expected.message}')`.toUpperCase())
    ) {
      issues.push(`invalid trigger ${trigger}`);
    }
  }

  const foreignKeyKey = foreignKey => [
    foreignKey.from,
    foreignKey.table,
    foreignKey.to,
    foreignKey.on_delete || foreignKey.onDelete,
  ].join('|');
  for (const table of expectedTables) {
    const expected = new Set((contract.foreignKeys[table] || []).map(foreignKeyKey));
    const actual = new Set(connection.pragma(`foreign_key_list(${table})`).map(foreignKeyKey));
    if (expected.size !== actual.size || [...expected].some(key => !actual.has(key))) {
      issues.push(`invalid foreign keys for ${table}`);
    }
  }
  return issues;
}

module.exports = { getSchemaIssues, tableColumns };
