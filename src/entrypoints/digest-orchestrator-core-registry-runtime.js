"use strict";

function createDigestOrchestratorCoreRuntimeRegistry(deps) {
  const {
    fs,
    path,
    https,
    processRef = process,
    appRoot,
    runtimePaths,
    getConfig,
    getEmailTemplate,
    getBaseUrl,
    buildPublicDigestUrl,
    initStore,
    log,
    sendOpsAlert,
    formatEtDateKey,
    getOpsAlertEmail,
    normalizeTopicToken,
    normalizeUrlForDedup,
    annotateEditorialSignals,
    createRepeatIndex,
    isRepeatedItem,
    dedupItemsAgainstRepeatIndex,
    parseSourceDomainShared,
    createDigestFormattingRuntime,
    createDigestDataRuntime,
    createDigestArchiveRuntime,
    createDigestDeliveryRecordRuntime,
    createDigestRetryStateRuntime,
    createDigestOrchestratorArchiveRuntime,
    createDigestOrchestratorCostRuntime,
    createDigestOrchestratorIncidentRuntime,
    createDigestOrchestratorLockRuntime,
    createDigestOrchestratorTransportRuntime,
    createDigestOrchestratorBootstrapRuntime,
    createDigestOrchestratorSpendGuardRuntime,
    createDigestOrchestratorCircuitBreakerRuntime,
    createDigestOrchestratorAuditRuntime,
    lockStates,
    readDigestLockState,
    clearDigestLockFile,
    getDigestLockOwnerStatus,
    digestLockStaleMs,
    perplexityCostPerCall,
    claudeInputPerMtok,
    claudeOutputPerMtok,
  } = deps;

  const cache = Object.create(null);

  function getCachedRuntime(key, createRuntime) {
    if (!cache[key]) cache[key] = createRuntime();
    return cache[key];
  }

  function getDigestOrchestratorLockRuntime() {
    return getCachedRuntime("lock", () => createDigestOrchestratorLockRuntime({
      fs,
      path,
      lockFilePath: runtimePaths.digestRunLockPath,
      lockStaleMs: digestLockStaleMs,
      lockStates,
      readDigestLockState,
      clearDigestLockFile,
      getDigestLockOwnerStatus,
      log,
    }));
  }

  function acquireDigestLock(...args) {
    return getDigestOrchestratorLockRuntime().acquireDigestLock(...args);
  }

  function releaseDigestLock(...args) {
    return getDigestOrchestratorLockRuntime().releaseDigestLock(...args);
  }

  function getDigestOrchestratorBootstrapRuntime() {
    return getCachedRuntime("bootstrap", () => createDigestOrchestratorBootstrapRuntime({
      initStore,
      releaseDigestLock,
      processRef,
    }));
  }

  function ensureDigestRuntimeBootstrap() {
    getDigestOrchestratorBootstrapRuntime().ensureRuntimeBootstrap();
  }

  function getDigestOrchestratorIncidentRuntime() {
    return getCachedRuntime("incident", () => createDigestOrchestratorIncidentRuntime({
      fs,
      path,
      incidentLogPath: runtimePaths.digestIncidentLogPath,
      incidentStorePath: runtimePaths.incidentStorePath,
      log,
      formatEtDateKey,
      resolveOpsAlertTarget: () => getOpsAlertEmail() || getConfig()?.admin?.email || null,
      sendOpsAlert,
    }));
  }

  function emitDigestIncident(...args) {
    return getDigestOrchestratorIncidentRuntime().emitDigestIncident(...args);
  }

  function getDigestOrchestratorSpendGuardRuntime() {
    return getCachedRuntime("spendGuard", () => createDigestOrchestratorSpendGuardRuntime({
      fs,
      path,
      spendGuardStatePath: runtimePaths.spendGuardStatePath,
      log,
    }));
  }

  function getDigestOrchestratorCircuitBreakerRuntime() {
    return getCachedRuntime("circuitBreaker", () => createDigestOrchestratorCircuitBreakerRuntime({
      fs,
      path,
      circuitBreakerStatePath: runtimePaths.circuitBreakerStatePath,
      log,
    }));
  }

  function getDigestOrchestratorTransportRuntime() {
    return getCachedRuntime("transport", () => createDigestOrchestratorTransportRuntime({
      https,
      defaultTimeoutMs: 30_000,
    }));
  }

  function httpsPost(...args) {
    return getDigestOrchestratorTransportRuntime().httpsPost(...args);
  }

  function httpsPostWithRetry(...args) {
    return getDigestOrchestratorTransportRuntime().httpsPostWithRetry(...args);
  }

  function getDigestFormattingRuntime() {
    return getCachedRuntime("formatting", () => createDigestFormattingRuntime({
      CONFIG: getConfig(),
      EMAIL_TEMPLATE: getEmailTemplate(),
      BASE_URL: getBaseUrl(),
      httpsPostWithRetry,
      buildPublicDigestUrl,
      normalizeTopicToken,
    }));
  }

  function scoreColor(...args) {
    return getDigestFormattingRuntime().scoreColor(...args);
  }

  function stripInlineHtml(...args) {
    return getDigestFormattingRuntime().stripInlineHtml(...args);
  }

  function generateLeadSubjectLine(...args) {
    return getDigestFormattingRuntime().generateLeadSubjectLine(...args);
  }

  function generateEditorialNote(...args) {
    return getDigestFormattingRuntime().generateEditorialNote(...args);
  }

  function topicVisual(...args) {
    return getDigestFormattingRuntime().topicVisual(...args);
  }

  function escapeHtml(...args) {
    return getDigestFormattingRuntime().escapeHtml(...args);
  }

  function buildEmailHeaderMeta(...args) {
    return getDigestFormattingRuntime().buildEmailHeaderMeta(...args);
  }

  function renderDigestItemHtml(...args) {
    return getDigestFormattingRuntime().renderDigestItemHtml(...args);
  }

  function applyTemplateSlots(...args) {
    return getDigestFormattingRuntime().applyTemplateSlots(...args);
  }

  function buildEmail(...args) {
    return getDigestFormattingRuntime().buildEmail(...args);
  }

  function getDigestDataRuntime() {
    return getCachedRuntime("data", () => createDigestDataRuntime({
      CONFIG: getConfig(),
      log,
      httpsPostWithRetry,
      normalizeUrlForDedup,
      isFetchedItemEligible: (item) => {
        const annotated = annotateEditorialSignals([item]);
        return annotated.length > 0 && annotated[0].hard_exclude !== true;
      },
    }));
  }

  function fetchTopicNews(...args) {
    return getDigestDataRuntime().fetchTopicNews(...args);
  }

  function enrichItems(...args) {
    return getDigestDataRuntime().enrichItems(...args);
  }

  function getDigestArchiveRuntime() {
    return getCachedRuntime("archive", () => createDigestArchiveRuntime({
      APP_ROOT: appRoot,
      archiveDir: runtimePaths.archiveDir,
      fs,
      path,
      log,
      formatEtDateKey,
      createRepeatIndex,
      isRepeatedItem,
      dedupItemsAgainstRepeatIndex,
      normalizeUrlForDedup,
      parseSourceDomainShared,
    }));
  }

  function parseSourceDomain(...args) {
    return getDigestArchiveRuntime().parseSourceDomain(...args);
  }

  function loadRecentArchiveItems(...args) {
    return getDigestArchiveRuntime().loadRecentArchiveItems(...args);
  }

  function loadRecentArchiveByDate(...args) {
    return getDigestArchiveRuntime().loadRecentArchiveByDate(...args);
  }

  function dedupAgainstRecentArchives(...args) {
    return getDigestArchiveRuntime().dedupAgainstRecentArchives(...args);
  }

  function buildRecentRepeatIndex(...args) {
    return getDigestArchiveRuntime().buildRecentRepeatIndex(...args);
  }

  function getDigestDeliveryRecordRuntime() {
    return getCachedRuntime("deliveryRecord", () => createDigestDeliveryRecordRuntime({
      APP_ROOT: appRoot,
      digestRecordsDir: runtimePaths.digestRecordsDir,
      fs,
      path,
      log,
    }));
  }

  function getDigestRetryStateRuntime() {
    return getCachedRuntime("retryState", () => createDigestRetryStateRuntime({
      APP_ROOT: appRoot,
      digestRetryStatePath: runtimePaths.digestRetryStatePath,
      fs,
      path,
      log,
    }));
  }

  function getDigestOrchestratorArchiveRuntime() {
    return getCachedRuntime("orchestratorArchive", () => createDigestOrchestratorArchiveRuntime({
      saveToArchive: (...args) => getDigestArchiveRuntime().saveToArchive(...args),
    }));
  }

  function persistSharedArchive(...args) {
    return getDigestOrchestratorArchiveRuntime().persistSharedArchive(...args);
  }

  function getDigestOrchestratorCostRuntime() {
    return getCachedRuntime("cost", () => createDigestOrchestratorCostRuntime({
      fs,
      path,
      costLogPath: runtimePaths.costLogPath,
      log,
      formatEtDateKey,
      perplexityCostPerCall,
      claudeInputPerMtok,
      claudeOutputPerMtok,
    }));
  }

  function recordRunCost(...args) {
    return getDigestOrchestratorCostRuntime().recordRunCost(...args);
  }

  function getDigestOrchestratorAuditRuntime() {
    return getCachedRuntime("audit", () => createDigestOrchestratorAuditRuntime({
      fs,
      path,
      digestAuditDir: runtimePaths.digestAuditDir,
      log,
    }));
  }

  function writeDigestAuditLog(...args) {
    return getDigestOrchestratorAuditRuntime().writeDigestAuditLog(...args);
  }

  return {
    ensureDigestRuntimeBootstrap,
    acquireDigestLock,
    releaseDigestLock,
    emitDigestIncident,
    getDigestOrchestratorSpendGuardRuntime,
    getDigestOrchestratorCircuitBreakerRuntime,
    httpsPost,
    httpsPostWithRetry,
    scoreColor,
    stripInlineHtml,
    generateLeadSubjectLine,
    generateEditorialNote,
    topicVisual,
    escapeHtml,
    buildEmailHeaderMeta,
    renderDigestItemHtml,
    applyTemplateSlots,
    buildEmail,
    fetchTopicNews,
    enrichItems,
    parseSourceDomain,
    loadRecentArchiveItems,
    loadRecentArchiveByDate,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    getDigestDeliveryRecordRuntime,
    getDigestRetryStateRuntime,
    persistSharedArchive,
    recordRunCost,
    writeDigestAuditLog,
  };
}

module.exports = {
  createDigestOrchestratorCoreRuntimeRegistry,
};
