const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { serveFile, json, requireJsonBody } = require("./server-request-runtime");
const {
  normalizeReferralToken,
  escapeHtml,
  formatPublicDigestDateLabel,
  renderPublicDigestPage: renderPublicDigestPageTemplate,
  renderPublicDigestMissingPage,
} = require("./server-render-runtime");
const { createStore } = require("../src/platform/store");
const { loadConfig } = require("../src/platform/config");
const {
  sendEmail,
  sendWelcomeEmail,
  sendReferralThankYou,
  buildOpenTrackingPixel,
} = require("../src/platform/mailer");
const {
  appendEngagementEventChecked,
  buildDigestId,
  normalizeUrl: normalizeEngagementUrl,
  emitIgnoredEventsIfDue,
  loadEngagementEvents,
} = require("../src/domains/engagement");
const {
  computeQualityTrend,
  createDigestDataRuntime,
  createDigestDeliveryRecordRuntime,
  createDigestFormattingRuntime,
  normalizeTopicToken,
} = require("../src/domains/digest");
const {
  createDigestOrchestratorTransportRuntime,
} = require("../src/entrypoints/digest-orchestrator-transport-runtime");
const {
  buildUserQuickScanRows,
} = require("../src/entrypoints/digest-orchestrator-delivery-helpers-runtime");
const {
  normalizeDigestHeadlinePreview,
} = require("../src/digest/runtime/digest-headline-preview-runtime");
const {
  digestRunStatus,
  startDigestTrigger,
} = require("../src/jobs/digest-runner-runtime");
const {
  createAdminAuthSessionPolicy,
} = require("./server-runtime-auth-session-policy-runtime");
const {
  createAdminOpsService,
  createRecentDigestsExporter,
} = require("./services/admin");
const { createSchedulerWorkerRestartRequester } = require("./server-runtime-scheduler-control-runtime");
const {
  createArchiveDigestStatsRuntime,
  createMagicLinkRateLimiter,
  createRuntimeStateInspector,
  createSettingsRateLimiter,
  createSignupRateLimiter,
  archiveRelevanceScore,
  getClientIp,
  getRequestHost,
  getRequestScheme,
  parseEtNowParts,
  formatTimeEt,
  normalizeDeliveryTimeInput,
  formatDaysLabel,
  computeNextDeliveryEt,
} = require("./services/shared");
const {
  buildWebRouteDependencies,
  createWebRequestHandler,
} = require("./server-runtime-web-bootstrap-runtime");
const {
  applyCanonicalHostPolicy,
  applyResponseCorsPolicy,
  handleCorsPreflightPolicy,
  handleRequestErrorPolicy,
} = require("./server-runtime-request-policy-runtime");
const {
  WEB_DIR,
  APP_ROOT,
  CANONICAL_HOST,
  PUBLIC_HOSTS,
  getServerPort,
  getBaseUrl,
  getTrustedCorsOrigins,
  getSchedulerHeartbeatFile,
  getSchedulerControlFile,
  getWebAssetVersion,
  isAllowExampleSignupsEnabled,
  getNodeEnv,
} = require("./server-runtime-env-runtime");
const {
  INDUSTRY_TOPICS,
  DEFAULT_TOPICS,
  MAX_CUSTOM_KEYWORDS,
  PROTECTED_FIELDS,
} = require("./server-runtime-topic-config-runtime");
const {
  toEtDateKey,
  decodeDigestIdParam,
  sendTransparentGif,
  readArchiveFiles,
  getAllowedArchiveDates,
  normalizeBookmarkUrl,
  createSendMagicLinkEmail,
} = require("./server-runtime-utils-runtime");
const { createStructuredLogger } = require("../src/runtime/structured-logger-runtime");
const {
  resolveSignalBriefRuntimePaths,
  describeRuntimePathAlignment,
} = require("../src/runtime/runtime-state-paths-runtime");
const { createSourceRegistryRuntime } = require("../src/runtime/source-policy-registry-runtime");
const { createStandardTopicBrokerRuntime } = require("../src/runtime/standard-topic-broker-runtime");
const { setAdminSourceRegistry } = require("../src/domains/digest");

const webStore = createStore();
const { initStore, readUser, writeUser, deleteUser, allUsers, generateToken, findUserByToken } = webStore;
const CONFIG = loadConfig();
const TRUSTED_CORS_ORIGINS = getTrustedCorsOrigins();
const WEB_PROCESS_RUN_ID = `web-${process.pid}-${Date.now()}`;
const webLogger = createStructuredLogger({
  service: "web-server",
  context: {
    run_id: WEB_PROCESS_RUN_ID,
    provider: "http",
  },
});
const {
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
} = createAdminAuthSessionPolicy();

let storeInitialized = false;
function ensureStoreInitialized() {
  if (storeInitialized) return;
  initStore();
  storeInitialized = true;
}

const { checkRateLimit } = createSignupRateLimiter({
  ipLimit: 5,
  ipWindowMs: 15 * 60 * 1000,
  emailCooldownMs: 10 * 60 * 1000,
});
const { checkMagicLinkRateLimit } = createMagicLinkRateLimiter();
const { checkSettingsRateLimit } = createSettingsRateLimiter();

const runtimePaths = resolveSignalBriefRuntimePaths({
  appRoot: APP_ROOT,
  env: process.env,
});
const ADMIN_MESSAGE_LOG = runtimePaths.adminMessageLogPath;
const ADMIN_ACTION_LOG = runtimePaths.adminActionLogPath;
const DIGEST_INCIDENT_LOG = runtimePaths.digestIncidentLogPath;
const COST_LOG_PATH = runtimePaths.costLogPath;
const SCHEDULER_CONTROL_FILE = runtimePaths.schedulerControlPath;
const sourceRegistryRuntime = createSourceRegistryRuntime({
  fs,
  path,
  appRoot: APP_ROOT,
  env: process.env,
  nodeEnv: getNodeEnv(),
  standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
});
const standardTopicBrokerRuntime = createStandardTopicBrokerRuntime({
  fs,
  appRoot: APP_ROOT,
  env: process.env,
  nodeEnv: getNodeEnv(),
  standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
});
setAdminSourceRegistry(sourceRegistryRuntime.buildRegistryMap(sourceRegistryRuntime.loadSourceRegistry()));
const requestSchedulerWorkerRestart = createSchedulerWorkerRestartRequester({
  fs,
  path,
  schedulerControlFile: SCHEDULER_CONTROL_FILE,
});

const { fork } = childProcess;
const SCHEDULER_WORKER_PATH = path.resolve(__dirname, "../src/entrypoints/scheduler-worker.js");
function forkSchedulerWorker() {
  const child = fork(SCHEDULER_WORKER_PATH, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  return child.pid;
}

const appendWebEngagementEvent = (payload, context) => (
  appendEngagementEventChecked(payload, { scope: "web", context })
);

const {
  readJsonLineLog,
  parseIsoTs,
  computeFeedbackTrend,
  loadCostRunsNewest,
  getCachedOrRefreshSchedulerHeartbeat,
  maskEmail,
  summarizeMessage,
  hashText,
  logAdminMessageEvent,
  logAdminActionEvent,
} = createAdminOpsService({
  runtime: {
    fs,
    path,
  },
  files: {
    costLogPath: COST_LOG_PATH,
    schedulerHeartbeatFile: getSchedulerHeartbeatFile,
    adminMessageLog: ADMIN_MESSAGE_LOG,
    adminActionLog: ADMIN_ACTION_LOG,
  },
  requestContext: {
    getRequestHost,
    getClientIp,
    getAdminActor,
  },
  loaders: {
    loadEngagementEvents,
  },
});
const sendMagicLinkEmail = createSendMagicLinkEmail({
  sendEmail,
  getBaseUrl,
});

const allowExampleSignups = isAllowExampleSignupsEnabled();

let digestEmailTemplateCache = null;
let digestFormattingRuntimeCache = null;
let digestDataRuntimeCache = null;
let digestTransportRuntimeCache = null;

function getDigestEmailTemplate() {
  if (!digestEmailTemplateCache) {
    digestEmailTemplateCache = fs.readFileSync(path.join(APP_ROOT, "templates/email.html"), "utf8");
  }
  return digestEmailTemplateCache;
}

function getDigestFormattingRuntime() {
  if (!digestFormattingRuntimeCache) {
    digestFormattingRuntimeCache = createDigestFormattingRuntime({
      CONFIG,
      EMAIL_TEMPLATE: getDigestEmailTemplate(),
      BASE_URL: getBaseUrl(),
      httpsPostWithRetry,
      buildPublicDigestUrl: () => "",
      normalizeTopicToken,
    });
  }
  return digestFormattingRuntimeCache;
}

function getDigestTransportRuntime() {
  if (!digestTransportRuntimeCache) {
    digestTransportRuntimeCache = createDigestOrchestratorTransportRuntime({
      https,
      defaultTimeoutMs: 30_000,
    });
  }
  return digestTransportRuntimeCache;
}

function httpsPostWithRetry(...args) {
  return getDigestTransportRuntime().httpsPostWithRetry(...args);
}

function getDigestDataRuntime() {
  if (!digestDataRuntimeCache) {
    digestDataRuntimeCache = createDigestDataRuntime({
      CONFIG,
      log: (message) => webLogger.info("web.digest_snapshot_ai", { message: String(message || "") }),
      httpsPostWithRetry,
      normalizeUrlForDedup: (value) => String(value || "").trim(),
      isFetchedItemEligible: () => true,
    });
  }
  return digestDataRuntimeCache;
}

function formatDigestDateLabelFromKey(dateKey) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const ts = Date.parse(`${key}T12:00:00.000Z`);
  if (!Number.isFinite(ts)) return key;
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function buildFallbackQuickScan(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeDigestHeadlinePreview(item?.headline || ""))
    .filter(Boolean)
    .slice(0, 5)
    .join(" · ");
}

function buildAdminDigestResendSubject(snapshot = {}, dateLabel = "") {
  const headline = String(snapshot?.items?.[0]?.headline || "").trim().replace(/\s+/g, " ");
  if (headline) {
    const truncated = headline.length > 96 ? `${headline.slice(0, 93)}...` : headline;
    return `SignalBrief: ${truncated}`;
  }
  return dateLabel ? `SignalBrief — ${dateLabel}` : "SignalBrief — Daily sector briefing";
}

async function resendDigestSnapshot({ user, snapshot }) {
  const email = String(user?.email || "").trim();
  if (!email) throw new Error("subscriber email is missing");

  const items = Array.isArray(snapshot?.items) ? snapshot.items.slice() : [];
  const selectedCount = Math.max(0, Number(snapshot?.selected_count || items.length));
  const snapshotStatus = String(snapshot?.status || "").trim().toLowerCase();
  const resendableStatuses = new Set(["sent", "failed", "selected", "sending"]);
  if (!items.length || selectedCount < 5 || !resendableStatuses.has(snapshotStatus)) {
    throw new Error("no resendable 5-item digest snapshot is available");
  }

  const digestDateKey = String(snapshot?.date_et || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(digestDateKey)) {
    throw new Error("digest snapshot is missing a valid ET date");
  }

  const digestId = String(snapshot?.digest_id || "").trim() || buildDigestId(digestDateKey, user.chatId || email);
  const userId = String(snapshot?.user_id || user?.chatId || "").trim() || null;
  const depth = String(snapshot?.depth || user?.preferences?.depth || user?.depth || "headline_plus_why").trim() || "headline_plus_why";
  const dateStr = String(snapshot?.date_str || "").trim() || formatDigestDateLabelFromKey(digestDateKey);
  const subject = String(snapshot?.subject_line || "").trim() || buildAdminDigestResendSubject(snapshot, dateStr);
  const editorialNote = String(snapshot?.editorial_note || "").trim();
  const digestFormattingRuntime = getDigestFormattingRuntime();
  const quickScanRows = buildUserQuickScanRows(items, {
    stripInlineHtml: digestFormattingRuntime.stripInlineHtml,
    topicVisual: digestFormattingRuntime.topicVisual,
    escapeHtml: digestFormattingRuntime.escapeHtml,
  }) || String(snapshot?.quick_scan || "").trim() || buildFallbackQuickScan(items);

  let html = digestFormattingRuntime.buildEmail(
    items,
    dateStr,
    quickScanRows,
    user?.token || "",
    false,
    false,
    depth,
    user,
    digestDateKey,
    digestId,
    {
      digestQuality: {
        score: Number.isFinite(Number(snapshot?.quality_score)) ? Number(snapshot.quality_score) : null,
        band: String(snapshot?.quality_band || "").trim() || null,
      },
      learningSummary: "",
      publicDigestUrl: "",
      editorialNote,
    }
  );

  if (user?.token) {
    const trackingPixel = buildOpenTrackingPixel(digestId, user.token, getBaseUrl());
    html = /<\/body>/i.test(html)
      ? html.replace(/<\/body>/i, `${trackingPixel}\n</body>`)
      : `${html}\n${trackingPixel}`;
  }

  const result = await sendEmail(email, subject, html, user?.token || null);
  if (!result || result.ok !== true) {
    throw new Error(result?.error || "email delivery failed");
  }

  const resentAt = new Date().toISOString();
  if (userId) {
    digestDeliveryRecordRuntime.updateDigestDeliveryRecord({
      digest_id: digestId,
      user_id: userId,
      date_et: digestDateKey,
      mode: String(snapshot?.mode || "scheduled").trim() || "scheduled",
      version: Math.max(1, Number(snapshot?.version || 1)),
      run_id: String(snapshot?.run_id || "").trim() || null,
      source: String(snapshot?.source || "").trim() || null,
      trigger: String(snapshot?.trigger || "").trim() || null,
      status: "sent",
      selected_at: snapshot?.selected_at || null,
      sending_at: snapshot?.sending_at || resentAt,
      sent_at: resentAt,
      failed_at: null,
      delivery_outcome: "delivered_manual_resend",
      attempt_count: Math.max(1, Number(snapshot?.attempt_count || 1)),
      retry_scheduled_for: null,
      error: null,
      channels: ["email"],
      depth,
      date_str: dateStr,
      quick_scan: String(snapshot?.quick_scan || "").trim() || buildFallbackQuickScan(items),
      subject_line: subject,
      editorial_note: editorialNote,
      regenerated_at: snapshot?.regenerated_at || null,
      regenerated_by: snapshot?.regenerated_by || null,
      quality_score: snapshot?.quality_score ?? null,
      quality_band: snapshot?.quality_band ?? null,
      requested_count: snapshot?.requested_count ?? null,
      freshness_block_count: snapshot?.freshness_block_count ?? 0,
      semantic_repeat_block_count: snapshot?.semantic_repeat_block_count ?? 0,
      alternate_queries_used: snapshot?.alternate_queries_used ?? 0,
      preferred_domains_count: snapshot?.preferred_domains_count ?? 0,
      preferred_candidate_count: snapshot?.preferred_candidate_count ?? 0,
      non_preferred_candidate_count: snapshot?.non_preferred_candidate_count ?? 0,
      final_selected_preferred_count: snapshot?.final_selected_preferred_count ?? 0,
      preferred_displaced_weak_count: snapshot?.preferred_displaced_weak_count ?? 0,
      derivative_suppressed_count: snapshot?.derivative_suppressed_count ?? 0,
      specialist_trade_beat_preferred_count: snapshot?.specialist_trade_beat_preferred_count ?? 0,
      platform_identity_ambiguity_count: snapshot?.platform_identity_ambiguity_count ?? 0,
      broader_retrieval_found_better_count: snapshot?.broader_retrieval_found_better_count ?? 0,
      coverage_gap_preferred_missing_count: snapshot?.coverage_gap_preferred_missing_count ?? 0,
      coverage_gap_preferred_weaker_count: snapshot?.coverage_gap_preferred_weaker_count ?? 0,
      search_budget_soft_calls: snapshot?.search_budget_soft_calls ?? 0,
      search_budget_hard_calls: snapshot?.search_budget_hard_calls ?? 0,
      search_budget_calls_used: snapshot?.search_budget_calls_used ?? 0,
      search_budget_exhausted: snapshot?.search_budget_exhausted === true,
      broad_fallback_topics_used: snapshot?.broad_fallback_topics_used ?? 0,
      zero_yield_retry_count: snapshot?.zero_yield_retry_count ?? 0,
      budget_stop_reason: snapshot?.budget_stop_reason ?? null,
      candidate_pool_before_dedup: snapshot?.candidate_pool_before_dedup ?? null,
      candidate_pool_after_dedup: snapshot?.candidate_pool_after_dedup ?? null,
      fallback_reason: snapshot?.fallback_reason ?? null,
      refill_count: snapshot?.refill_count ?? 0,
      thin_pool: snapshot?.thin_pool === true,
      dominant_failure_mode: snapshot?.dominant_failure_mode ?? null,
      items,
    });
  }

  return {
    subject,
    item_count: items.length,
    date_et: digestDateKey,
    status: snapshotStatus,
  };
}

async function regenerateDigestSnapshot({ user, snapshot, actor = "admin" }) {
  const userId = String(user?.chatId || "").trim();
  if (!userId) throw new Error("subscriber id is missing");

  const items = Array.isArray(snapshot?.items) ? snapshot.items.slice() : [];
  const selectedCount = Math.max(0, Number(snapshot?.selected_count || items.length));
  const snapshotStatus = String(snapshot?.status || "").trim().toLowerCase();
  const regenableStatuses = new Set(["sent", "failed", "selected", "sending"]);
  if (!items.length || selectedCount < 5 || !regenableStatuses.has(snapshotStatus)) {
    throw new Error("no regenable 5-item digest snapshot is available");
  }

  const digestDateKey = String(snapshot?.date_et || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(digestDateKey)) {
    throw new Error("digest snapshot is missing a valid ET date");
  }

  const digestId = String(snapshot?.digest_id || "").trim() || buildDigestId(digestDateKey, userId);
  const depth = String(snapshot?.depth || user?.preferences?.depth || user?.depth || "headline_plus_why").trim() || "headline_plus_why";
  const dateStr = String(snapshot?.date_str || "").trim() || formatDigestDateLabelFromKey(digestDateKey);
  const regenAt = new Date().toISOString();

  const enrichment = await getDigestDataRuntime().enrichItems(items, {});
  if (enrichment?.degraded === true) {
    const reason = String(enrichment?.degradation?.reason || "unknown").trim() || "unknown";
    throw new Error(`summary regeneration degraded (${reason}); snapshot left unchanged`);
  }

  const enrichedItems = Array.isArray(enrichment?.items) ? enrichment.items.slice() : [];
  if (enrichedItems.length !== items.length || enrichedItems.length < 5) {
    throw new Error("summary regeneration returned an invalid snapshot shape");
  }

  const quickScan = buildFallbackQuickScan(enrichedItems);
  const digestDate = new Date(`${digestDateKey}T12:00:00.000Z`);
  const subjectResult = await getDigestFormattingRuntime().generateLeadSubjectLine(enrichedItems[0] || null, digestDate);
  const noteResult = await getDigestFormattingRuntime().generateEditorialNote(enrichedItems);
  const subjectLine = String(subjectResult?.subject || "").trim() || buildAdminDigestResendSubject({ items: enrichedItems }, dateStr);
  const editorialNote = String(noteResult?.note || "").trim();

  const updateResult = digestDeliveryRecordRuntime.updateDigestDeliveryRecord({
    digest_id: digestId,
    user_id: userId,
    date_et: digestDateKey,
    mode: String(snapshot?.mode || "scheduled").trim() || "scheduled",
    version: Math.max(1, Number(snapshot?.version || 1)),
    run_id: String(snapshot?.run_id || "").trim() || null,
    source: String(snapshot?.source || "").trim() || null,
    trigger: String(snapshot?.trigger || "").trim() || null,
    status: snapshotStatus,
    selected_at: snapshot?.selected_at || null,
    sending_at: snapshot?.sending_at || null,
    sent_at: snapshot?.sent_at || null,
    failed_at: snapshot?.failed_at || null,
    delivery_outcome: snapshot?.delivery_outcome || null,
    attempt_count: snapshot?.attempt_count || 0,
    retry_scheduled_for: snapshot?.retry_scheduled_for || null,
    error: snapshotStatus === "failed" ? String(snapshot?.error || "").trim() || null : null,
    channels: Array.isArray(snapshot?.channels) ? snapshot.channels.slice() : [],
    depth,
    date_str: dateStr,
    quick_scan: quickScan,
    subject_line: subjectLine,
    editorial_note: editorialNote,
    regenerated_at: regenAt,
    regenerated_by: String(actor || "admin").trim() || "admin",
    quality_score: snapshot?.quality_score ?? null,
    quality_band: snapshot?.quality_band ?? null,
    requested_count: snapshot?.requested_count ?? null,
    freshness_block_count: snapshot?.freshness_block_count ?? 0,
    semantic_repeat_block_count: snapshot?.semantic_repeat_block_count ?? 0,
    alternate_queries_used: snapshot?.alternate_queries_used ?? 0,
    preferred_domains_count: snapshot?.preferred_domains_count ?? 0,
    preferred_candidate_count: snapshot?.preferred_candidate_count ?? 0,
    non_preferred_candidate_count: snapshot?.non_preferred_candidate_count ?? 0,
    final_selected_preferred_count: snapshot?.final_selected_preferred_count ?? 0,
    preferred_displaced_weak_count: snapshot?.preferred_displaced_weak_count ?? 0,
    derivative_suppressed_count: snapshot?.derivative_suppressed_count ?? 0,
    specialist_trade_beat_preferred_count: snapshot?.specialist_trade_beat_preferred_count ?? 0,
    platform_identity_ambiguity_count: snapshot?.platform_identity_ambiguity_count ?? 0,
    broader_retrieval_found_better_count: snapshot?.broader_retrieval_found_better_count ?? 0,
    coverage_gap_preferred_missing_count: snapshot?.coverage_gap_preferred_missing_count ?? 0,
    coverage_gap_preferred_weaker_count: snapshot?.coverage_gap_preferred_weaker_count ?? 0,
    search_budget_soft_calls: snapshot?.search_budget_soft_calls ?? 0,
    search_budget_hard_calls: snapshot?.search_budget_hard_calls ?? 0,
    search_budget_calls_used: snapshot?.search_budget_calls_used ?? 0,
    search_budget_exhausted: snapshot?.search_budget_exhausted === true,
    broad_fallback_topics_used: snapshot?.broad_fallback_topics_used ?? 0,
    zero_yield_retry_count: snapshot?.zero_yield_retry_count ?? 0,
    budget_stop_reason: snapshot?.budget_stop_reason || null,
    candidate_pool_before_dedup: snapshot?.candidate_pool_before_dedup ?? null,
    candidate_pool_after_dedup: snapshot?.candidate_pool_after_dedup ?? null,
    fallback_reason: snapshot?.fallback_reason || null,
    refill_count: snapshot?.refill_count ?? 0,
    thin_pool: snapshot?.thin_pool === true,
    dominant_failure_mode: snapshot?.dominant_failure_mode || null,
    selected_count: selectedCount,
    available_count: snapshot?.available_count ?? selectedCount,
    internal_thinness_label: snapshot?.internal_thinness_label || null,
    withheld_reason: snapshot?.withheld_reason || null,
    items: enrichedItems,
  });

  if (!updateResult?.ok) {
    throw new Error(updateResult?.reason || "failed to persist regenerated digest snapshot");
  }

  return {
    subject: subjectLine,
    item_count: enrichedItems.length,
    date_et: digestDateKey,
    status: snapshotStatus,
    regenerated_at: regenAt,
    editorial_note: editorialNote,
  };
}

const readArchiveFilesForDir = (archiveDir) => readArchiveFiles({
  fs,
  archiveDir,
});

const getAllowedArchiveDatesForUser = (user, archiveDir, files) => getAllowedArchiveDates({
  user,
  archiveDir,
  files,
  fs,
  path,
  writeUser,
});
const digestDeliveryRecordRuntime = createDigestDeliveryRecordRuntime({
  APP_ROOT,
  digestRecordsDir: runtimePaths.digestRecordsDir,
  fs,
  path,
  log: (message) => webLogger.warn("web.digest_records", { message: String(message || "") }),
});
const archiveDigestStatsRuntime = createArchiveDigestStatsRuntime({
  APP_ROOT,
  archiveDir: runtimePaths.archiveDir,
  fs,
  path,
  readArchiveFiles: readArchiveFilesForDir,
  getAllowedArchiveDates: getAllowedArchiveDatesForUser,
  loadLatestDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadLatestDigestSnapshot(...args),
  loadEngagementEvents,
});
const runtimeStateInspector = createRuntimeStateInspector({
  fs,
  childProcess,
  os,
  processRef: process,
  runtimePaths,
  store: webStore,
  loadCostRunsNewest,
  loadEngagementEvents,
  digestDeliveryRecordRuntime,
});
const buildRecentDigestsExport = createRecentDigestsExporter({
  loadCostRunsNewest,
  allUsers,
  loadEngagementEvents,
  loadDigestSnapshotByRunId: (...args) => digestDeliveryRecordRuntime.loadDigestSnapshotByRunId(...args),
  loadLatestDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadLatestDigestSnapshot(...args),
});
const runtimePathAlignment = describeRuntimePathAlignment(runtimePaths);
if (!runtimePathAlignment.ok) {
  webLogger.error("web.runtime_state.mismatch", {
    outcome: "mismatch",
    divergent_components: runtimePathAlignment.divergent_components,
    component_roots: runtimePathAlignment.component_roots,
  });
}

// sendWelcomeEmail is defined in mailer.js and imported above

const webRouteDependencies = buildWebRouteDependencies({
  request: {
    requireJsonBody,
    json,
    getClientIp,
    checkRateLimit,
    checkMagicLinkRateLimit,
    checkSettingsRateLimit,
    checkLoginRate,
  },
  auth: {
    allUsers,
    findUserByToken,
    isAdminAuthed,
    getAdminActor,
    verifyAdminPassword,
    createAdminSession,
    clearAdminSessionByRequest,
  },
  mail: {
    sendReferralThankYou,
    sendWelcomeEmail,
    sendMagicLinkEmail,
    sendEmail,
  },
  digest: {
    normalizeReferralToken,
    generateToken,
    writeUser,
    deleteUser,
    startDigestTrigger,
    getBaseUrl,
    DEFAULT_TOPICS,
    MAX_CUSTOM_KEYWORDS,
    allowExampleSignups,
    PROTECTED_FIELDS,
    INDUSTRY_TOPICS,
    digestRunStatus,
    getCachedOrRefreshSchedulerHeartbeat,
    decodeDigestIdParam,
    buildDigestId,
    toEtDateKey,
    appendWebEngagementEvent,
    sendTransparentGif,
    normalizeEngagementUrl,
    normalizeBookmarkUrl,
    emitIgnoredEventsIfDue,
    loadCostRunsNewest,
    loadEngagementEvents,
    parseIsoTs,
    computeFeedbackTrend,
    readJsonLineLog,
    normalizeDeliveryTimeInput,
    logAdminMessageEvent,
    summarizeMessage,
    hashText,
    formatTimeEt,
    parseEtNowParts,
    computeNextDeliveryEt,
    formatDaysLabel,
    computeQualityTrend,
    regenerateDigestSnapshot,
    resendDigestSnapshot,
  },
  archive: {
    path,
    fs,
    APP_ROOT,
    archiveDir: runtimePaths.archiveDir,
    readArchiveFilesForDir,
    getAllowedArchiveDatesForUser,
    archiveRelevanceScore,
    countArchiveDigestsForUser: (...args) => archiveDigestStatsRuntime.countArchiveDigestsForUser(...args),
    loadCurrentDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadCurrentDigestSnapshot(...args),
    loadDigestSnapshotByRunId: (...args) => digestDeliveryRecordRuntime.loadDigestSnapshotByRunId(...args),
    loadLatestDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadLatestDigestSnapshot(...args),
  },
  registry: {
    sourceRegistryPath: sourceRegistryRuntime.sourceRegistryPath,
    loadSourceRegistry: () => sourceRegistryRuntime.loadSourceRegistry(),
    inspectStandardTopicBrokerConfig: () => standardTopicBrokerRuntime.inspectStandardTopicBrokerConfig(),
    buildSourceRegistryMap: (registry) => sourceRegistryRuntime.buildRegistryMap(registry),
    listSourceRegistryEntries: () => sourceRegistryRuntime.listSourceRegistryEntries(),
    getSourceRegistryEntry: (domain) => sourceRegistryRuntime.getSourceRegistryEntry(domain),
    getSourceRegistryIdentityEntry: (identityKey) => sourceRegistryRuntime.getSourceRegistryIdentityEntry(identityKey),
    updateBrokerTopicConfig: (input) => standardTopicBrokerRuntime.updateBrokerTopicConfig(input),
    updateBrokerSourceConfig: (input) => standardTopicBrokerRuntime.updateBrokerSourceConfig(input),
    upsertSourceRegistryEntry: (input, meta) => sourceRegistryRuntime.upsertSourceRegistryEntry(input, meta),
    resetSourceRegistryEntry: (domain, meta) => sourceRegistryRuntime.resetSourceRegistryEntry(domain, meta),
    resetSourceRegistryIdentityEntry: (identityKey, meta) => sourceRegistryRuntime.resetSourceRegistryIdentityEntry(identityKey, meta),
    setAdminSourceRegistry,
  },
  public: {
    assetVersion: getWebAssetVersion(),
    renderPublicDigestMissingPage,
    formatPublicDigestDateLabel,
    renderPublicDigestPageTemplate,
    serveFile,
    WEB_DIR,
  },
  admin: {
    CONFIG,
    logAdminActionEvent,
    ADMIN_MESSAGE_LOG,
    ADMIN_ACTION_LOG,
    DIGEST_INCIDENT_LOG,
    maskEmail,
    logAdminMessageEvent,
    summarizeMessage,
    hashText,
    escapeHtml,
    requestSchedulerWorkerRestart,
    forkSchedulerWorker,
    getRuntimeStateHealth: () => runtimeStateInspector.getRuntimeStateHealth(),
    getRuntimeStateDiagnostics: () => runtimeStateInspector.getRuntimeStateDiagnostics(),
    buildRecentDigestsExport,
    digestAuditDir: runtimePaths.digestAuditDir,
    digestTuningPath: runtimePaths.digestTuningPath,
    editorialOverridesPath: runtimePaths.editorialOverridesPath,
    todayStr: new Date().toISOString().slice(0, 10),
    formatEtDateKey: toEtDateKey,
  },
});

const handleWebRequest = createWebRequestHandler({
  routeDependencies: webRouteDependencies,
  ensureStoreInitialized,
  getServerPort,
  applyCanonicalHostPolicy,
  applyResponseCorsPolicy,
  handleCorsPreflightPolicy,
  handleRequestErrorPolicy,
  getRequestHost,
  getRequestScheme,
  canonicalHost: CANONICAL_HOST,
  publicHosts: PUBLIC_HOSTS,
  trustedCorsOrigins: TRUSTED_CORS_ORIGINS,
  onError: (err, req) => {
    const requestRunId = `${WEB_PROCESS_RUN_ID}:${Date.now()}`;
    webLogger.error("web.request.error", {
      run_id: requestRunId,
      outcome: "failed",
      method: String(req?.method || ""),
      path: String(req?.url || ""),
      message: String(err?.message || err || "unknown error"),
      stack: String(err?.stack || ""),
    });
  },
});

let crashProtectionInstalled = false;
function installCrashProtection() {
  if (crashProtectionInstalled) return;
  crashProtectionInstalled = true;
  process.on("uncaughtException", (err) => {
    webLogger.error("web.process.uncaught_exception", {
      outcome: "crash",
      provider: "node",
      message: String(err?.message || err || "unknown error"),
      stack: String(err?.stack || ""),
    });
  });
  process.on("unhandledRejection", (err) => {
    webLogger.error("web.process.unhandled_rejection", {
      outcome: "crash",
      provider: "node",
      message: String(err?.message || err || "unknown rejection"),
      stack: String(err?.stack || ""),
    });
  });
}

module.exports = {
  ensureStoreInitialized,
  getServerPort,
  handleWebRequest,
  installCrashProtection,
};
