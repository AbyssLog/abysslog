function runInTransaction(connection, operation) {
  if (!connection || typeof connection.transaction !== 'function') {
    throw new TypeError('A database connection is required');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('A transaction operation is required');
  }
  return connection.inTransaction
    ? operation()
    : connection.transaction(operation)();
}

module.exports = { runInTransaction };
