"use strict";

function createAdminRetrievalEvalRuntime(deps = {}) {
  const { storage } = deps;

  function listRuns(limit = 20) {
    return storage.listRuns(limit);
  }

  function loadRun(runId) {
    return storage.loadRun(runId);
  }

  function loadStatus() {
    return {
      active_run: storage.loadActiveRun(),
      budget: storage.loadBudget(),
      latest_runs: storage.listRuns(5),
    };
  }

  return {
    listRuns,
    loadRun,
    loadStatus,
  };
}

module.exports = {
  createAdminRetrievalEvalRuntime,
};
