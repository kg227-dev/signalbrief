#!/usr/bin/env node
/**
 * SignalBrief — digest.js
 * Fetches news via Perplexity Sonar, summarizes via Claude,
 * delivers via email.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { MVP_TOPIC_TAGS: STANDARD_MVP_TOPIC_TAGS } = require("../platform/config/mvp-topics");
const {
  loadConfig,
  getBaseUrl,
  getNodeEnv,
  isAllowExampleSignupsEnabled,
  isDigestDryRunEnabled,
  getOpsAlertEmail,
  getDigestTriggerSource,
  getRollingZeroValueCapUsd,
  getDailyZeroValueCapUsd,
  getRollingZeroValueWindowHours,
  getDigestLockStaleMs,
} = require("../platform/config");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const { createStore, USER_STATUS } = require("../platform/store");
const { sendEmail: sendEmailViaMailer, buildOpenTrackingPixel } = require("../platform/mailer");
const {
  appendEngagementEventChecked,
  buildDigestId,
  loadEngagementEvents,
} = require("../domains/engagement");
const {
  LOCK_STATES,
  readDigestLockState,
  clearDigestLockFile,
  getDigestLockOwnerStatus,
} = require("../platform/scheduler");
const { computeDigestQualityScore } = require("../domains/digest");
const {
  createDigestDeliveryRecordRuntime,
  createDigestPolicies,
} = require("../domains/digest");
const {
  normalizeUrlForDedup,
  headlineFingerprint,
  createRepeatIndex,
  isRepeatedItem,
  dedupItemsAgainstRepeatIndex,
  buildRepeatHistory,
  filterItemsAgainstHistory,
  buildRepetitionNote,
} = require("../domains/digest");
const {
  annotateEditorialSignals,
  applyDigestDepth,
  normalizeTopicToken,
} = require("../domains/digest");
const { parseSourceDomain: parseSourceDomainShared } = require("../domains/digest");
const { createDigestFormattingRuntime } = require("../domains/digest");
const { createDigestDataRuntime } = require("../domains/digest");
const { createDigestArchiveRuntime } = require("../domains/digest");
const { articleAgeTooOld } = require("../digest/runtime/digest-data-fetch-items-runtime");
const { resolveDueUsers } = require("./digest-orchestrator-schedule-runtime");
const { createDigestOrchestratorDeliveryRuntime } = require("./digest-orchestrator-delivery-runtime");
const { createDigestOrchestratorFetchRuntime } = require("./digest-orchestrator-fetch-runtime");
const { createDigestOrchestratorSelectionRuntime } = require("./digest-orchestrator-selection-runtime");
const { getBackfillRejectionReason } = require("./digest-orchestrator-selection-runtime");
const { createDigestOrchestratorEnrichmentRuntime } = require("./digest-orchestrator-enrichment-runtime");
const {
  createDigestOrchestratorArchiveRuntime,
} = require("./digest-orchestrator-archive-runtime");
const { createDigestOrchestratorCoreRuntimeRegistry } = require("./digest-orchestrator-core-registry-runtime");
const {
  createDigestOrchestratorCostRuntime,
  calculateRunCosts,
  DEFAULT_PERPLEXITY_COST_PER_CALL,
  DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
  DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
} = require("./digest-orchestrator-cost-runtime");
const { createDigestOrchestratorIncidentRuntime } = require("./digest-orchestrator-incident-runtime");
const { createDigestOrchestratorLockRuntime } = require("./digest-orchestrator-lock-runtime");
const {
  createDigestOrchestratorRunContextRuntime,
  validateDigestRunOptions,
} = require("./digest-orchestrator-run-context-runtime");
const { createDigestOrchestratorTransportRuntime } = require("./digest-orchestrator-transport-runtime");
const { createDigestOrchestratorBootstrapRuntime } = require("./digest-orchestrator-bootstrap-runtime");
const {
  createDigestOrchestratorPipelineRuntime,
  resolveDeliveryModeFromTrigger,
  resolveDeliveryEventSource,
  filterAlreadySentScheduledDueUsers,
} = require("./digest-orchestrator-pipeline-runtime");
const {
  getEtNow,
  getEtNowParts,
  toEtDateString,
  formatEtDateKey,
} = require("./digest-orchestrator-time-runtime");
const { setAdminSourceRegistry, setPreferredSourceMatcher } = require("../domains/digest");
const { createStructuredLogger } = require("../runtime/structured-logger-runtime");
const { createDigestRetryStateRuntime } = require("../runtime/digest-retry-state-runtime");
const { resolveSignalBriefRuntimePaths } = require("../runtime/runtime-state-paths-runtime");
const { createSourceRegistryRuntime } = require("../runtime/source-policy-registry-runtime");
const { createStandardTopicBrokerRuntime } = require("../runtime/standard-topic-broker-runtime");
const { createBrokerCandidateInventoryRuntime } = require("../runtime/broker-candidate-inventory-runtime");
const { createDigestOrchestratorSpendGuardRuntime } = require("./digest-orchestrator-spend-guard-runtime");
const { createDigestOrchestratorCircuitBreakerRuntime } = require("./digest-orchestrator-circuit-breaker-runtime");
const { createDigestOrchestratorAdmissionGateRuntime } = require("./digest-orchestrator-admission-gate-runtime");
const { createDigestOrchestratorAuditRuntime } = require("./digest-orchestrator-audit-runtime");
const { parseDigestRunArgs } = require("./digest-orchestrator-run-args-runtime");
const { createDigestOrchestratorFetchSetupRuntime } = require("./digest-orchestrator-fetch-setup-runtime");
const { loadDigestTuning, mergeDigestTuning } = require("../runtime/digest-tuning-runtime");
const {
  loadEditorialOverrides,
  isUrlExcluded,
  isDomainSuppressed,
  getPinsForDate,
} = require("../digest/domain/editorial-overrides-runtime");
const { classifyStoryRelationship } = require("../digest/domain/fuzzy-dedup-runtime");

const digestStore = createStore();
const { initStore, readUser, writeUser, allUsers } = digestStore;

const LOG_FILE = "/tmp/signalbrief.log";
const RUNTIME_PATHS = resolveSignalBriefRuntimePaths({
  appRoot: APP_ROOT,
  env: process.env,
});
const EDITORIAL_OVERRIDES_PATH = RUNTIME_PATHS.editorialOverridesPath;
const ROLLING_ZERO_VALUE_CAP_USD = getRollingZeroValueCapUsd();
const DAILY_ZERO_VALUE_CAP_USD = getDailyZeroValueCapUsd();
const ROLLING_ZERO_VALUE_WINDOW_HOURS = getRollingZeroValueWindowHours();
const DIGEST_LOCK_STALE_MS = getDigestLockStaleMs();
let configCache = null;
let emailTemplateCache = null;

function getConfig() {
  if (!configCache) configCache = loadConfig();
  return configCache;
}

const CONFIG = new Proxy({}, {
  get(_target, prop) {
    return getConfig()[prop];
  },
  has(_target, prop) {
    return prop in getConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(getConfig());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const desc = Object.getOwnPropertyDescriptor(getConfig(), prop);
    if (!desc) return undefined;
    return { ...desc, configurable: true };
  },
});

function getEmailTemplate() {
  if (!emailTemplateCache) {
    emailTemplateCache = fs.readFileSync(path.join(APP_ROOT, "templates/email.html"), "utf8");
  }
  return emailTemplateCache;
}

function buildPublicDigestUrl(dateKey) {
  // Reduced-scope MVP: subscriber archive links remain authenticated, but
  // public share pages are no longer generated from the delivery path.
  void dateKey;
  return "";
}

// ET time helpers — imported from digest-orchestrator-time-runtime.js

// API cost estimates
const PERPLEXITY_COST_PER_CALL = DEFAULT_PERPLEXITY_COST_PER_CALL;
const CLAUDE_HAIKU_IN_PER_MTOK = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK;
const CLAUDE_HAIKU_OUT_PER_MTOK = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK;

// Model cost lookup maps (used by sandbox for dynamic model selection)
const MODEL_COSTS = {
  "claude-haiku-4-5":  { input: 1.00,  output: 5.00  },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "claude-sonnet-4-6": { input: 3.00,  output: 15.00 },
  "claude-opus-4-6":   { input: 15.00, output: 75.00 },
};
const SEARCH_COSTS = {
  "sonar": 0.005,
  "sonar-pro": 0.014,
  "sonar-reasoning": 0.014,
  "sonar-reasoning-pro": 0.014,
};

const digestBaseLogger = createStructuredLogger({
  service: "digest-orchestrator",
  filePath: LOG_FILE,
});
let digestLogger = digestBaseLogger;

function setDigestLoggerContext(context = {}) {
  digestLogger = digestBaseLogger.withContext(context);
}

function resetDigestLoggerContext() {
  digestLogger = digestBaseLogger;
}

function log(msg, fields = {}) {
  digestLogger.info("digest.log", {
    message: String(msg || ""),
    ...fields,
  });
}

function logEvent(level, event, fields = {}) {
  const safeLevel = String(level || "").trim().toLowerCase();
  if (safeLevel === "error") return digestLogger.error(event, fields);
  if (safeLevel === "warn") return digestLogger.warn(event, fields);
  if (safeLevel === "debug") return digestLogger.debug(event, fields);
  return digestLogger.info(event, fields);
}

const runtimeRegistry = createDigestOrchestratorCoreRuntimeRegistry({
  fs,
  path,
  https,
  processRef: process,
  appRoot: APP_ROOT,
  runtimePaths: RUNTIME_PATHS,
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
  lockStates: LOCK_STATES,
  readDigestLockState,
  clearDigestLockFile,
  getDigestLockOwnerStatus,
  digestLockStaleMs: DIGEST_LOCK_STALE_MS,
  perplexityCostPerCall: PERPLEXITY_COST_PER_CALL,
  claudeInputPerMtok: CLAUDE_HAIKU_IN_PER_MTOK,
  claudeOutputPerMtok: CLAUDE_HAIKU_OUT_PER_MTOK,
});

const {
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
} = runtimeRegistry;
const fetchSetupRuntime = createDigestOrchestratorFetchSetupRuntime({
  fs,
  path,
  processRef: process,
  appRoot: APP_ROOT,
  runtimePaths: RUNTIME_PATHS,
  nodeEnv: getNodeEnv(),
  CONFIG,
  log,
  getDigestTriggerSource,
  resolveDeliveryModeFromTrigger,
  resolveDeliveryEventSource,
  buildPublicDigestUrl,
  createSourceRegistryRuntime,
  setAdminSourceRegistry,
  setPreferredSourceMatcher,
  loadDigestTuning,
  mergeDigestTuning,
  digestTuningPath: RUNTIME_PATHS.digestTuningPath,
  createBrokerCandidateInventoryRuntime,
  brokerCandidateInventoryPath: RUNTIME_PATHS.brokerCandidateInventoryPath,
  createStandardTopicBrokerRuntime,
  createDigestOrchestratorFetchRuntime,
  normalizeTopicToken,
  fetchTopicNews,
  emitDigestIncident,
  normalizeUrlForDedup,
  annotateEditorialSignals,
});

// Audit document helpers are extracted to digest-orchestrator-audit-runtime.js.

function cloneJsonValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

// Pipeline helpers — imported from digest-orchestrator-pipeline-runtime.js

let pipelineRuntimeCache = null;
function getPipelineRuntime() {
  if (!pipelineRuntimeCache) {
    pipelineRuntimeCache = createDigestOrchestratorPipelineRuntime({
      normalizeUrlForDedup,
      parseSourceDomain,
      normalizeTopicToken,
      getConfig,
    });
  }
  return pipelineRuntimeCache;
}

function selectItems(...args) {
  return getPipelineRuntime().selectItems(...args);
}

function selectItemsDetailed(...args) {
  return getPipelineRuntime().selectItemsDetailed(...args);
}

function prepareStorylinePool(...args) {
  return getPipelineRuntime().prepareStorylinePool(...args);
}

// ── 6. Send ops alerts via configured transport ───────────────────────────────

async function sendOpsAlert(text, targetEmail, extra = {}) {
  const target = String(targetEmail || getOpsAlertEmail() || CONFIG?.admin?.email || "").trim();
  const message = String(text || "").trim();
  if (!target || !message) return;
  logEvent("info", "digest.delivery.ops_alert", {
    user_id: target,
    provider: "email",
    outcome: "attempt",
  });
  const subject = String(extra?.subject || "[SignalBrief] Digest incident").trim() || "[SignalBrief] Digest incident";
  const html = [
    "<div>",
    "<p><strong>SignalBrief ops alert</strong></p>",
    `<pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(message)}</pre>`,
    "</div>",
  ].join("");
  const result = await sendEmailViaMailer(target, subject, html);
  if (result.ok) {
    logEvent("info", "digest.delivery.ops_alert", {
      user_id: target,
      provider: String(result.via || "email"),
      outcome: "sent",
    });
    return;
  }
  logEvent("error", "digest.delivery.ops_alert", {
    user_id: target,
    provider: String(result.via || "email"),
    outcome: "failed",
  });
  throw new Error(`ops alert send failed via ${result.via || "mailer"}`);
}

// ── 7. Send Email (via mailer.js — Resend if configured, Gmail fallback) ──────

async function sendEmail(toEmail, subject, html, token = null) {
  const target = toEmail || CONFIG.user.email;
  logEvent("info", "digest.delivery.email", {
    user_id: String(target || ""),
    provider: "email",
    outcome: "attempt",
  });
  const result = await sendEmailViaMailer(target, subject, html, token);
  if (result.ok) {
    logEvent("info", "digest.delivery.email", {
      user_id: String(target || ""),
      provider: String(result.via || "email"),
      outcome: "sent",
    });
    return;
  }
  logEvent("error", "digest.delivery.email", {
    user_id: String(target || ""),
    provider: String(result.via || "email"),
    outcome: "failed",
  });
  throw new Error(`email send failed via ${result.via || "mailer"}`);
}

// ── Archive ───────────────────────────────────────────────────────────────────

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  ensureDigestRuntimeBootstrap();
  const args = process.argv.slice(2);
  const runOptions = parseDigestRunArgs(args, {
    formatEtDateKey,
    fallbackFormatEtDateKey: formatEtDateKey,
    isDigestDryRunEnabled,
  });
  const {
    suppressWelcome,
    runMode,
    auditOnly,
    inventoryRefreshOnly,
    auditTopicTag,
    auditTopicRerun,
  } = runOptions;
  validateDigestRunOptions(runOptions);
  const runId = `${runMode}:${new Date().toISOString().replace(/[:.]/g, "-")}`;
  setDigestLoggerContext({
    run_id: runId,
    user_id: null,
  });
  logEvent("info", "digest.run.started", {
    provider: "orchestrator",
    outcome: "started",
    mode: runMode,
    target_chat_id: null,
  });

  const lock = acquireDigestLock(runMode);
  if (!lock.ok) {
    const started = lock.lock?.startedAt || "unknown";
    const mode = lock.lock?.mode || "unknown";
    const state = lock.lock?.state || lock.reason || "unknown";
    const detail = lock.lock?.error ? ` detail=${lock.lock.error}` : "";
    logEvent("warn", "digest.run.skipped", {
      provider: "lock",
      outcome: "lock_unavailable",
      lock_state: state,
      lock_mode: mode,
      lock_started_at: started,
      lock_error: lock.lock?.error || null,
    });
    log(`⏭️ Digest skipped: lock unavailable (state=${state}, mode=${mode}, started=${started})${detail}`);
    process.exit(4);
  }

  const runContextRuntimeWithFlags = createDigestOrchestratorRunContextRuntime({
    allUsers,
    USER_STATUS,
    standardMvpTopicTags: STANDARD_MVP_TOPIC_TAGS,
    log,
    logEvent,
    resolveDueUsers,
    getEtNow,
    getEtNowParts,
    toEtDateString,
    CONFIG,
    filterAlreadySentScheduledDueUsers,
    getDigestDeliveryRecordRuntime,
    getDigestRetryStateRuntime,
    allowExampleEmails: isAllowExampleSignupsEnabled(),
    createDigestOrchestratorAdmissionGateRuntime,
    getDigestOrchestratorSpendGuardRuntime,
    getDigestOrchestratorCircuitBreakerRuntime,
    rollingWindowCapUsd: ROLLING_ZERO_VALUE_CAP_USD,
    rollingWindowHours: ROLLING_ZERO_VALUE_WINDOW_HOURS,
    dailyCapUsd: DAILY_ZERO_VALUE_CAP_USD,
    recordRunCost,
    releaseDigestLock,
  });
  const runContext = runContextRuntimeWithFlags.prepareDigestRunContext({
    runOptions,
    runId,
  });
  if (runContext.shouldExit) {
    process.exit(runContext.exitCode);
  }
  let { digestDateKey, dueUsers, fetchDueUsers } = runContext;

  if (inventoryRefreshOnly) {
    log(`=== SignalBrief inventory refresh running — ${STANDARD_MVP_TOPIC_TAGS.length} topic(s) ===`);
  } else if (!auditTopicRerun) {
    log(`=== SignalBrief starting — ${dueUsers.length} user(s) due ===`);
  }

  const {
    now,
    deliveryMode,
    deliveryEventSource,
    dateStr,
    shortDate,
    publicDigestUrl,
    mergedScoringConfig,
    selectionTarget,
    tagPriority,
    allItems,
    standardFetchCallsPlanned,
    standardFetchCalls,
    searchUsage,
    fetchDiagnostics,
  } = await fetchSetupRuntime.prepareFetchRun({
    digestDateKey,
    fetchDueUsers,
    runMode,
  });

  if (inventoryRefreshOnly) {
    recordRunCost({
      now,
      runId,
      standardFetchCalls,
      searchUsage,
      claudeUsage: {},
      classifierUsage: {},
      searchModel: CONFIG.digest?.searchModel || "sonar",
      searchContextSize: "low",
      enrichModel: null,
      classifierModel: CONFIG.digest?.classification?.model || null,
      dueUsers: [],
      deliveredUsers: [],
      failedUsers: [],
      publicDigestUrl: "",
      runValueState: "inventory_refresh",
      blockedReason: null,
    });
    logEvent("info", "digest.run.completed", {
      provider: "orchestrator",
      outcome: "inventory_refresh",
      due_users: 0,
      delivered_users: 0,
      failed_users: 0,
      retained_candidates: Array.isArray(allItems) ? allItems.length : 0,
    });
    log(`=== SignalBrief inventory refresh complete — ${Array.isArray(allItems) ? allItems.length : 0} candidate(s) refreshed ===`);
    return;
  }

  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG,
    log,
    createDigestPolicies,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    selectItems,
    selectItemsDetailed,
    loadRecentArchiveByDate,
    buildRepeatHistory,
    filterItemsAgainstHistory,
    buildRepetitionNote,
    emitDigestIncident,
    articleAgeTooOld,
    // editorial overrides
    loadEditorialOverrides: (p) => loadEditorialOverrides(p, fs),
    editorialOverridesPath: EDITORIAL_OVERRIDES_PATH,
    isUrlExcluded,
    isDomainSuppressed,
    getPinsForDate,
    classifyStoryRelationship,
    httpsPostWithRetry,
  });
  const {
    selected,
    selectedByTopic,
    reserveByTopic,
    repeatIndex,
    repeatPenalty,
    rankingPolicy,
    depthPolicy,
    selectionDiagnostics,
    repetitionNote,
    writeupBackfillPolicy,
    classifierUsage,
    classifierModel,
  } = await selectionRuntime.selectForEnrichment({
    allItems,
    selectionTarget,
    tagPriority,
    runMode,
    digestDateKey,
    dueUsersCount: dueUsers.length,
    standardFetchCallsPlanned,
    scoringConfig: mergedScoringConfig,
  });

  if (auditOnly) {
    writeDigestAuditLog({
      digestDateKey,
      runId,
      runMode,
      selected,
      selectionDiagnostics,
      fetchDiagnostics,
      mergeTopicTag: auditTopicRerun ? auditTopicTag : "",
    });
    recordRunCost({
      now,
      runId,
      standardFetchCalls,
      searchUsage,
      claudeUsage: {},
      classifierUsage,
      searchModel: CONFIG.digest?.searchModel || "sonar",
      searchContextSize: "low",
      enrichModel: null,
      classifierModel,
      dueUsers: [],
      deliveredUsers: [],
      failedUsers: [],
      publicDigestUrl: "",
      runValueState: "admin_audit_rerun",
      blockedReason: null,
    });
    logEvent("info", "digest.run.completed", {
      provider: "orchestrator",
      outcome: "audit_only",
      due_users: 0,
      delivered_users: 0,
      failed_users: 0,
      topic_tag: auditTopicTag,
      date_et: digestDateKey,
    });
    log(`=== SignalBrief topic audit rerun complete — ${auditTopicTag} (${digestDateKey}) ===`);
    return;
  }

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    CONFIG,
    enrichItems,
    emitDigestIncident,
    getBackfillRejectionReason,
  });
  const {
    enriched,
    finalSelectedByTopic,
    selectionDiagnostics: finalSelectionDiagnostics,
    claudeUsage,
    writeupDiagnostics,
    enrichmentDiagnostics,
  } = await enrichmentRuntime.enrichSelectedItems({
    selected,
    selectedByTopic,
    reserveByTopic,
    selectionDiagnostics,
    writeupBackfillPolicy,
    runMode,
    dueUsersCount: dueUsers.length,
    nowMs: now.getTime(),
  });

  writeDigestAuditLog({
    digestDateKey,
    runId,
    runMode,
    selected: enriched,
    selectionDiagnostics: finalSelectionDiagnostics,
    fetchDiagnostics,
    enrichmentDiagnostics,
    mergeTopicTag: auditTopicRerun ? auditTopicTag : "",
  });

  const storylinePool = Array.isArray(enriched) ? enriched.slice() : [];
  fetchDiagnostics.final_selected_preferred_count = storylinePool.filter((item) => String(item?.preferred_source_match || "none") !== "none").length;
  fetchDiagnostics.preferred_displaced_weak_count = storylinePool.filter((item) => item?.won_by_preferred_substitute === true).length;
  fetchDiagnostics.derivative_suppressed_count = storylinePool.reduce((sum, item) => sum + Math.max(0, Number(item?.cluster_derivative_suppressed_count || 0)), 0);
  fetchDiagnostics.specialist_trade_beat_preferred_count = storylinePool.filter((item) => item?.specialist_trade_outperformed_preferred === true).length;
  fetchDiagnostics.platform_identity_ambiguity_count = storylinePool.reduce((sum, item) => sum + Math.max(0, Number(item?.cluster_platform_identity_ambiguity_count || 0)), 0);
  fetchDiagnostics.broader_retrieval_found_better_count = storylinePool.filter((item) => item?.broader_retrieval_found_better === true).length;
  fetchDiagnostics.coverage_gap_preferred_missing_count = storylinePool.filter((item) => String(item?.coverage_gap_status || "") === "preferred_missing").length;
  fetchDiagnostics.coverage_gap_preferred_weaker_count = storylinePool.filter((item) => String(item?.coverage_gap_status || "") === "preferred_exists_but_weaker").length;
  log(`Delivery pool ready: ${storylinePool.length}/${enriched.length} selected candidate(s) retained for email delivery`);

  // Archive once per run (shared, date-keyed) before per-user filtering.
  persistSharedArchive({
    now,
    enriched: storylinePool,
    dateStr,
  });

  log(`Delivering to ${dueUsers.length} user(s)...`);
  const engagementEvents = loadEngagementEvents({ max_age_days: 45, dedupe: true });
  const digestDeliveryRecordRuntime = getDigestDeliveryRecordRuntime();
  const deliveryRuntime = createDigestOrchestratorDeliveryRuntime({
    CONFIG,
    log,
    writeUser,
    parseSourceDomain,
    applyDigestDepth,
    computeDigestQualityScore,
    buildDigestId,
    appendEngagementEventChecked,
    beginDigestDeliveryRecord: (...args) => digestDeliveryRecordRuntime.beginDigestDeliveryRecord(...args),
    updateDigestDeliveryRecord: (...args) => digestDeliveryRecordRuntime.updateDigestDeliveryRecord(...args),
    loadRecentSentDigests: (...args) => digestDeliveryRecordRuntime.loadRecentSentDigests(...args),
    loadAllCurrentRecords: (...args) => digestDeliveryRecordRuntime.loadAllCurrentRecords(...args),
    digestRetryStateRuntime: getDigestRetryStateRuntime(),
    generateLeadSubjectLine,
    generateEditorialNote,
    buildEmail,
    buildOpenTrackingPixel,
    getBaseUrl,
    sendEmail,
    normalizeUrlForDedup,
    formatEtDateKey,
    stripInlineHtml,
    topicVisual,
    escapeHtml,
  });

  // Wrap delivery + post-delivery in try/finally so cost is always recorded,
  // even if delivery throws after API tokens have been spent.
  let deliveredUsers = [];
  let failedUsers = [];
  try {
    const deliveryResult = await deliveryRuntime.deliverDueUsers({
      dueUsers,
      enriched: storylinePool,
      finalSelectedByTopic,
      now,
      shortDate,
      dateStr,
      digestDateKey,
      runId,
      repeatIndex,
      repeatPenalty,
      depthPolicy,
      rankingPolicy,
      publicDigestUrl,
      suppressWelcome,
      deliveryMode,
      deliveryEventSource,
      claudeUsage,
      writeupDiagnostics,
      engagementEvents,
      repetitionNote,
      runDiagnostics: {
        alternate_queries_used: Number(fetchDiagnostics?.alternate_queries_used || 0),
        preferred_domains_used: Array.isArray(fetchDiagnostics?.preferred_domains_used) ? fetchDiagnostics.preferred_domains_used.slice(0, 20) : [],
        preferred_search_result_domains: Array.isArray(fetchDiagnostics?.preferred_search_result_domains) ? fetchDiagnostics.preferred_search_result_domains.slice(0, 20) : [],
        preferred_search_result_hit_count: Number(fetchDiagnostics?.preferred_search_result_hit_count || 0),
        preferred_search_results_without_preferred_item_count: Number(fetchDiagnostics?.preferred_search_results_without_preferred_item_count || 0),
        preferred_fallback_triggered: fetchDiagnostics?.preferred_fallback_triggered === true,
        preferred_pass_item_count: Number(fetchDiagnostics?.preferred_pass_item_count || 0),
        broad_pass_item_count: Number(fetchDiagnostics?.broad_pass_item_count || 0),
        preferred_domains_count: Number(fetchDiagnostics?.preferred_domains_count || 0),
        preferred_candidate_count: Number(fetchDiagnostics?.preferred_candidate_count || 0),
        non_preferred_candidate_count: Number(fetchDiagnostics?.non_preferred_candidate_count || 0),
        final_selected_preferred_count: Number(fetchDiagnostics?.final_selected_preferred_count || 0),
        preferred_displaced_weak_count: Number(fetchDiagnostics?.preferred_displaced_weak_count || 0),
        derivative_suppressed_count: Number(fetchDiagnostics?.derivative_suppressed_count || 0),
        specialist_trade_beat_preferred_count: Number(fetchDiagnostics?.specialist_trade_beat_preferred_count || 0),
        platform_identity_ambiguity_count: Number(fetchDiagnostics?.platform_identity_ambiguity_count || 0),
        broader_retrieval_found_better_count: Number(fetchDiagnostics?.broader_retrieval_found_better_count || 0),
        coverage_gap_preferred_missing_count: Number(fetchDiagnostics?.coverage_gap_preferred_missing_count || 0),
        coverage_gap_preferred_weaker_count: Number(fetchDiagnostics?.coverage_gap_preferred_weaker_count || 0),
        search_budget_soft_calls: Number(fetchDiagnostics?.search_budget_soft_calls || 0),
        search_budget_hard_calls: Number(fetchDiagnostics?.search_budget_hard_calls || 0),
        search_budget_calls_used: Number(fetchDiagnostics?.search_budget_calls_used || 0),
        search_budget_exhausted: fetchDiagnostics?.search_budget_exhausted === true,
        broad_fallback_topics_used: Number(fetchDiagnostics?.broad_fallback_topics_used || 0),
        zero_yield_retry_count: Number(fetchDiagnostics?.zero_yield_retry_count || 0),
        budget_stop_reason: String(fetchDiagnostics?.budget_stop_reason || "").trim() || null,
        candidate_pool_before_dedup: Number(selectionDiagnostics?.candidate_pool_before_dedup || 0),
        candidate_pool_after_dedup: Number(selectionDiagnostics?.candidate_pool_after_dedup || 0),
        provider_429_count: Number(fetchDiagnostics?.provider_429_count || 0),
        provider_429_rate: Number(fetchDiagnostics?.provider_429_rate || 0),
        provider_transport_errors: Number(fetchDiagnostics?.transport_errors || 0),
        provider_degraded: Number(fetchDiagnostics?.degraded_topic_rate || 0) > 0,
        writeup_first_pass_success_count: Number(writeupDiagnostics?.first_pass_success_count || 0),
        writeup_first_pass_success_rate_pct: Number(writeupDiagnostics?.first_pass_success_rate_pct || 0),
        writeup_extraction_attempted_count: Number(writeupDiagnostics?.extraction_attempted_count || 0),
        writeup_extraction_success_count: Number(writeupDiagnostics?.extraction_success_count || 0),
        writeup_extraction_failure_count: Number(writeupDiagnostics?.extraction_failure_count || 0),
        writeup_generation_attempted_count: Number(writeupDiagnostics?.generation_attempted_count || 0),
        writeup_generation_success_count: Number(writeupDiagnostics?.generation_success_count || 0),
        writeup_generation_failure_count: Number(writeupDiagnostics?.generation_failure_count || 0),
        writeup_repair_attempted_count: Number(writeupDiagnostics?.repair_attempted_count || 0),
        writeup_repair_success_count: Number(writeupDiagnostics?.repair_success_count || 0),
        writeup_repair_pass_success_rate_pct: Number(writeupDiagnostics?.repair_pass_success_rate_pct || 0),
        writeup_drop_count: Number(writeupDiagnostics?.drop_count || 0),
        writeup_underfill_due_writeup_count: Number(writeupDiagnostics?.underfill_due_writeup_count || 0),
        writeup_repeated_phrase_rejection_count: Number(writeupDiagnostics?.repeated_phrase_rejection_count || 0),
        writeup_model_generated_count: Number(writeupDiagnostics?.model_generated_count || 0),
        writeup_model_generated_share_pct: Number(writeupDiagnostics?.model_generated_share_pct || 0),
        writeup_dropped_share_pct: Number(writeupDiagnostics?.dropped_share_pct || 0),
        writeup_strong_tier_attempted_count: Number(writeupDiagnostics?.strong_tier_attempted_count || 0),
        writeup_strong_tier_drop_count: Number(writeupDiagnostics?.strong_tier_drop_count || 0),
        writeup_strong_tier_drop_rate_pct: Number(writeupDiagnostics?.strong_tier_drop_rate_pct || 0),
        writeup_strong_tier_final_selected_count: Number(writeupDiagnostics?.strong_tier_final_selected_count || 0),
        writeup_parse_failure_counts: writeupDiagnostics?.parse_failure_counts && typeof writeupDiagnostics.parse_failure_counts === "object"
          ? cloneJsonValue(writeupDiagnostics.parse_failure_counts)
          : {},
        writeup_allow_underfill_topic_tags: Array.isArray(writeupDiagnostics?.allow_underfill_topic_tags)
          ? writeupDiagnostics.allow_underfill_topic_tags.slice()
          : [],
      },
    });
    deliveredUsers = deliveryResult.deliveredUsers;
    failedUsers = deliveryResult.failedUsers;

    // ── Post-delivery: circuit breaker evaluation and spend recording ───────
    if (Array.isArray(failedUsers) && Array.isArray(deliveredUsers)) {
      const spendRuntime = getDigestOrchestratorSpendGuardRuntime();
      const cbRuntime = getDigestOrchestratorCircuitBreakerRuntime();
      const runCost = calculateRunCosts({
        standardFetchCalls,
        searchUsage,
        claudeUsage,
        classifierUsage,
        searchModel: CONFIG.digest?.searchModel || "sonar",
        searchContextSize: "low",
        enrichModel: "claude-haiku-4-5",
        classifierModel,
        perplexityCostPerCall: PERPLEXITY_COST_PER_CALL,
        claudeInputPerMtok: CLAUDE_HAIKU_IN_PER_MTOK,
        claudeOutputPerMtok: CLAUDE_HAIKU_OUT_PER_MTOK,
      });

      // Record zero-value runs per user to spend guard
      if (failedUsers.length > 0) {
        const zeroCostPerUser = Number(failedUsers.length || 0) > 0
          ? Number(runCost.totalCost || 0) / failedUsers.length
          : 0;
        for (const failed of failedUsers) {
          spendRuntime.recordZeroValueRun({
            runId,
            dateEt: digestDateKey,
            userId: String(failed?.userId || failed?.chatId || ""),
            failureClass: String(failed?.withheld_reason || "unknown"),
            costUsd: zeroCostPerUser,
          });
        }
      }

      // Evaluate circuit breaker triggers
      const dominantFailure = failedUsers.length > 0
        ? (failedUsers[0]?.withheld_reason || null)
        : null;
      const rollingSpend = spendRuntime.queryRollingZeroValueSpend(ROLLING_ZERO_VALUE_WINDOW_HOURS);
      const dailySpend = spendRuntime.queryDailyZeroValueSpend(digestDateKey);
      const cbResult = cbRuntime.evaluateRunOutcome({
        dueCount: dueUsers.length,
        servedCount: deliveredUsers.length,
        dominantFailureClass: dominantFailure,
        runId,
        dateEt: digestDateKey,
        rollingZeroValueSpend: rollingSpend,
        rollingCap: ROLLING_ZERO_VALUE_CAP_USD,
        dailyZeroValueSpend: dailySpend,
        dailyCap: DAILY_ZERO_VALUE_CAP_USD,
      });
      if (cbResult) {
        logEvent("warn", "digest.circuit_breaker.opened", {
          provider: "circuit-breaker",
          outcome: "opened",
          reason: cbResult.opened_reason,
          run_id: runId,
          date_et: digestDateKey,
        });
        log(`⛔ Circuit breaker OPENED: ${cbResult.opened_reason}`);
        emitDigestIncident(
          "circuit_breaker_opened",
          `Circuit breaker opened: ${cbResult.opened_reason}`,
          { run_id: runId, date_et: digestDateKey, reason: cbResult.opened_reason }
        );
      }
    }

    // Resolve open incidents when delivery succeeds
    if (deliveredUsers.length > 0) {
      try {
        const incidentRuntime = getDigestOrchestratorIncidentRuntime();
        const activeIncidents = incidentRuntime.getActiveIncidents(digestDateKey);
        for (const incident of activeIncidents) {
          await incidentRuntime.resolveIncident(incident.fingerprint);
        }
      } catch (e) {
        log(`[warn] Incident resolve failed: ${e.message}`);
      }
    }

    fetchSetupRuntime.resetPreferredSourceMatcher();
  } finally {
    recordRunCost({
      now,
      runId,
      standardFetchCalls,
      searchUsage,
      claudeUsage,
      classifierUsage,
      searchModel: CONFIG.digest?.searchModel || "sonar",
      searchContextSize: "low",
      enrichModel: "claude-haiku-4-5",
      classifierModel,
      dueUsers,
      deliveredUsers,
      failedUsers,
      publicDigestUrl,
    });
  }

  logEvent("info", "digest.run.completed", {
    provider: "orchestrator",
    outcome: "success",
    due_users: dueUsers.length,
    delivered_users: deliveredUsers.length,
    failed_users: failedUsers.length,
  });
  log(`=== SignalBrief complete — ${deliveredUsers.length}/${dueUsers.length} user(s) delivered ===`);
}

function runCli() {
  return main().catch((e) => {
    logEvent("error", "digest.run.failed", {
      provider: "orchestrator",
      outcome: "fatal",
      message: String(e?.message || e),
    });
    log(`FATAL: ${e.message}`);
    process.exit(1);
  }).finally(() => {
    resetDigestLoggerContext();
  });
}

if (require.main === module) {
  runCli();
}

module.exports = {
  // Pipeline stages
  fetchTopicNews,
  enrichItems,
  selectItems,
  dedupAgainstRecentArchives,
  buildRecentRepeatIndex,
  writeDigestAuditLog,

  // Formatting
  buildEmail,
  buildEmailHeaderMeta,
  renderDigestItemHtml,
  applyTemplateSlots,
  escapeHtml,
  topicVisual,
  scoreColor,
  stripInlineHtml,
  generateLeadSubjectLine,
  generateEditorialNote,

  // Helpers
  httpsPost,
  httpsPostWithRetry,
  selectItemsDetailed,
  getEtNow,
  getEtNowParts,
  toEtDateString,
  filterAlreadySentScheduledDueUsers,
  parseSourceDomain,
  normalizeUrlForDedup,
  headlineFingerprint,

  // Cost constants
  PERPLEXITY_COST_PER_CALL,
  CLAUDE_HAIKU_IN_PER_MTOK,
  CLAUDE_HAIKU_OUT_PER_MTOK,
  MODEL_COSTS,
  SEARCH_COSTS,

  // Config + template (lazy read-only references)
  get CONFIG() {
    return getConfig();
  },
  get EMAIL_TEMPLATE() {
    return getEmailTemplate();
  },
  get BASE_URL() {
    return getBaseUrl();
  },

  // Entrypoint helpers
  parseDigestRunArgs,
  main,
  runCli,
};
