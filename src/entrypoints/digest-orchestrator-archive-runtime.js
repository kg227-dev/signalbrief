"use strict";

function buildQuickScan(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item?.headline || "").split(":")[0].split("—")[0].trim())
    .filter(Boolean)
    .join(" · ");
}

function createDigestOrchestratorArchiveRuntime(deps) {
  const {
    saveToArchive,
  } = deps || {};
  const saveArchive = typeof saveToArchive === "function" ? saveToArchive : () => {};

  function persistSharedArchive({ now, enriched, dateStr, targetChatId }) {
    const quickScan = buildQuickScan(enriched);
    saveArchive(now, enriched, dateStr, quickScan, { overwrite: !targetChatId });
    return {
      quickScan,
    };
  }

  return {
    persistSharedArchive,
  };
}

module.exports = {
  createDigestOrchestratorArchiveRuntime,
  buildQuickScan,
};
