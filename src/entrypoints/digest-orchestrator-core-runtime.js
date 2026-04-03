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
const {
  createDigestOrchestratorCostRuntime,
  DEFAULT_PERPLEXITY_COST_PER_CALL,
  DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
  DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
} = require("./digest-orchestrator-cost-runtime");
const { createDigestOrchestratorIncidentRuntime } = require("./digest-orchestrator-incident-runtime");
const { createDigestOrchestratorLockRuntime } = require("./digest-orchestrator-lock-runtime");
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
const COST_LOG = RUNTIME_PATHS.costLogPath;
const DIGEST_AUDIT_DIR = RUNTIME_PATHS.digestAuditDir;
const DIGEST_RUN_LOCK = RUNTIME_PATHS.digestRunLockPath;
const DIGEST_INCIDENT_LOG = RUNTIME_PATHS.digestIncidentLogPath;
const SPEND_GUARD_STATE = RUNTIME_PATHS.spendGuardStatePath;
const CIRCUIT_BREAKER_STATE = RUNTIME_PATHS.circuitBreakerStatePath;
const INCIDENT_STORE = RUNTIME_PATHS.incidentStorePath;
const DIGEST_TUNING_PATH = RUNTIME_PATHS.digestTuningPath;
const EDITORIAL_OVERRIDES_PATH = RUNTIME_PATHS.editorialOverridesPath;
const BROKER_CANDIDATE_INVENTORY_PATH = RUNTIME_PATHS.brokerCandidateInventoryPath;
const ROLLING_ZERO_VALUE_CAP_USD = getRollingZeroValueCapUsd();
const DAILY_ZERO_VALUE_CAP_USD = getDailyZeroValueCapUsd();
const ROLLING_ZERO_VALUE_WINDOW_HOURS = getRollingZeroValueWindowHours();
const DIGEST_LOCK_STALE_MS = getDigestLockStaleMs();
const sourceRegistryRuntime = createSourceRegistryRuntime({
  fs,
  path,
  appRoot: APP_ROOT,
  env: process.env,
  nodeEnv: getNodeEnv(),
  standardTopicBrokerSourcesPath: RUNTIME_PATHS.standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
});
let configCache = null;
let emailTemplateCache = null;
let digestFormattingRuntimeCache = null;
let digestDataRuntimeCache = null;
let digestArchiveRuntimeCache = null;
let digestDeliveryRecordRuntimeCache = null;
let digestRetryStateRuntimeCache = null;
let digestOrchestratorArchiveRuntimeCache = null;
let digestOrchestratorCostRuntimeCache = null;
let digestOrchestratorIncidentRuntimeCache = null;
let digestOrchestratorLockRuntimeCache = null;
let digestOrchestratorTransportRuntimeCache = null;
let digestOrchestratorBootstrapRuntimeCache = null;
let digestOrchestratorSpendGuardRuntimeCache = null;
let digestOrchestratorCircuitBreakerRuntimeCache = null;

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

function ensureDigestRuntimeBootstrap() {
  if (!digestOrchestratorBootstrapRuntimeCache) {
    digestOrchestratorBootstrapRuntimeCache = createDigestOrchestratorBootstrapRuntime({
      initStore,
      releaseDigestLock,
      processRef: process,
    });
  }
  digestOrchestratorBootstrapRuntimeCache.ensureRuntimeBootstrap();
}

function buildPublicDigestUrl(dateKey) {
  // Reduced-scope MVP: subscriber archive links remain authenticated, but
  // public share pages are no longer generated from the delivery path.
  void dateKey;
  return "";
}

function parseCliOptionValue(args, name) {
  const rows = Array.isArray(args) ? args : [];
  const prefix = `${String(name || "").trim()}=`;
  for (let index = 0; index < rows.length; index += 1) {
    const current = String(rows[index] || "").trim();
    if (!current) continue;
    if (current === name) {
      const next = String(rows[index + 1] || "").trim();
      return next || "";
    }
    if (current.startsWith(prefix)) {
      return current.slice(prefix.length).trim();
    }
  }
  return "";
}

function normalizeAuditTopicTag(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAuditDateKey(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDigestRunArgs(args = [], deps = {}) {
  const formatDateKey = typeof deps.formatEtDateKey === "function"
    ? deps.formatEtDateKey
    : ((value) => String(value instanceof Date ? value.toISOString().slice(0, 10) : ""));
  const dryRun = args.includes("--dry-run") || isDigestDryRunEnabled();
  const suppressWelcome = args.includes("--suppressWelcome");
  const auditOnly = args.includes("--auditOnly");
  const inventoryRefreshOnly = args.includes("--inventory-refresh-only");
  const auditTopicTag = normalizeAuditTopicTag(parseCliOptionValue(args, "--auditTopic"));
  const auditDateKey = normalizeAuditDateKey(parseCliOptionValue(args, "--auditDate"));
  const todayEt = normalizeAuditDateKey(formatDateKey(new Date())) || formatEtDateKey(new Date());
  const auditTopicRerun = auditOnly && !!auditTopicTag;
  const runMode = inventoryRefreshOnly
    ? "inventory_refresh"
    : (auditTopicRerun ? "admin_topic_audit_rerun" : "scheduled");
  return {
    dryRun,
    suppressWelcome,
    auditOnly,
    inventoryRefreshOnly,
    auditTopicTag,
    auditDateKey,
    todayEt,
    auditTopicRerun,
    runMode,
  };
}

// ET time helpers — imported from digest-orchestrator-time-runtime.js

// API cost estimates
const PERPLEXITY_COST_PER_CALL = DEFAULT_PERPLEXITY_COST_PER_CALL;
const CLAUDE_HAIKU_IN_PER_MTOK = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK;
const CLAUDE_HAIKU_OUT_PER_MTOK = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK;

// Model cost lookup maps (used by sandbox for dynamic model selection)
const MODEL_COSTS = {
  "claude-haiku-4-5":  { input: 0.80,  output: 4.00  },
  "claude-sonnet-4-6": { input: 3.00,  output: 15.00 },
  "claude-opus-4-6":   { input: 15.00, output: 75.00 },
};
const SEARCH_COSTS = {
  "sonar": 0.005,
  "sonar-pro": 0.01,
  "sonar-reasoning": 0.01,
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

function getDigestOrchestratorIncidentRuntime() {
  if (!digestOrchestratorIncidentRuntimeCache) {
    digestOrchestratorIncidentRuntimeCache = createDigestOrchestratorIncidentRuntime({
      fs,
      path,
      incidentLogPath: DIGEST_INCIDENT_LOG,
      incidentStorePath: INCIDENT_STORE,
      log,
      formatEtDateKey,
      resolveOpsAlertTarget: () => getOpsAlertEmail() || CONFIG?.admin?.email || null,
      sendOpsAlert,
    });
  }
  return digestOrchestratorIncidentRuntimeCache;
}

function getDigestOrchestratorSpendGuardRuntime() {
  if (!digestOrchestratorSpendGuardRuntimeCache) {
    digestOrchestratorSpendGuardRuntimeCache = createDigestOrchestratorSpendGuardRuntime({
      fs,
      path,
      spendGuardStatePath: SPEND_GUARD_STATE,
      log,
    });
  }
  return digestOrchestratorSpendGuardRuntimeCache;
}

function getDigestOrchestratorCircuitBreakerRuntime() {
  if (!digestOrchestratorCircuitBreakerRuntimeCache) {
    digestOrchestratorCircuitBreakerRuntimeCache = createDigestOrchestratorCircuitBreakerRuntime({
      fs,
      path,
      circuitBreakerStatePath: CIRCUIT_BREAKER_STATE,
      log,
    });
  }
  return digestOrchestratorCircuitBreakerRuntimeCache;
}

function getDigestOrchestratorLockRuntime() {
  if (!digestOrchestratorLockRuntimeCache) {
    digestOrchestratorLockRuntimeCache = createDigestOrchestratorLockRuntime({
      fs,
      path,
      lockFilePath: DIGEST_RUN_LOCK,
      lockStaleMs: DIGEST_LOCK_STALE_MS,
      lockStates: LOCK_STATES,
      readDigestLockState,
      clearDigestLockFile,
      getDigestLockOwnerStatus,
      log,
    });
  }
  return digestOrchestratorLockRuntimeCache;
}

function acquireDigestLock(...args) {
  return getDigestOrchestratorLockRuntime().acquireDigestLock(...args);
}

function releaseDigestLock(...args) {
  return getDigestOrchestratorLockRuntime().releaseDigestLock(...args);
}

function emitDigestIncident(...args) {
  return getDigestOrchestratorIncidentRuntime().emitDigestIncident(...args);
}

// ── User state helpers ────────────────────────────────────────────────────────
// Uses store.js — per-user JSON in data/ directory

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function getDigestOrchestratorTransportRuntime() {
  if (!digestOrchestratorTransportRuntimeCache) {
    digestOrchestratorTransportRuntimeCache = createDigestOrchestratorTransportRuntime({
      https,
      defaultTimeoutMs: 30_000,
    });
  }
  return digestOrchestratorTransportRuntimeCache;
}

function httpsPost(hostname, path_, headers, body) {
  return getDigestOrchestratorTransportRuntime().httpsPost(hostname, path_, headers, body);
}

function httpsPostWithRetry(hostname, path_, headers, body, opts = {}) {
  return getDigestOrchestratorTransportRuntime().httpsPostWithRetry(hostname, path_, headers, body, opts);
}

function getDigestFormattingRuntime() {
  if (!digestFormattingRuntimeCache) {
    digestFormattingRuntimeCache = createDigestFormattingRuntime({
      CONFIG: getConfig(),
      EMAIL_TEMPLATE: getEmailTemplate(),
      BASE_URL: getBaseUrl(),
      httpsPostWithRetry,
      buildPublicDigestUrl,
      normalizeTopicToken,
    });
  }
  return digestFormattingRuntimeCache;
}

function getDigestDataRuntime() {
  if (!digestDataRuntimeCache) {
    digestDataRuntimeCache = createDigestDataRuntime({
      CONFIG: getConfig(),
      log,
      httpsPostWithRetry,
      normalizeUrlForDedup,
      isFetchedItemEligible: (item) => {
        const annotated = annotateEditorialSignals([item]);
        return annotated.length > 0 && annotated[0].hard_exclude !== true;
      },
    });
  }
  return digestDataRuntimeCache;
}

function getDigestArchiveRuntime() {
  if (!digestArchiveRuntimeCache) {
    digestArchiveRuntimeCache = createDigestArchiveRuntime({
      APP_ROOT,
      archiveDir: RUNTIME_PATHS.archiveDir,
      fs,
      path,
      log,
      formatEtDateKey,
      createRepeatIndex,
      isRepeatedItem,
      dedupItemsAgainstRepeatIndex,
      normalizeUrlForDedup,
      parseSourceDomainShared,
    });
  }
  return digestArchiveRuntimeCache;
}

function getDigestDeliveryRecordRuntime() {
  if (!digestDeliveryRecordRuntimeCache) {
    digestDeliveryRecordRuntimeCache = createDigestDeliveryRecordRuntime({
      APP_ROOT,
      digestRecordsDir: RUNTIME_PATHS.digestRecordsDir,
      fs,
      path,
      log,
    });
  }
  return digestDeliveryRecordRuntimeCache;
}

function getDigestRetryStateRuntime() {
  if (!digestRetryStateRuntimeCache) {
    digestRetryStateRuntimeCache = createDigestRetryStateRuntime({
      APP_ROOT,
      digestRetryStatePath: RUNTIME_PATHS.digestRetryStatePath,
      fs,
      path,
      log,
    });
  }
  return digestRetryStateRuntimeCache;
}

function getDigestOrchestratorArchiveRuntime() {
  if (!digestOrchestratorArchiveRuntimeCache) {
    digestOrchestratorArchiveRuntimeCache = createDigestOrchestratorArchiveRuntime({
      saveToArchive: (...args) => getDigestArchiveRuntime().saveToArchive(...args),
    });
  }
  return digestOrchestratorArchiveRuntimeCache;
}

function getDigestOrchestratorCostRuntime() {
  if (!digestOrchestratorCostRuntimeCache) {
    digestOrchestratorCostRuntimeCache = createDigestOrchestratorCostRuntime({
      fs,
      path,
      costLogPath: COST_LOG,
      log,
      formatEtDateKey,
      perplexityCostPerCall: PERPLEXITY_COST_PER_CALL,
      claudeInputPerMtok: CLAUDE_HAIKU_IN_PER_MTOK,
      claudeOutputPerMtok: CLAUDE_HAIKU_OUT_PER_MTOK,
    });
  }
  return digestOrchestratorCostRuntimeCache;
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

function fetchTopicNews(...args) {
  return getDigestDataRuntime().fetchTopicNews(...args);
}

function enrichItems(...args) {
  return getDigestDataRuntime().enrichItems(...args);
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

function persistSharedArchive(...args) {
  return getDigestOrchestratorArchiveRuntime().persistSharedArchive(...args);
}

/**
 * Persist the per-run selection audit to data/digest-audit/{dateKey}.json.
 * Gives the operator a single file to inspect all candidates, scores, and
 * selection outcomes for any given digest day in under 60 seconds.
 * Errors are swallowed so a write failure never blocks digest delivery.
 */
function sanitizeCountMap(rawCounts) {
  const sanitized = Object.create(null);
  const entries = rawCounts && typeof rawCounts === "object" ? Object.entries(rawCounts) : [];
  for (const [key, value] of entries) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = Number(value);
    if (!normalizedKey || !Number.isFinite(normalizedValue) || normalizedValue <= 0) continue;
    sanitized[normalizedKey] = normalizedValue;
  }
  return sanitized;
}

function uniqTrimmed(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function sanitizeAuditCandidate(candidate, selectedFallback = false) {
  const selected = candidate?.selected === true || selectedFallback === true;
  const selectionReason = selected
    ? null
    : String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
  return {
    headline: String(candidate?.headline || "").slice(0, 160),
    url: String(candidate?.url || ""),
    source: String(candidate?.source || ""),
    source_domain: String(candidate?.source_domain || ""),
    source_tier: candidate?.source_tier ?? null,
    source_type: String(candidate?.source_type || ""),
    source_authority: Number.isFinite(Number(candidate?.source_authority)) ? Number(candidate.source_authority) : null,
    lane: String(candidate?.lane || ""),
    _score: candidate?._score ?? null,
    _score_components: candidate?._score_components ?? null,
    _story_relationship: candidate?._story_relationship ?? "new",
    storyline_key: String(candidate?.storyline_key || "").trim() || null,
    cross_source_count: Number.isFinite(Number(candidate?.cross_source_count)) ? Number(candidate.cross_source_count) : null,
    published_at: String(candidate?.published_at || "").trim() || null,
    freshness_hours: Number.isFinite(Number(candidate?.freshness_hours)) ? Number(candidate.freshness_hours) : null,
    content_flags: Array.isArray(candidate?.content_flags) ? candidate.content_flags.slice() : [],
    selected,
    selection_reason: selectionReason,
  };
}

function normalizeAuditSourceTier(rawTier) {
  const numericTier = Number(rawTier);
  if (numericTier === 1 || numericTier === 2 || numericTier === 3) return numericTier;
  return null;
}

function buildTopicMissedStoryFlags(candidates = []) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const selectedScores = rows
    .filter((candidate) => candidate?.selected === true)
    .map((candidate) => Number(candidate?._score))
    .filter((value) => Number.isFinite(value));
  const selectedFloor = selectedScores.length > 0 ? Math.min(...selectedScores) : 0.65;
  return rows
    .filter((candidate) => candidate?.selected !== true)
    .map((candidate) => {
      const score = Number(candidate?._score);
      const tier = normalizeAuditSourceTier(candidate?.source_tier);
      const lane = String(candidate?.lane || "").trim().toLowerCase();
      const selectionReason = String(candidate?.selection_reason || "").trim() || "selection_not_selected";
      const sourceAuthority = Number(candidate?.source_authority || 0);
      const crossSourceCount = Number(candidate?.cross_source_count || 0);
      const sourceType = String(candidate?.source_type || "").trim().toLowerCase();
      const scoreNearSelected = Number.isFinite(score) && score >= Math.max(0.55, selectedFloor - 0.05);
      const highTierSource = tier != null && tier <= 2;
      const officialPrimary = sourceType === "primary_official" || lane.includes("official");
      const multiSource = crossSourceCount >= 2;
      const sourceCapBlocked = selectionReason.startsWith("selection_source_cap");
      const poolBlocked = selectionReason === "selection_pool_full" || selectionReason === "selection_not_selected";
      if (!scoreNearSelected) return null;
      if (!(highTierSource || officialPrimary || multiSource || sourceAuthority >= 0.58)) return null;
      if (!(sourceCapBlocked || poolBlocked || selectionReason === "selection_discovery_cap")) return null;
      const signals = [];
      if (highTierSource) signals.push(`tier_${tier}_source`);
      if (officialPrimary) signals.push("official_primary");
      if (multiSource) signals.push("multi_source");
      if (sourceAuthority >= 0.58) signals.push("strong_authority");
      if (sourceCapBlocked) signals.push("source_cap_blocked");
      if (selectionReason === "selection_discovery_cap") signals.push("discovery_cap_blocked");
      if (poolBlocked) signals.push("pool_cut");
      return {
        headline: candidate.headline,
        url: candidate.url,
        source: candidate.source,
        source_tier: candidate.source_tier ?? null,
        lane: candidate.lane,
        _score: Number.isFinite(score) ? Number(score.toFixed(3)) : null,
        selection_reason: selectionReason,
        signals,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right?._score || 0) - Number(left?._score || 0))
    .slice(0, 3);
}

function buildTopicSummariesFromSelectionDiagnostics(selectionDiagnostics, selectedUrls) {
  const detailedTopics = Array.isArray(selectionDiagnostics?.topic_selection_audit)
    ? selectionDiagnostics.topic_selection_audit
    : [];
  if (detailedTopics.length > 0) {
    const summaries = Object.create(null);
    for (const topic of detailedTopics) {
      const tag = String(topic?.tag || "").trim().toUpperCase() || "__untagged__";
      const candidates = (Array.isArray(topic?.candidates) ? topic.candidates : []).map((candidate) => {
        return sanitizeAuditCandidate(candidate, selectedUrls.has(String(candidate?.url || "").trim()));
      });
      const fallbackLaneCounts = Object.create(null);
      const fallbackReasonCounts = Object.create(null);
      for (const candidate of candidates) {
        const lane = String(candidate?.lane || "unknown").trim() || "unknown";
        fallbackLaneCounts[lane] = (fallbackLaneCounts[lane] || 0) + 1;
        if (candidate.selected !== true) {
          const reason = String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
          fallbackReasonCounts[reason] = (fallbackReasonCounts[reason] || 0) + 1;
        }
      }
      summaries[tag] = {
        total_candidates: Number(topic?.total_candidates || candidates.length),
        selected_count: Number(topic?.selected_count || candidates.filter((candidate) => candidate.selected === true).length),
        rejected_count: Number(topic?.rejected_count || Math.max(0, candidates.length - candidates.filter((candidate) => candidate.selected === true).length)),
        tier_counts: sanitizeCountMap(topic?.tier_counts),
        lane_breakdown: Object.keys(sanitizeCountMap(topic?.lane_breakdown)).length > 0
          ? sanitizeCountMap(topic?.lane_breakdown)
          : fallbackLaneCounts,
        rejection_reason_counts: Object.keys(sanitizeCountMap(topic?.rejection_reason_counts)).length > 0
          ? sanitizeCountMap(topic?.rejection_reason_counts)
          : fallbackReasonCounts,
        missed_story_flags: buildTopicMissedStoryFlags(candidates),
        writeup: topic?.writeup && typeof topic.writeup === "object"
          ? cloneJsonValue(topic.writeup)
          : null,
        candidates,
      };
    }
    return summaries;
  }

  const byTag = Object.create(null);
  for (const candidate of (Array.isArray(selectionDiagnostics?.scored_candidates) ? selectionDiagnostics.scored_candidates : [])) {
    const tag = String(candidate?.tag || "").trim().toUpperCase() || "__untagged__";
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(sanitizeAuditCandidate(candidate, selectedUrls.has(String(candidate?.url || "").trim())));
  }

  const summaries = Object.create(null);
  for (const [tag, candidates] of Object.entries(byTag)) {
    const laneCounts = Object.create(null);
    const rejectionReasonCounts = Object.create(null);
    for (const candidate of candidates) {
      const lane = String(candidate?.lane || "unknown").trim() || "unknown";
      laneCounts[lane] = (laneCounts[lane] || 0) + 1;
      if (candidate.selected !== true) {
        const reason = String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
        rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1;
      }
    }
    summaries[tag] = {
      total_candidates: candidates.length,
      selected_count: candidates.filter((candidate) => candidate.selected === true).length,
      rejected_count: candidates.filter((candidate) => candidate.selected !== true).length,
      tier_counts: {},
      lane_breakdown: laneCounts,
      rejection_reason_counts: rejectionReasonCounts,
      missed_story_flags: buildTopicMissedStoryFlags(candidates),
      candidates,
    };
  }
  return summaries;
}

function serializeFetchTopicDiagnostics(fetchDiagnostics) {
  return (Array.isArray(fetchDiagnostics?.topic_diagnostics) ? fetchDiagnostics.topic_diagnostics : []).map((topic) => ({
    tag: String(topic?.tag || "").trim().toUpperCase() || null,
    coverage_status: String(topic?.coverage_status || "").trim() || null,
    unique_item_count: Number(topic?.unique_item_count || 0),
    usable_item_count: Number(topic?.usable_item_count || 0),
    query_count: Number(topic?.query_count || 0),
    preferred_call_count: Number(topic?.preferred_call_count || 0),
    broad_call_count: Number(topic?.broad_call_count || 0),
    trusted_source_call_count: Number(topic?.trusted_source_call_count || 0),
    trusted_official_call_count: Number(topic?.trusted_official_call_count || 0),
    trusted_reported_call_count: Number(topic?.trusted_reported_call_count || 0),
    broker_item_count: Number(topic?.broker_item_count || 0),
    broker_official_item_count: Number(topic?.broker_official_item_count || 0),
    broker_publisher_feed_item_count: Number(topic?.broker_publisher_feed_item_count || 0),
    discovery_item_count: Number(topic?.discovery_item_count || 0),
    discovery_capped_count: Number(topic?.discovery_capped_count || 0),
    discovery_candidate_share_pct: Number(topic?.discovery_candidate_share_pct || 0),
    broker_candidate_share_pct: Number(topic?.broker_candidate_share_pct || 0),
    total_calls_scheduled: Number(topic?.total_calls_scheduled || 0),
    status_counts: sanitizeCountMap(topic?.status_counts),
    failed_calls: Number(topic?.failed_calls || 0),
    transport_errors: Number(topic?.transport_errors || 0),
    degraded: topic?.degraded === true,
    last_error: String(topic?.last_error || "").trim() || null,
  }));
}

function serializeBrokerDiagnostics(fetchDiagnostics) {
  const broker = fetchDiagnostics?.standard_topic_broker;
  if (!broker || typeof broker !== "object") {
    return {
      enabled: false,
      config_source: "none",
      active_topic_tags: [],
      lane_counts: {},
      source_fetch_count: 0,
      source_success_count: 0,
      source_failure_count: 0,
      source_diagnostics: [],
      topic_diagnostics: [],
    };
  }
  return {
    enabled: broker.enabled === true,
    config_source: String(broker.config_source || "").trim() || "none",
    active_topic_tags: uniqTrimmed(broker.active_topic_tags),
    lane_counts: sanitizeCountMap(broker.lane_counts),
    source_fetch_count: Number(broker.source_fetch_count || 0),
    source_success_count: Number(broker.source_success_count || 0),
    source_failure_count: Number(broker.source_failure_count || 0),
    source_diagnostics: (Array.isArray(broker.source_diagnostics) ? broker.source_diagnostics : []).map((source) => ({
      id: String(source?.id || "").trim() || null,
      lane: String(source?.lane || "").trim() || null,
      topic_tags: uniqTrimmed(source?.topic_tags),
      endpoint: String(source?.endpoint || "").trim() || null,
      ok: source?.ok === true,
      status: Number(source?.status || 0),
      parsed_count: Number(source?.parsed_count || 0),
      retained_count: Number(source?.retained_count || 0),
      stale_count: Number(source?.stale_count || 0),
      non_article_count: Number(source?.non_article_count || 0),
      validation_drop_count: Number(source?.validation_drop_count || 0),
      error: String(source?.error || "").trim() || null,
    })),
    topic_diagnostics: (Array.isArray(broker.topic_diagnostics) ? broker.topic_diagnostics : []).map((topic) => ({
      tag: String(topic?.tag || "").trim().toUpperCase() || null,
      lane_counts: sanitizeCountMap(topic?.lane_counts),
      source_counts: sanitizeCountMap(topic?.source_counts),
      source_ids: uniqTrimmed(topic?.source_ids),
      item_count: Number(topic?.item_count || 0),
      article_item_count: Number(topic?.article_item_count || 0),
      official_document_count: Number(topic?.official_document_count || 0),
      errors: (Array.isArray(topic?.errors) ? topic.errors : []).map((error) => ({
        source_id: String(error?.source_id || "").trim() || null,
        error: String(error?.error || "").trim() || null,
      })),
    })),
  };
}

function buildDigestAuditDocument({ digestDateKey, runId, runMode, selected, selectionDiagnostics, fetchDiagnostics }) {
  const selectedUrls = new Set(
    (Array.isArray(selected) ? selected : []).map((item) => String(item?.url || "").trim()).filter(Boolean)
  );
  const topicSummaries = buildTopicSummariesFromSelectionDiagnostics(selectionDiagnostics, selectedUrls);
  const globalLaneCounts = Object.create(null);
  for (const topic of Object.values(topicSummaries)) {
    for (const [lane, count] of Object.entries(topic.lane_breakdown || {})) {
      globalLaneCounts[lane] = (globalLaneCounts[lane] || 0) + count;
    }
  }
  const missedStoryFlagCount = Object.values(topicSummaries).reduce((sum, topic) => {
    return sum + Math.max(0, Number(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0));
  }, 0);
  const writeupSummary = selectionDiagnostics?.writeup && typeof selectionDiagnostics.writeup === "object"
    ? cloneJsonValue(selectionDiagnostics.writeup)
    : null;

  return {
    run_id: runId || null,
    date_et: digestDateKey,
    mode: runMode,
    generated_at: new Date().toISOString(),
    summary: {
      total_candidates: Number(selectionDiagnostics?.candidate_pool_scored || 0),
      total_selected: selectedUrls.size,
      candidate_pool_before_dedup: Number(selectionDiagnostics?.candidate_pool_before_dedup || 0),
      candidate_pool_after_editorial: Number(selectionDiagnostics?.candidate_pool_after_editorial || 0),
      candidate_pool_after_archive_dedup: Number(selectionDiagnostics?.candidate_pool_after_archive_dedup || 0),
      candidate_pool_after_freshness: Number(selectionDiagnostics?.candidate_pool_after_freshness || 0),
      candidate_pool_after_history: Number(selectionDiagnostics?.candidate_pool_after_history || 0),
      candidate_pool_after_story_relationship: Number(selectionDiagnostics?.candidate_pool_after_story_relationship || 0),
      candidate_pool_after_dedup: Number(selectionDiagnostics?.candidate_pool_after_dedup || 0),
      dedup_removed: Number(selectionDiagnostics?.archive_repeat_block_count || 0),
      stale_removed: Number(selectionDiagnostics?.stale_removed_count || 0),
      history_suppressed: Number(selectionDiagnostics?.history_suppressed_count || 0),
      editorial_excluded: Number(selectionDiagnostics?.editorial_excluded_count || 0),
      editorial_domain_suppressed: Number(selectionDiagnostics?.editorial_domain_suppressed_count || 0),
      editorial_pins_injected: Number(selectionDiagnostics?.editorial_pin_count || 0),
      continuation_removed: Number(selectionDiagnostics?.story_relationship_continuation_removed || 0),
      follow_up_count: Number(selectionDiagnostics?.story_relationship_follow_up_count || 0),
      discovery_capped: Number(selectionDiagnostics?.discovery_capped_count || 0),
      selection_rejection_counts: sanitizeCountMap(selectionDiagnostics?.selection_rejection_counts),
      score_top: selectionDiagnostics?.score_top ?? null,
      score_bottom: selectionDiagnostics?.score_bottom ?? null,
      global_lane_breakdown: globalLaneCounts,
      missed_story_flag_count: missedStoryFlagCount,
      writeup: writeupSummary,
      broker_saturated_topics: Array.isArray(fetchDiagnostics?.topic_diagnostics)
        ? fetchDiagnostics.topic_diagnostics.filter((topic) => Number(topic?.broker_item_count || 0) >= 10).length
        : 0,
    },
    topics: topicSummaries,
    fetch: {
      broker_candidate_count: Number(fetchDiagnostics?.broker_candidate_count || 0),
      discovery_candidate_count: Number(fetchDiagnostics?.discovery_candidate_count || 0),
      discovery_candidate_cap_count: Number(fetchDiagnostics?.discovery_candidate_cap_count || 0),
      discovery_candidate_capped_count: Number(fetchDiagnostics?.discovery_candidate_capped_count || 0),
      broker_candidate_share_pct: Number(fetchDiagnostics?.broker_candidate_share_pct || 0),
      discovery_candidate_share_pct: Number(fetchDiagnostics?.discovery_candidate_share_pct || 0),
      max_discovery_candidate_share_pct: Number(fetchDiagnostics?.max_discovery_candidate_share_pct || 0),
      retrieval_origin_counts: sanitizeCountMap(fetchDiagnostics?.retrieval_origin_counts),
      topic_diagnostics: serializeFetchTopicDiagnostics(fetchDiagnostics),
      standard_topic_broker: serializeBrokerDiagnostics(fetchDiagnostics),
    },
  };
}

function cloneJsonValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function replaceTopicDiagnostic(topicDiagnostics, nextTopicDiagnostic) {
  const diagnostics = Array.isArray(topicDiagnostics) ? topicDiagnostics.slice() : [];
  const tag = String(nextTopicDiagnostic?.tag || "").trim().toUpperCase();
  if (!tag) return diagnostics;
  const filtered = diagnostics.filter((topic) => String(topic?.tag || "").trim().toUpperCase() !== tag);
  filtered.push(nextTopicDiagnostic);
  filtered.sort((left, right) => String(left?.tag || "").localeCompare(String(right?.tag || "")));
  return filtered;
}

function recomputeDigestAuditRollups(auditDoc) {
  const doc = auditDoc && typeof auditDoc === "object" ? auditDoc : {};
  const topics = doc.topics && typeof doc.topics === "object" ? doc.topics : {};
  const topicList = Object.values(topics);
  const globalLaneBreakdown = Object.create(null);
  const selectionRejectionCounts = Object.create(null);
  let totalCandidates = 0;
  let totalSelected = 0;
  let missedStoryFlagCount = 0;

  for (const topic of topicList) {
    totalCandidates += Number(topic?.total_candidates || 0);
    totalSelected += Number(topic?.selected_count || 0);
    missedStoryFlagCount += Math.max(0, Number(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0));
    for (const [lane, count] of Object.entries(topic?.lane_breakdown || {})) {
      globalLaneBreakdown[lane] = (globalLaneBreakdown[lane] || 0) + Number(count || 0);
    }
    for (const [reason, count] of Object.entries(topic?.rejection_reason_counts || {})) {
      selectionRejectionCounts[reason] = (selectionRejectionCounts[reason] || 0) + Number(count || 0);
    }
  }

  doc.summary = {
    ...(doc.summary && typeof doc.summary === "object" ? doc.summary : {}),
    total_candidates: totalCandidates,
    total_selected: totalSelected,
    global_lane_breakdown: globalLaneBreakdown,
    selection_rejection_counts: selectionRejectionCounts,
    discovery_capped: Number(selectionRejectionCounts.selection_discovery_cap || 0),
    missed_story_flag_count: missedStoryFlagCount,
  };

  const fetch = doc.fetch && typeof doc.fetch === "object" ? doc.fetch : {};
  const topicDiagnostics = Array.isArray(fetch.topic_diagnostics) ? fetch.topic_diagnostics : [];
  const brokerCandidateCount = topicDiagnostics.reduce((sum, topic) => sum + Number(topic?.broker_item_count || 0), 0);
  const discoveryCandidateCount = topicDiagnostics.reduce((sum, topic) => sum + Number(topic?.discovery_item_count || 0), 0);
  const discoveryCandidateCappedCount = topicDiagnostics.reduce((sum, topic) => sum + Number(topic?.discovery_capped_count || 0), 0);
  const totalCandidateCount = brokerCandidateCount + discoveryCandidateCount;
  doc.fetch = {
    ...fetch,
    broker_candidate_count: brokerCandidateCount,
    discovery_candidate_count: discoveryCandidateCount,
    discovery_candidate_capped_count: discoveryCandidateCappedCount,
    broker_candidate_share_pct: totalCandidateCount > 0
      ? Number(((brokerCandidateCount / totalCandidateCount) * 100).toFixed(2))
      : 0,
    discovery_candidate_share_pct: totalCandidateCount > 0
      ? Number(((discoveryCandidateCount / totalCandidateCount) * 100).toFixed(2))
      : 0,
  };
  return doc;
}

function mergeTopicAuditDocument(existingDoc, freshDoc, mergeTopicTag) {
  const tag = String(mergeTopicTag || "").trim().toUpperCase();
  if (!tag) return freshDoc;
  const merged = existingDoc && typeof existingDoc === "object"
    ? cloneJsonValue(existingDoc)
    : { date_et: freshDoc?.date_et || null, topics: {}, fetch: {}, summary: {} };
  const freshTopic = freshDoc?.topics && typeof freshDoc.topics === "object"
    ? (freshDoc.topics[tag] || null)
    : null;
  if (!freshTopic) return freshDoc;

  merged.run_id = freshDoc?.run_id || merged.run_id || null;
  merged.date_et = freshDoc?.date_et || merged.date_et || null;
  merged.mode = freshDoc?.mode || merged.mode || null;
  merged.generated_at = freshDoc?.generated_at || new Date().toISOString();
  merged.topics = {
    ...(merged.topics && typeof merged.topics === "object" ? merged.topics : {}),
    [tag]: freshTopic,
  };

  const freshFetch = freshDoc?.fetch && typeof freshDoc.fetch === "object" ? freshDoc.fetch : {};
  const existingFetch = merged.fetch && typeof merged.fetch === "object" ? merged.fetch : {};
  const freshTopicDiagnostic = (Array.isArray(freshFetch.topic_diagnostics) ? freshFetch.topic_diagnostics : [])
    .find((topic) => String(topic?.tag || "").trim().toUpperCase() === tag);
  const existingBroker = existingFetch.standard_topic_broker && typeof existingFetch.standard_topic_broker === "object"
    ? existingFetch.standard_topic_broker
    : {};
  const freshBroker = freshFetch.standard_topic_broker && typeof freshFetch.standard_topic_broker === "object"
    ? freshFetch.standard_topic_broker
    : {};
  const freshBrokerTopicDiagnostic = (Array.isArray(freshBroker.topic_diagnostics) ? freshBroker.topic_diagnostics : [])
    .find((topic) => String(topic?.tag || "").trim().toUpperCase() === tag);

  merged.fetch = {
    ...existingFetch,
    max_discovery_candidate_share_pct: freshFetch.max_discovery_candidate_share_pct ?? existingFetch.max_discovery_candidate_share_pct ?? 0,
    retrieval_origin_counts: sanitizeCountMap(existingFetch.retrieval_origin_counts),
    topic_diagnostics: freshTopicDiagnostic
      ? replaceTopicDiagnostic(existingFetch.topic_diagnostics, freshTopicDiagnostic)
      : (Array.isArray(existingFetch.topic_diagnostics) ? existingFetch.topic_diagnostics : []),
    standard_topic_broker: {
      ...existingBroker,
      topic_diagnostics: freshBrokerTopicDiagnostic
        ? replaceTopicDiagnostic(existingBroker.topic_diagnostics, freshBrokerTopicDiagnostic)
        : (Array.isArray(existingBroker.topic_diagnostics) ? existingBroker.topic_diagnostics : []),
      last_topic_rerun: {
        tag,
        run_id: freshDoc?.run_id || null,
        refreshed_at: freshDoc?.generated_at || new Date().toISOString(),
      },
    },
  };

  const priorRefreshes = Array.isArray(merged.partial_refreshes) ? merged.partial_refreshes : [];
  const nextRefresh = {
    tag,
    mode: freshDoc?.mode || "admin_topic_audit_rerun",
    run_id: freshDoc?.run_id || null,
    refreshed_at: freshDoc?.generated_at || new Date().toISOString(),
  };
  merged.partial_refreshes = priorRefreshes
    .filter((entry) => String(entry?.tag || "").trim().toUpperCase() !== tag)
    .concat(nextRefresh)
    .slice(-20);
  merged.partial_refresh = nextRefresh;

  return recomputeDigestAuditRollups(merged);
}

function writeDigestAuditLog({ digestDateKey, runId, runMode, selected, selectionDiagnostics, fetchDiagnostics, mergeTopicTag = "" }) {
  try {
    fs.mkdirSync(DIGEST_AUDIT_DIR, { recursive: true });
    const auditDoc = buildDigestAuditDocument({
      digestDateKey,
      runId,
      runMode,
      selected,
      selectionDiagnostics,
      fetchDiagnostics,
    });
    const normalizedMergeTopicTag = String(mergeTopicTag || "").trim().toUpperCase();
    const filePath = path.join(DIGEST_AUDIT_DIR, `${digestDateKey}.json`);
    let finalDoc = auditDoc;
    if (normalizedMergeTopicTag) {
      let existingDoc = null;
      try {
        existingDoc = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      finalDoc = mergeTopicAuditDocument(existingDoc, auditDoc, normalizedMergeTopicTag);
    }
    fs.writeFileSync(filePath, JSON.stringify(finalDoc, null, 2), "utf8");
  } catch (err) {
    if (runMode === "scheduled") throw err; // mandatory for scheduled runs — operator must know
    log(`Audit log write failed (non-fatal): ${String(err?.message || err)}`);
  }
}

function recordRunCost(...args) {
  return getDigestOrchestratorCostRuntime().recordRunCost(...args);
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
  const runOptions = parseDigestRunArgs(args, { formatEtDateKey });
  const {
    dryRun,
    suppressWelcome,
    runMode,
    auditOnly,
    inventoryRefreshOnly,
    auditTopicTag,
    auditDateKey,
    todayEt,
    auditTopicRerun,
  } = runOptions;
  if (inventoryRefreshOnly && auditOnly) {
    throw new Error("Inventory refresh runs cannot be combined with --auditOnly");
  }
  if (auditOnly && !auditTopicRerun) {
    throw new Error("Audit-only digest runs require --auditTopic=TOPIC");
  }
  if (auditTopicRerun && !auditDateKey) {
    throw new Error("Topic audit reruns require --auditDate=YYYY-MM-DD");
  }
  if (auditTopicRerun && auditDateKey !== todayEt) {
    throw new Error(`Topic audit reruns only support today ET (${todayEt}) to avoid fake historical backfills`);
  }
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
  const allowExampleEmails = isAllowExampleSignupsEnabled();

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

  let digestDateKey = auditTopicRerun ? auditDateKey : todayEt;
  let dueUsers = [];
  let fetchDueUsers = [];
  if (inventoryRefreshOnly) {
    fetchDueUsers = [{
      chatId: `inventory-refresh:${digestDateKey}`,
      email: "",
      status: USER_STATUS.ACTIVE,
      topics: STANDARD_MVP_TOPIC_TAGS.slice(),
      preferences: {
        email_enabled: false,
        depth: "headline_plus_why",
      },
    }];
    log(`=== SignalBrief inventory refresh starting — ${digestDateKey} (${STANDARD_MVP_TOPIC_TAGS.length} topic(s)) ===`);
  } else if (auditTopicRerun) {
    dueUsers = [{
      chatId: `audit:${auditTopicTag}:${digestDateKey}`,
      email: "",
      status: USER_STATUS.ACTIVE,
      topics: [auditTopicTag],
      preferences: {
        email_enabled: false,
        depth: "headline_plus_why",
      },
    }];
    fetchDueUsers = dueUsers.slice();
    log(`=== SignalBrief topic audit rerun starting — ${auditTopicTag} (${digestDateKey}) ===`);
  } else {
    // ── Check who's due BEFORE any API calls ────────────────────────────────
    const dueContext = resolveDueUsers({
      allUsers,
      USER_STATUS,
      getEtNow,
      getEtNowParts,
      toEtDateString,
      CONFIG,
      log,
      allowExampleEmails,
      retryStateRuntime: getDigestRetryStateRuntime(),
    });
    digestDateKey = String(dueContext?.todayET || "").trim() || todayEt;
    dueUsers = Array.isArray(dueContext?.dueUsers) ? dueContext.dueUsers.slice() : [];

    if (dueUsers.length > 0) {
      const digestDeliveryRecordRuntime = getDigestDeliveryRecordRuntime();
      const preflight = filterAlreadySentScheduledDueUsers(dueUsers, digestDateKey, digestDeliveryRecordRuntime);
      dueUsers = preflight.dueUsers;
      if (preflight.skippedUsers.length > 0) {
        const skippedList = preflight.skippedUsers
          .map((user) => user?.email || user?.chatId)
          .filter(Boolean)
          .join(", ");
        logEvent("info", "digest.run.skipped", {
          provider: "delivery-record",
          outcome: "already_sent_prefilter",
          skipped_users: preflight.skippedUsers.length,
          date_et: digestDateKey,
        });
        log(`⏭️ Prefiltered ${preflight.skippedUsers.length} user(s) already sent for ${digestDateKey}${skippedList ? ` -> ${skippedList}` : ""}`);
      }
    }

    if (dueUsers.length === 0) {
      logEvent("info", "digest.run.skipped", {
        provider: "scheduler",
        outcome: "no_due_users",
      });
      process.exit(0); // no users due this window
    }
    fetchDueUsers = dueUsers.slice();
  }

  // ── Pre-spend admission gate (scheduled runs only) ─────────────────────────
  if (!auditOnly && !inventoryRefreshOnly) {
    const spendGuard = getDigestOrchestratorSpendGuardRuntime();
    const circuitBreaker = getDigestOrchestratorCircuitBreakerRuntime();
    const admissionGate = createDigestOrchestratorAdmissionGateRuntime({
      circuitBreakerRuntime: circuitBreaker,
      spendGuardRuntime: spendGuard,
      rollingWindowCapUsd: ROLLING_ZERO_VALUE_CAP_USD,
      rollingWindowHours: ROLLING_ZERO_VALUE_WINDOW_HOURS,
      dailyCapUsd: DAILY_ZERO_VALUE_CAP_USD,
      log,
    });
    const gate = admissionGate.checkScheduledAdmission({
      dueUsers,
      dateEt: digestDateKey,
      retryStateRuntime: getDigestRetryStateRuntime(),
    });
    if (!gate.allowed) {
      logEvent("warn", "digest.run.blocked", {
        provider: "admission-gate",
        outcome: gate.runValueState,
        blocked_reason: gate.blockedReason,
        due_users: dueUsers.length,
        date_et: digestDateKey,
      });
      log(`⛔ Admission gate blocked: ${gate.blockedReason} (${dueUsers.length} due user(s), date=${digestDateKey})`);
      recordRunCost({
        now: new Date(),
        runId,
        standardFetchCalls: 0,
        claudeUsage: {},
        dueUsers,
        deliveredUsers: [],
        failedUsers: [],
        publicDigestUrl: "",
        runValueState: gate.runValueState,
        blockedReason: gate.blockedReason,
      });
      releaseDigestLock(runMode);
      process.exit(0);
    }
    if (gate.eligibleUsers.length < dueUsers.length) {
      const filtered = dueUsers.length - gate.eligibleUsers.length;
      log(`[admission-gate] filtered ${filtered} user(s) already at zero-value cap`);
      dueUsers = gate.eligibleUsers;
    }
    fetchDueUsers = dueUsers.slice();
  }

  if (dryRun) {
    const dueList = dueUsers.map((u) => u.email || u.chatId).filter(Boolean);
    logEvent("info", "digest.run.skipped", {
      provider: "orchestrator",
      outcome: "dry_run",
      due_users: dueUsers.length,
    });
    log(`🧪 Dry run: ${dueUsers.length} user(s) due${dueList.length ? ` -> ${dueList.join(", ")}` : ""}`);
    process.exit(0);
  }

  if (inventoryRefreshOnly) {
    log(`=== SignalBrief inventory refresh running — ${STANDARD_MVP_TOPIC_TAGS.length} topic(s) ===`);
  } else if (!auditTopicRerun) {
    log(`=== SignalBrief starting — ${dueUsers.length} user(s) due ===`);
  }

  const now = new Date();
  const triggerSource = getDigestTriggerSource();
  const deliveryMode = resolveDeliveryModeFromTrigger(triggerSource);
  const deliveryEventSource = resolveDeliveryEventSource(deliveryMode);
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: CONFIG.user.timezone,
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: CONFIG.user.timezone,
  });
  const publicDigestUrl = buildPublicDigestUrl(digestDateKey);
  const sourceRegistry = sourceRegistryRuntime.loadSourceRegistry();
  setAdminSourceRegistry(sourceRegistryRuntime.buildRegistryMap(sourceRegistry));
  if (sourceRegistry && sourceRegistry.domains && Object.keys(sourceRegistry.domains).length > 0) {
    log(`[source-policy] ${Object.keys(sourceRegistry.domains).length} admin source override(s) applied`);
  }
  const rawTuning = loadDigestTuning(DIGEST_TUNING_PATH, fs);
  const mergedScoringConfig = mergeDigestTuning(CONFIG.digest?.scoring || {}, rawTuning);
  if (Object.keys(rawTuning).length > 0) {
    log(`[digest-tuning] overrides active: ${Object.keys(rawTuning).join(", ")}`);
  }
  const brokerCandidateInventoryRuntime = createBrokerCandidateInventoryRuntime({
    fs,
    path,
    inventoryPath: BROKER_CANDIDATE_INVENTORY_PATH,
    log,
  });
  const standardTopicBrokerRuntime = createStandardTopicBrokerRuntime({
    fs,
    path,
    appRoot: APP_ROOT,
    env: process.env,
    nodeEnv: getNodeEnv(),
    standardTopicBrokerSourcesPath: RUNTIME_PATHS.standardTopicBrokerSourcesPath,
    bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
    log,
  });
  setPreferredSourceMatcher((sourceDomain, tag, options = {}) => (
    standardTopicBrokerRuntime.matchPreferredSourceFromConfig(sourceDomain, tag, options)
  ));
  function buildActivePreferredDomainShortlist(options = {}) {
    const brokerShortlist = standardTopicBrokerRuntime?.buildPreferredDomainShortlist?.(options);
    if (brokerShortlist) return brokerShortlist;
    return {
      source_of_truth: "standard_topic_broker",
      domains: [],
      topic_keys: [],
      official_friendly: false,
      active_path: null,
    };
  }
  function buildActivePreferredSourceFamilyShortlists(options = {}) {
    const brokerShortlists = standardTopicBrokerRuntime?.buildPreferredSourceFamilyShortlists?.(options);
    if (brokerShortlists) return brokerShortlists;
    return {
      source_of_truth: "standard_topic_broker",
      reported_domains: [],
      official_domains: [],
      combined_domains: [],
      topic_keys: [],
      official_friendly: false,
      active_path: null,
    };
  }
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews,
    buildPreferredDomainShortlist: buildActivePreferredDomainShortlist,
    buildPreferredSourceFamilyShortlists: buildActivePreferredSourceFamilyShortlists,
    emitDigestIncident,
    normalizeUrlForDedup,
    isFetchedItemEligible: (item) => {
      const annotated = annotateEditorialSignals([item]);
      return annotated.length > 0 && annotated[0].hard_exclude !== true;
    },
    annotateFetchedItems: annotateEditorialSignals,
    standardTopicBrokerRuntime,
    brokerCandidateInventoryRuntime,
  });
  const {
    selectionTarget,
    tagPriority,
    allItems: fetchedItems,
    standardFetchCallsPlanned,
    standardFetchCalls,
    fetchDiagnostics,
  } = await fetchRuntime.orchestrateFetch({
    dueUsers: fetchDueUsers,
    runMode,
    scoringConfig: mergedScoringConfig,
  });
  let allItems = fetchedItems;

  if (inventoryRefreshOnly) {
    recordRunCost({
      now,
      runId,
      standardFetchCalls,
      claudeUsage: {},
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
      claudeUsage: {},
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
    enrichItems,
    emitDigestIncident,
    getBackfillRejectionReason,
  });
  const {
    enriched,
    selectionDiagnostics: finalSelectionDiagnostics,
    claudeUsage,
    writeupDiagnostics,
  } = await enrichmentRuntime.enrichSelectedItems({
    selected,
    selectedByTopic,
    reserveByTopic,
    selectionDiagnostics,
    writeupBackfillPolicy,
    runMode,
    dueUsersCount: dueUsers.length,
  });

  writeDigestAuditLog({
    digestDateKey,
    runId,
    runMode,
    selected: enriched,
    selectionDiagnostics: finalSelectionDiagnostics,
    fetchDiagnostics,
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
        writeup_repair_attempted_count: Number(writeupDiagnostics?.repair_attempted_count || 0),
        writeup_repair_success_count: Number(writeupDiagnostics?.repair_success_count || 0),
        writeup_repair_pass_success_rate_pct: Number(writeupDiagnostics?.repair_pass_success_rate_pct || 0),
        writeup_drop_count: Number(writeupDiagnostics?.drop_count || 0),
        writeup_underfill_due_writeup_count: Number(writeupDiagnostics?.underfill_due_writeup_count || 0),
        writeup_repeated_phrase_rejection_count: Number(writeupDiagnostics?.repeated_phrase_rejection_count || 0),
        writeup_model_generated_count: Number(writeupDiagnostics?.model_generated_count || 0),
        writeup_model_generated_share_pct: Number(writeupDiagnostics?.model_generated_share_pct || 0),
        writeup_dropped_share_pct: Number(writeupDiagnostics?.dropped_share_pct || 0),
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

      // Record zero-value runs per user to spend guard
      if (failedUsers.length > 0) {
        const zeroCostPerUser = standardFetchCalls > 0
          ? (standardFetchCalls * 0.005) / failedUsers.length
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

    setPreferredSourceMatcher(null);
  } finally {
    recordRunCost({
      now,
      runId,
      standardFetchCalls,
      claudeUsage,
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
