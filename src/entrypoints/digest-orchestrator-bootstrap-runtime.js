"use strict";

function createDigestOrchestratorBootstrapRuntime(deps) {
  const {
    initStore,
    releaseDigestLock,
    processRef = process,
  } = deps || {};
  const init = typeof initStore === "function" ? initStore : () => {};
  const releaseLock = typeof releaseDigestLock === "function" ? releaseDigestLock : () => {};
  let runtimeBootstrapDone = false;

  function ensureRuntimeBootstrap() {
    if (runtimeBootstrapDone) return;
    init();
    processRef.on("exit", () => {
      releaseLock();
    });
    ["SIGINT", "SIGTERM"].forEach((sig) => {
      processRef.on(sig, () => {
        releaseLock();
        processRef.exit(1);
      });
    });
    runtimeBootstrapDone = true;
  }

  return {
    ensureRuntimeBootstrap,
  };
}

module.exports = {
  createDigestOrchestratorBootstrapRuntime,
};
