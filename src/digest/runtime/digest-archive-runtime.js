"use strict";

const { createArchiveHistoryRuntime } = require("./archive-history-runtime");
const { createArchiveUserSuppressionRuntime } = require("./archive-user-suppression-runtime");
const { createArchivePersistenceRuntime } = require("./archive-persistence-runtime");
const { isSemanticRepeatItem } = require("./repeat-freshness-runtime");

function createDigestArchiveRuntime(deps) {
  const {
    APP_ROOT,
    archiveDir,
    log,
    formatEtDateKey,
    isRepeatedItem,
    normalizeUrlForDedup,
    parseSourceDomainShared,
  } = deps;

  function parseSourceDomain(item) {
    return parseSourceDomainShared(item, {
      onUrlParseError: (err) => {
        log(`⚠️ Unable to parse source domain from URL: ${err.message}`);
      },
    });
  }

  const archiveHistoryRuntime = createArchiveHistoryRuntime(deps);
  const archiveUserSuppressionRuntime = createArchiveUserSuppressionRuntime({
    normalizeUrlForDedup,
  });
  const archivePersistenceRuntime = createArchivePersistenceRuntime({
    APP_ROOT,
    archiveDir,
    fs: deps.fs,
    path: deps.path,
    log,
    formatEtDateKey,
    parseSourceDomain,
  });

  const {
    loadRecentArchiveItems,
    loadRecentArchiveByDate,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
  } = archiveHistoryRuntime;

  const {
    suppressRecentlySentForUser,
  } = archiveUserSuppressionRuntime;

  const {
    saveToArchive,
  } = archivePersistenceRuntime;

  function isRecentRepeatItem(item, repeatIndex) {
    return isSemanticRepeatItem(item, repeatIndex) || isRepeatedItem(item, repeatIndex);
  }

  return {
    parseSourceDomain,
    loadRecentArchiveItems,
    loadRecentArchiveByDate,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    isRecentRepeatItem,
    suppressRecentlySentForUser,
    saveToArchive,
  };
}

module.exports = {
  createDigestArchiveRuntime,
};
