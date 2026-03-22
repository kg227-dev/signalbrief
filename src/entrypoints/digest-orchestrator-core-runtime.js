#!/usr/bin/env node
/**
 * SignalBrief — digest.js
 * Fetches news via Perplexity Sonar, summarizes via Claude,
 * delivers via Telegram + Gmail.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { loadConfig } = require("../platform/config");

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
const { applyAutoTopicLearning } = require("../domains/personalization");
const {
  applyEntityCoverageCap,
  buildRecentEntityHistory,
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
  buildCustomTopicQueries,
  customKeywordMatches,
  filterItemsByTopics,
  annotateEditorialSignals,
  applyTopicRelevanceScores,
  applyDigestDepth,
  reserveCustomKeywordSlot,
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
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
const {
  loadDomainStats,
  saveDomainStats,
  accumulateDomainStats,
  computeLearnedAuthorityAdjustments,
} = require("../digest/domain/domain-learning-runtime");
const { setLearnedDomainAdjustments, setAdminSourceRegistry, setPreferredSourceRegistry } = require("../domains/digest");
const { createStructuredLogger } = require("../runtime/structured-logger-runtime");
const { resolveSignalBriefRuntimePaths } = require("../runtime/runtime-state-paths-runtime");
const { createSourceRegistryRuntime } = require("../runtime/source-policy-registry-runtime");
const {
  createPreferredSourceRegistryRuntime,
  buildPreferredDomainShortlist,
} = require("../runtime/preferred-source-registry-runtime");

const digestStore = createStore();
const { initStore, readUser, writeUser, allUsers } = digestStore;

const LOG_FILE = "/tmp/signalbrief.log";
const RUNTIME_PATHS = resolveSignalBriefRuntimePaths({
  appRoot: APP_ROOT,
  env: process.env,
});
const COST_LOG = RUNTIME_PATHS.costLogPath;
const DIGEST_RUN_LOCK = RUNTIME_PATHS.digestRunLockPath;
const DIGEST_INCIDENT_LOG = RUNTIME_PATHS.digestIncidentLogPath;
const DIGEST_LOCK_STALE_MS = Math.max(5 * 60 * 1000, Number(process.env.DIGEST_LOCK_STALE_MS || (2 * 60 * 60 * 1000)));
const sourceRegistryRuntime = createSourceRegistryRuntime({
  fs,
  path,
  sourceRegistryPath: RUNTIME_PATHS.sourceRegistryPath,
});
const preferredSourceRegistryRuntime = createPreferredSourceRegistryRuntime({
  fs,
  preferredSourcesPath: RUNTIME_PATHS.preferredSourcesPath,
});
let configCache = null;
let emailTemplateCache = null;
let digestFormattingRuntimeCache = null;
let digestDataRuntimeCache = null;
let digestArchiveRuntimeCache = null;
let digestDeliveryRecordRuntimeCache = null;
let digestOrchestratorArchiveRuntimeCache = null;
let digestOrchestratorCostRuntimeCache = null;
let digestOrchestratorIncidentRuntimeCache = null;
let digestOrchestratorLockRuntimeCache = null;
let digestOrchestratorTransportRuntimeCache = null;
let digestOrchestratorBootstrapRuntimeCache = null;

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

function getBaseUrl() {
  return process.env.BASE_URL || "https://getsignalbrief.com";
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
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  return `${getBaseUrl()}/digest/${key}`;
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
      log,
      formatEtDateKey,
      resolveOpsChatId: () => process.env.OPS_ALERT_CHAT_ID || CONFIG?.user?.telegramChatId || null,
      sendTelegram,
    });
  }
  return digestOrchestratorIncidentRuntimeCache;
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
      customKeywordMatches,
      normalizeMatchText,
      headlineFingerprint,
      normalizeUrlForDedup,
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

function buildCustomRescueItemsFromStandard(...args) {
  return getDigestFormattingRuntime().buildCustomRescueItemsFromStandard(...args);
}

function escapeHtml(...args) {
  return getDigestFormattingRuntime().escapeHtml(...args);
}

function buildLearningSummary(...args) {
  return getDigestFormattingRuntime().buildLearningSummary(...args);
}

function formatTelegram(...args) {
  return getDigestFormattingRuntime().formatTelegram(...args);
}

function buildDigestInlineKeyboard(...args) {
  return getDigestFormattingRuntime().buildDigestInlineKeyboard(...args);
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

function isRecentRepeatItem(...args) {
  return getDigestArchiveRuntime().isRecentRepeatItem(...args);
}

function suppressRecentlySentForUser(...args) {
  return getDigestArchiveRuntime().suppressRecentlySentForUser(...args);
}

function persistSharedArchive(...args) {
  return getDigestOrchestratorArchiveRuntime().persistSharedArchive(...args);
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

function prepareStorylinePool(...args) {
  return getPipelineRuntime().prepareStorylinePool(...args);
}

// ── 6. Send via SignalBrief bot ───────────────────────────────────────────────

async function sendTelegram(text, chatId, extra = {}) {
  const targetId = chatId || CONFIG.user.telegramChatId;
  logEvent("info", "digest.delivery.telegram", {
    user_id: String(targetId || ""),
    provider: "telegram",
    outcome: "attempt",
  });
  const token = CONFIG.keys.signalBriefBotToken;
  const res = await httpsPostWithRetry(
    "api.telegram.org", `/bot${token}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: targetId, text, parse_mode: "Markdown", disable_web_page_preview: false, ...extra }
  );
  if (res.body?.ok) {
    logEvent("info", "digest.delivery.telegram", {
      user_id: String(targetId || ""),
      provider: "telegram",
      outcome: "sent",
    });
    return;
  }
  const detail = res.body?.description || JSON.stringify(res.body) || `status ${res.status}`;
  logEvent("error", "digest.delivery.telegram", {
    user_id: String(targetId || ""),
    provider: "telegram",
    outcome: "failed",
    detail,
    status: Number(res.status || 0),
  });
  throw new Error(`telegram send failed: ${detail}`);
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
  // Support --chatId flag for on-demand single-user delivery (/digest command)
  const args = process.argv.slice(2);
  const chatIdIdx = args.indexOf("--chatId");
  const targetChatId = chatIdIdx !== -1 ? args[chatIdIdx + 1] : null;
  const dryRun = args.includes("--dry-run") || process.env.DIGEST_DRY_RUN === "1";
  const suppressWelcome = args.includes("--suppressWelcome");
  const runMode = targetChatId ? "targeted" : "scheduled";
  const runId = `${runMode}:${new Date().toISOString().replace(/[:.]/g, "-")}`;
  setDigestLoggerContext({
    run_id: runId,
    user_id: targetChatId ? String(targetChatId) : null,
  });
  logEvent("info", "digest.run.started", {
    provider: "orchestrator",
    outcome: "started",
    mode: runMode,
    target_chat_id: targetChatId ? String(targetChatId) : null,
  });
  const allowExampleEmails = (
    String(process.env.ALLOW_EXAMPLE_SIGNUPS || "").trim() === "1"
    || String(process.env.NODE_ENV || "").toLowerCase() !== "production"
  );

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

  // ── Check who's due BEFORE any API calls ──────────────────────────────────
  const dueContext = resolveDueUsers({
    targetChatId,
    allUsers,
    USER_STATUS,
    getEtNow,
    getEtNowParts,
    toEtDateString,
    CONFIG,
    log,
    allowExampleEmails,
  });
  const digestDateKey = String(dueContext?.todayET || "").trim() || formatEtDateKey(new Date());
  let dueUsers = Array.isArray(dueContext?.dueUsers) ? dueContext.dueUsers.slice() : [];

  if (!targetChatId && dueUsers.length > 0) {
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
    if (targetChatId) {
      logEvent("warn", "digest.run.skipped", {
        provider: "scheduler",
        outcome: "target_not_due",
      });
      log(`No active user found for on-demand chatId ${targetChatId}`);
      process.exit(2);
    }
    logEvent("info", "digest.run.skipped", {
      provider: "scheduler",
      outcome: "no_due_users",
    });
    process.exit(0); // no users due this window
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

  if (targetChatId) log(`=== SignalBrief on-demand for ${targetChatId} ===`);
  else log(`=== SignalBrief starting — ${dueUsers.length} user(s) due ===`);

  const now = new Date();
  const triggerSource = String(process.env.SIGNALBRIEF_DIGEST_TRIGGER_SOURCE || "").trim();
  const deliveryMode = resolveDeliveryModeFromTrigger(triggerSource, targetChatId);
  const deliveryEventSource = resolveDeliveryEventSource(deliveryMode);
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: CONFIG.user.timezone,
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: CONFIG.user.timezone,
  });
  const publicDigestUrl = buildPublicDigestUrl(digestDateKey);
  const domainStats = loadDomainStats();
  const sourceRegistry = sourceRegistryRuntime.loadSourceRegistry();
  setAdminSourceRegistry(sourceRegistryRuntime.buildRegistryMap(sourceRegistry));
  if (sourceRegistry && sourceRegistry.domains && Object.keys(sourceRegistry.domains).length > 0) {
    log(`[source-policy] ${Object.keys(sourceRegistry.domains).length} admin source override(s) applied`);
  }
  const preferredSourceRegistry = preferredSourceRegistryRuntime.loadPreferredSourceRegistry();
  setPreferredSourceRegistry(preferredSourceRegistry);
  const learnedAdjustments = computeLearnedAuthorityAdjustments(domainStats);
  if (learnedAdjustments.size > 0) {
    setLearnedDomainAdjustments(learnedAdjustments);
    log(`[domain-learning] ${learnedAdjustments.size} learned domain adjustment(s) applied`);
  }
  const fetchRuntime = createDigestOrchestratorFetchRuntime({
    CONFIG,
    log,
    normalizeTopicToken,
    fetchTopicNews,
    buildPreferredDomainShortlist: (options) => buildPreferredDomainShortlist(preferredSourceRegistry, options),
    buildCustomTopicQueries,
    buildCustomRescueItemsFromStandard,
    emitDigestIncident,
    normalizeUrlForDedup,
    isFetchedItemEligible: (item) => {
      const annotated = annotateEditorialSignals([item]);
      return annotated.length > 0 && annotated[0].hard_exclude !== true;
    },
  });
  const {
    selectionTarget,
    tagPriority,
    allItems: fetchedItems,
    customTags,
    standardFetchCallsPlanned,
    standardFetchCalls,
    customFetchCalls,
    fetchDiagnostics,
  } = await fetchRuntime.orchestrateFetch({
    dueUsers,
    targetChatId,
    runMode,
  });
  let allItems = fetchedItems;

  const selectionRuntime = createDigestOrchestratorSelectionRuntime({
    CONFIG,
    log,
    createDigestPolicies,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    selectItems,
    loadRecentArchiveItems,
    loadRecentArchiveByDate,
    buildRepeatHistory,
    filterItemsAgainstHistory,
    buildRepetitionNote,
    emitDigestIncident,
    articleAgeTooOld,
  });
  const {
    selected,
    repeatIndex,
    repeatPenalty,
    rankingPolicy,
    depthPolicy,
    selectionDiagnostics,
    repetitionNote,
  } = await selectionRuntime.selectForEnrichment({
    allItems,
    selectionTarget,
    customTags,
    tagPriority,
    runMode,
    digestDateKey,
    dueUsersCount: dueUsers.length,
    standardFetchCallsPlanned,
  });

  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems,
    emitDigestIncident,
  });
  const {
    enriched,
    claudeUsage,
  } = await enrichmentRuntime.enrichSelectedItems({
    selected,
    runMode,
    dueUsersCount: dueUsers.length,
  });

  const storylinePool = prepareStorylinePool(enriched, selectionTarget);
  fetchDiagnostics.final_selected_preferred_count = storylinePool.filter((item) => String(item?.preferred_source_match || "none") !== "none").length;
  fetchDiagnostics.preferred_displaced_weak_count = storylinePool.filter((item) => item?.won_by_preferred_substitute === true).length;
  fetchDiagnostics.derivative_suppressed_count = storylinePool.reduce((sum, item) => sum + Math.max(0, Number(item?.cluster_derivative_suppressed_count || 0)), 0);
  fetchDiagnostics.specialist_trade_beat_preferred_count = storylinePool.filter((item) => item?.specialist_trade_outperformed_preferred === true).length;
  fetchDiagnostics.platform_identity_ambiguity_count = storylinePool.reduce((sum, item) => sum + Math.max(0, Number(item?.cluster_platform_identity_ambiguity_count || 0)), 0);
  fetchDiagnostics.broader_retrieval_found_better_count = storylinePool.filter((item) => item?.broader_retrieval_found_better === true).length;
  fetchDiagnostics.coverage_gap_preferred_missing_count = storylinePool.filter((item) => String(item?.coverage_gap_status || "") === "preferred_missing").length;
  fetchDiagnostics.coverage_gap_preferred_weaker_count = storylinePool.filter((item) => String(item?.coverage_gap_status || "") === "preferred_exists_but_weaker").length;
  log(`Storyline pool ready: ${storylinePool.length}/${enriched.length} candidate(s) retained after quality gate`);

  // Archive once per run (shared, date-keyed) before per-user filtering.
  persistSharedArchive({
    now,
    enriched: storylinePool,
    dateStr,
    targetChatId,
  });

  log(`Delivering to ${dueUsers.length} user(s)...`);
  const engagementEvents = loadEngagementEvents({ max_age_days: 45, dedupe: true });
  const digestDeliveryRecordRuntime = getDigestDeliveryRecordRuntime();
  const deliveryRuntime = createDigestOrchestratorDeliveryRuntime({
    CONFIG,
    log,
    applyAutoTopicLearning,
    writeUser,
    buildLearningSummary,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    buildRecentEntityHistory,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
    applyEntityCoverageCap,
    reserveCustomKeywordSlot,
    applyDigestDepth,
    computeDigestQualityScore,
    buildDigestId,
    appendEngagementEventChecked,
    beginDigestDeliveryRecord: (...args) => digestDeliveryRecordRuntime.beginDigestDeliveryRecord(...args),
    updateDigestDeliveryRecord: (...args) => digestDeliveryRecordRuntime.updateDigestDeliveryRecord(...args),
    loadRecentSentDigests: (...args) => digestDeliveryRecordRuntime.loadRecentSentDigests(...args),
    sendTelegram,
    formatTelegram,
    buildDigestInlineKeyboard,
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
      targetChatId,
      deliveryMode,
      deliveryEventSource,
      claudeUsage,
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
      },
    });
    deliveredUsers = deliveryResult.deliveredUsers;
    failedUsers = deliveryResult.failedUsers;

    // Accumulate domain stats from delivered items for dynamic domain learning
    try {
      const deliveredItems = storylinePool;
      const updatedStats = accumulateDomainStats(deliveredItems, domainStats);
      saveDomainStats(updatedStats);
    } catch (_err) {
      // Non-critical — domain learning failure should not block digest
    }
    // Clear learned adjustments after run to avoid stale state
    setLearnedDomainAdjustments(null);
    setPreferredSourceRegistry(null);
  } finally {
    recordRunCost({
      now,
      runId,
      targetChatId,
      standardFetchCalls,
      customFetchCalls,
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
  if (targetChatId && deliveredUsers.length === 0) {
    logEvent("warn", "digest.run.completed", {
      provider: "orchestrator",
      outcome: "target_delivery_missed",
      due_users: dueUsers.length,
      delivered_users: deliveredUsers.length,
      failed_users: failedUsers.length,
    });
    process.exit(3);
  }
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

  // Formatting
  formatTelegram,
  buildEmail,
  buildEmailHeaderMeta,
  renderDigestItemHtml,
  applyTemplateSlots,
  escapeHtml,
  topicVisual,
  scoreColor,
  stripInlineHtml,
  buildDigestInlineKeyboard,
  generateLeadSubjectLine,
  generateEditorialNote,

  // Helpers
  httpsPost,
  httpsPostWithRetry,
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
  main,
  runCli,
};
