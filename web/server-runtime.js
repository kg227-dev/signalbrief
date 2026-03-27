const fs = require("fs");
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
  createDigestDeliveryRecordRuntime,
  createDigestFormattingRuntime,
  normalizeTopicToken,
} = require("../src/domains/digest");
const {
  digestRunStatus,
  startDigestTrigger,
} = require("../src/jobs/digest-runner-runtime");
const {
  estimateCost: estimateSandboxCost,
  runPipeline: runSandboxPipeline,
} = require("../src/sandbox-pipeline-runtime");
const {
  createAdminAuthSessionPolicy,
} = require("./server-runtime-auth-session-policy-runtime");
const { createAdminOpsService } = require("./services/admin-ops");
const { createRecentDigestsExporter } = require("./services/admin-recent-digests-export-runtime");
const { createRuntimeStateInspector } = require("./services/runtime-state-runtime");
const { createSchedulerWorkerRestartRequester } = require("./server-runtime-scheduler-control-runtime");
const { getClientIp, getRequestHost, getRequestScheme } = require("./services/request-metadata");
const { createSignupRateLimiter, createMagicLinkRateLimiter, createSettingsRateLimiter } = require("./services/web-rate-limit");
const { archiveRelevanceScore } = require("./services/archive-scoring");
const { createArchiveDigestStatsRuntime } = require("./services/archive-digest-stats-runtime");
const {
  parseEtNowParts,
  formatTimeEt,
  normalizeDeliveryTimeInput,
  formatDaysLabel,
  computeNextDeliveryEt,
} = require("./services/delivery-schedule");
const { createServerRouteDependencies } = require("./server-runtime-deps-runtime");
const { createRouteBootstrapHandler } = require("./server-runtime-route-bootstrap-runtime");
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
const { createPreferredSourceRegistryRuntime } = require("../src/runtime/preferred-source-registry-runtime");
const { createStandardTopicBrokerRuntime } = require("../src/runtime/standard-topic-broker-runtime");
const { createRetrievalEvalStorageRuntime } = require("../src/eval/retrieval/storage-runtime");
const { setAdminSourceRegistry } = require("../src/domains/digest");
const { createAdminRetrievalEvalRuntime } = require("./services/admin-retrieval-eval-runtime");

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
  nodeEnv: process.env.NODE_ENV,
  standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
});
const preferredSourceRegistryRuntime = createPreferredSourceRegistryRuntime({
  fs,
  appRoot: APP_ROOT,
  env: process.env,
  nodeEnv: process.env.NODE_ENV,
  preferredSourcesPath: runtimePaths.preferredSourcesPath,
  standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
});
const standardTopicBrokerRuntime = createStandardTopicBrokerRuntime({
  fs,
  appRoot: APP_ROOT,
  env: process.env,
  nodeEnv: process.env.NODE_ENV,
  standardTopicBrokerSourcesPath: runtimePaths.standardTopicBrokerSourcesPath,
  bundledStandardTopicBrokerSourcesPath: path.join(APP_ROOT, "config", "standard-topic-broker-sources.json"),
});
const retrievalEvalStorageRuntime = createRetrievalEvalStorageRuntime({
  fs,
  path,
  appRoot: APP_ROOT,
});
const adminRetrievalEvalRuntime = createAdminRetrievalEvalRuntime({
  storage: retrievalEvalStorageRuntime,
  fs,
  appRoot: APP_ROOT,
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

function appendSandboxCostLog(entry) {
  try {
    const dir = path.dirname(COST_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(COST_LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch (_e) {
    // non-critical — sandbox cost logging failure should not break the response
  }
}

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

const allowExampleSignups = (
  String(process.env.ALLOW_EXAMPLE_SIGNUPS || "").trim() === "1"
  || String(process.env.NODE_ENV || "").toLowerCase() !== "production"
);

let digestEmailTemplateCache = null;
let digestFormattingRuntimeCache = null;

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
      httpsPostWithRetry: async () => {
        throw new Error("AI formatting is disabled for admin digest resend");
      },
      buildPublicDigestUrl: () => "",
      normalizeTopicToken,
    });
  }
  return digestFormattingRuntimeCache;
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
    .map((item) => String(item?.headline || "").trim())
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
  const depth = String(snapshot?.depth || user?.preferences?.depth || user?.depth || "headline_plus_why").trim() || "headline_plus_why";
  const dateStr = String(snapshot?.date_str || "").trim() || formatDigestDateLabelFromKey(digestDateKey);
  const quickScan = String(snapshot?.quick_scan || "").trim() || buildFallbackQuickScan(items);
  const subject = buildAdminDigestResendSubject(snapshot, dateStr);

  let html = getDigestFormattingRuntime().buildEmail(
    items,
    dateStr,
    quickScan,
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
      editorialNote: "",
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

  return {
    subject,
    item_count: items.length,
    date_et: digestDateKey,
    status: snapshotStatus,
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

const {
  handleCoreApiRoute,
  handleAdminApiRoute,
  handlePublicStaticRoute,
} = createServerRouteDependencies({
  requireJsonBody,
  json,
  getClientIp,
  checkRateLimit,
  allUsers,
  findUserByToken,
  normalizeReferralToken,
  generateToken,
  writeUser,
  deleteUser,
  sendReferralThankYou,
  sendWelcomeEmail,
  startDigestTrigger,
  getBaseUrl,
  DEFAULT_TOPICS,
  MAX_CUSTOM_KEYWORDS,
  allowExampleSignups,
  PROTECTED_FIELDS,
  isAdminAuthed,
  getAdminActor,
  logAdminActionEvent,
  INDUSTRY_TOPICS,
  digestRunStatus,
  getCachedOrRefreshSchedulerHeartbeat,
  readArchiveFilesForDir,
  getAllowedArchiveDatesForUser,
  archiveRelevanceScore,
  path,
  fs,
  APP_ROOT,
  archiveDir: runtimePaths.archiveDir,
  decodeDigestIdParam,
  buildDigestId,
  toEtDateKey,
  appendWebEngagementEvent,
  sendTransparentGif,
  normalizeEngagementUrl,
  normalizeBookmarkUrl,
  sendMagicLinkEmail,
  checkMagicLinkRateLimit,
  checkSettingsRateLimit,
  checkLoginRate,
  countArchiveDigestsForUser: (...args) => archiveDigestStatsRuntime.countArchiveDigestsForUser(...args),
  loadCurrentDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadCurrentDigestSnapshot(...args),
  loadDigestSnapshotByRunId: (...args) => digestDeliveryRecordRuntime.loadDigestSnapshotByRunId(...args),
  loadLatestDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadLatestDigestSnapshot(...args),
  resendDigestSnapshot,
  CONFIG,
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  emitIgnoredEventsIfDue,
  loadCostRunsNewest,
  loadEngagementEvents,
  parseIsoTs,
  computeFeedbackTrend,
  readJsonLineLog,
  ADMIN_MESSAGE_LOG,
  ADMIN_ACTION_LOG,
  DIGEST_INCIDENT_LOG,
  maskEmail,
  normalizeDeliveryTimeInput,
  logAdminMessageEvent,
  summarizeMessage,
  hashText,
  escapeHtml,
  sendEmail,
  formatTimeEt,
  parseEtNowParts,
  computeNextDeliveryEt,
  formatDaysLabel,
  computeQualityTrend,
  estimateSandboxCost,
  runSandboxPipeline,
  appendSandboxCostLog,
  requestSchedulerWorkerRestart,
  forkSchedulerWorker,
  getRuntimeStateHealth: () => runtimeStateInspector.getRuntimeStateHealth(),
  assetVersion: getWebAssetVersion(),
  renderPublicDigestMissingPage,
  formatPublicDigestDateLabel,
  renderPublicDigestPageTemplate,
  serveFile,
  WEB_DIR,
  getRuntimeStateDiagnostics: () => runtimeStateInspector.getRuntimeStateDiagnostics(),
  buildRecentDigestsExport,
  sourceRegistryPath: sourceRegistryRuntime.sourceRegistryPath,
  preferredSourcesPath: runtimePaths.preferredSourcesPath,
  bundledPreferredSourcesPath: preferredSourceRegistryRuntime.bundledPreferredSourcesPath,
  loadSourceRegistry: () => sourceRegistryRuntime.loadSourceRegistry(),
  loadPreferredSourceRegistry: () => preferredSourceRegistryRuntime.loadPreferredSourceRegistry(),
  inspectPreferredSourceRegistry: () => preferredSourceRegistryRuntime.inspectPreferredSourceRegistry(),
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
  loadRetrievalEvalRuns: (limit) => adminRetrievalEvalRuntime.listRuns(limit),
  loadRetrievalEvalRun: (runId) => adminRetrievalEvalRuntime.loadRun(runId),
  loadRetrievalEvalStatus: () => adminRetrievalEvalRuntime.loadStatus(),
  getAdminActor,
  digestAuditDir: runtimePaths.digestAuditDir,
  digestTuningPath: runtimePaths.digestTuningPath,
  editorialOverridesPath: runtimePaths.editorialOverridesPath,
  todayStr: new Date().toISOString().slice(0, 10),
  formatEtDateKey: toEtDateKey,
});
const handleDomainRoute = createRouteBootstrapHandler({
  handleCoreApiRoute,
  handleAdminApiRoute,
  handlePublicStaticRoute,
});

async function handleWebRequest(req, res) {
  try {
    ensureStoreInitialized();
    const port = getServerPort();
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    // Enforce a single canonical public origin for SEO + cache consistency.
    const redirected = applyCanonicalHostPolicy({
      req,
      res,
      url,
      pathname,
      getRequestHost,
      getRequestScheme,
      canonicalHost: CANONICAL_HOST,
      publicHosts: PUBLIC_HOSTS,
    });
    if (redirected) return;

    applyResponseCorsPolicy({
      req,
      res,
      trustedCorsOrigins: TRUSTED_CORS_ORIGINS,
    });

    // CORS preflight
    const preflightHandled = handleCorsPreflightPolicy({
      req,
      res,
      trustedCorsOrigins: TRUSTED_CORS_ORIGINS,
    });
    if (preflightHandled) return;

    const routeCtx = { req, res, url, pathname };
    const routeHandled = await handleDomainRoute(routeCtx);
    if (routeHandled !== false) return;

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    const requestRunId = `${WEB_PROCESS_RUN_ID}:${Date.now()}`;
    webLogger.error("web.request.error", {
      run_id: requestRunId,
      outcome: "failed",
      method: String(req?.method || ""),
      path: String(req?.url || ""),
      message: String(err?.message || err || "unknown error"),
      stack: String(err?.stack || ""),
    });
    handleRequestErrorPolicy({ req, res, error: err, logger: () => {} });
  }
}

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
