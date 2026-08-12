const { createFitIdentity } = require('../../shared/fit-identity');

const QUERY_CHUNK_SIZE = 500;

function createFitRepository(getConnection) {
  function database() {
    const connection = getConnection();
    if (!connection) throw new Error('Database is not initialized');
    return connection;
  }

  function loadSetups(runIds) {
    const ids = [...new Set(runIds.map(Number).filter(Number.isSafeInteger))];
    const setups = new Map(ids.map(runId => [runId, { fitting: [], implants: [] }]));
    const connection = database();

    for (let offset = 0; offset < ids.length; offset += QUERY_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + QUERY_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      for (const row of connection.prepare(
        'SELECT run_id, type_id, type_name, qty, slot '
          + `FROM run_fitting WHERE run_id IN (${placeholders})`
      ).all(...chunk)) {
        setups.get(Number(row.run_id))?.fitting.push(row);
      }
      for (const row of connection.prepare(
        'SELECT run_id, type_id, type_name, slot '
          + `FROM run_implants WHERE run_id IN (${placeholders})`
      ).all(...chunk)) {
        setups.get(Number(row.run_id))?.implants.push(row);
      }
    }
    return setups;
  }

  function getIdentity(runId) {
    const setup = loadSetups([runId]).get(Number(runId));
    return setup ? createFitIdentity(setup.fitting, setup.implants) : null;
  }

  function filterEquivalentRuns(runs, referenceRunId) {
    const reference = getIdentity(referenceRunId);
    if (!reference) return [];
    const setups = loadSetups(runs.map(run => run.id));
    return runs.filter(run => {
      const setup = setups.get(Number(run.id));
      const identity = setup ? createFitIdentity(setup.fitting, setup.implants) : null;
      return identity?.signature === reference.signature;
    });
  }

  return Object.freeze({ filterEquivalentRuns, getIdentity });
}

module.exports = { createFitRepository };
