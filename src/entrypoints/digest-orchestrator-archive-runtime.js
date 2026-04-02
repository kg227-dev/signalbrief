"use strict";

const { normalizeDigestHeadlinePreview } = require("../digest/runtime/digest-headline-preview-runtime");

function buildQuickScan(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeDigestHeadlinePreview(item?.headline || ""))
    .filter(Boolean)
    .join(" · ");
}

function createDigestOrchestratorArchiveRuntime(deps) {
  const {
    saveToArchive,
  } = deps || {};
  const saveArchive = typeof saveToArchive === "function" ? saveToArchive : () => {};

  function persistSharedArchive({ now, enriched, dateStr }) {
    const quickScan = buildQuickScan(enriched);
    saveArchive(now, enriched, dateStr, quickScan, { overwrite: true });
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
