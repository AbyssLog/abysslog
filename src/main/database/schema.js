const { CURRENT_SCHEMA_CONTRACT } = require('./schema-contract-v7');
const { createFreshSchemaV7, SCHEMA_VERSION_V7 } = require('./schema-v7');
const { getSchemaIssues, tableColumns } = require('./schema-validator');

const ABYSSLOG_APPLICATION_ID = 0x4142594c;
const SCHEMA_VERSION = SCHEMA_VERSION_V7;

function getCurrentSchemaIssues(connection) {
  return getSchemaIssues(connection, CURRENT_SCHEMA_CONTRACT);
}

module.exports = {
  ABYSSLOG_APPLICATION_ID,
  CURRENT_SCHEMA_CONTRACT,
  SCHEMA_VERSION,
  createSchema: createFreshSchemaV7,
  getCurrentSchemaIssues,
  tableColumns,
};
