const https = require("https");
const fs = require("fs");
const path = require("path");
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
} = require("../src/platform/mailer");
const {
  appendEngagementEventChecked,
  buildDigestId,
  normalizeUrl: normalizeEngagementUrl,
  emitIgnoredEventsIfDue,
  loadEngagementEvents,
} = require("../src/domains/engagement");
const { computeQualityTrend } = require("../src/domains/digest");
const { createDigestDeliveryRecordRuntime } = require("../src/domains/digest");
const {
  digestRunStatus,
  queueDigestTrigger,
  runDigestTrigger,
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
const { createSchedulerWorkerRestartRequester } = require("./server-runtime-scheduler-control-runtime");
const { getClientIp, getRequestHost, getRequestScheme } = require("./services/request-metadata");
const { createSignupRateLimiter } = require("./services/web-rate-limit");
const { blankReengagementState, resetReengagementState } = require("./services/reengagement-state");
const { archiveRelevanceScore } = require("./services/archive-scoring");
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
  getArchiveLegacyDeprecationDeadlineUtc,
  getSchedulerHeartbeatFile,
  getSchedulerControlFile,
  getWebAssetVersion,
} = require("./server-runtime-env-runtime");
const {
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
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
  createSendTelegramText,
} = require("./server-runtime-utils-runtime");
const { createStructuredLogger } = require("../src/runtime/structured-logger-runtime");

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

const ADMIN_MESSAGE_LOG = path.join(__dirname, "../data/admin-message-log.json");
const ADMIN_ACTION_LOG = path.join(__dirname, "../data/admin-action-log.json");
const COST_LOG_PATH = path.join(__dirname, "../data/cost-log.json");
const ARCHIVE_LEGACY_USAGE_LOG = path.join(__dirname, "../data/archive-legacy-usage.jsonl");
const SCHEDULER_CONTROL_FILE = getSchedulerControlFile();
const requestSchedulerWorkerRestart = createSchedulerWorkerRestartRequester({
  fs,
  path,
  schedulerControlFile: SCHEDULER_CONTROL_FILE,
});

const appendWebEngagementEvent = (payload, context) => (
  appendEngagementEventChecked(payload, { scope: "web", context })
);

const {
  isLegacyArchiveEndpointEnabled,
  recordLegacyArchiveUsage,
  readJsonLineLog,
  parseIsoTs,
  computeFeedbackTrend,
  getRecentAutoAdjustmentsForUser,
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
    archiveLegacyUsageLog: ARCHIVE_LEGACY_USAGE_LOG,
  },
  requestContext: {
    getRequestHost,
    getClientIp,
    getAdminActor,
  },
  loaders: {
    loadEngagementEvents,
  },
  flags: {
    archiveLegacyDeprecationDeadlineUtc: getArchiveLegacyDeprecationDeadlineUtc,
  },
});
const sendMagicLinkEmail = createSendMagicLinkEmail({
  sendEmail,
  getBaseUrl,
});

const sendTelegramText = createSendTelegramText({
  https,
  getToken: () => CONFIG.keys.signalBriefBotToken,
});

const allowExampleSignups = (
  String(process.env.ALLOW_EXAMPLE_SIGNUPS || "").trim() === "1"
  || String(process.env.NODE_ENV || "").toLowerCase() !== "production"
);

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
  fs,
  path,
  log: (message) => webLogger.warn("web.digest_records", { message: String(message || "") }),
});

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
  queueDigestTrigger,
  runDigestTrigger,
  startDigestTrigger,
  getBaseUrl,
  DEFAULT_TOPICS,
  MAX_CUSTOM_KEYWORDS,
  allowExampleSignups,
  PROTECTED_FIELDS,
  isAdminAuthed,
  logAdminActionEvent,
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  digestRunStatus,
  getCachedOrRefreshSchedulerHeartbeat,
  blankReengagementState,
  isLegacyArchiveEndpointEnabled,
  recordLegacyArchiveUsage,
  getArchiveLegacyDeprecationDeadlineUtc,
  readArchiveFilesForDir,
  getAllowedArchiveDatesForUser,
  archiveRelevanceScore,
  path,
  fs,
  APP_ROOT,
  decodeDigestIdParam,
  buildDigestId,
  toEtDateKey,
  appendWebEngagementEvent,
  resetReengagementState,
  sendTransparentGif,
  normalizeEngagementUrl,
  normalizeBookmarkUrl,
  sendMagicLinkEmail,
  checkLoginRate,
  loadLatestDigestSnapshot: (...args) => digestDeliveryRecordRuntime.loadLatestDigestSnapshot(...args),
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
  maskEmail,
  getRecentAutoAdjustmentsForUser,
  normalizeDeliveryTimeInput,
  logAdminMessageEvent,
  summarizeMessage,
  hashText,
  escapeHtml,
  sendEmail,
  sendTelegramText,
  formatTimeEt,
  parseEtNowParts,
  computeNextDeliveryEt,
  formatDaysLabel,
  computeQualityTrend,
  estimateSandboxCost,
  runSandboxPipeline,
  requestSchedulerWorkerRestart,
  assetVersion: getWebAssetVersion(),
  renderPublicDigestMissingPage,
  formatPublicDigestDateLabel,
  renderPublicDigestPageTemplate,
  serveFile,
  WEB_DIR,
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
