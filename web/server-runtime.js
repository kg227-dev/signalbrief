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
const { sendEmail, sendWelcomeEmail, sendReferralThankYou, signUnsubEmail } = require("../src/platform/mailer");
const {
  appendEngagementEventChecked,
  buildDigestId,
  normalizeUrl: normalizeEngagementUrl,
  emitIgnoredEventsIfDue,
  loadEngagementEvents,
} = require("../src/domains/engagement");
const { computeQualityTrend } = require("../src/domains/digest");
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
  verifyAdminPassword,
  createAdminSession,
  clearAdminSessionByRequest,
  getAdminActor,
  isAdminAuthed,
  checkLoginRate,
} = require("./admin-auth");
const { createAdminOpsService } = require("./services/admin-ops");
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
  WEB_DIR,
  APP_ROOT,
  CANONICAL_HOST,
  PUBLIC_HOSTS,
  getServerPort,
  getBaseUrl,
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

const webStore = createStore();
const { initStore, readUser, writeUser, deleteUser, allUsers, generateToken, findUserByToken } = webStore;
const CONFIG = loadConfig();

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

function requestSchedulerWorkerRestart({
  reason = "manual_admin_request",
  source = "admin_ui",
  requestedBy = "admin",
} = {}) {
  const requestId = `restart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const requestedAt = new Date().toISOString();
  const payload = {
    restart_worker: {
      request_id: requestId,
      requested_at: requestedAt,
      requested_by: String(requestedBy || "admin"),
      reason: String(reason || "manual_admin_request"),
      source: String(source || "admin_ui"),
    },
  };
  const dir = path.dirname(SCHEDULER_CONTROL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULER_CONTROL_FILE, JSON.stringify(payload, null, 2));
  return {
    request_id: requestId,
    requested_at: requestedAt,
    control_file: SCHEDULER_CONTROL_FILE,
  };
}

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
  getToken: () => CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken,
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
  signUnsubEmail,
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
    const host = getRequestHost(req);
    const scheme = getRequestScheme(req);

    // Enforce a single canonical public origin for SEO + cache consistency.
    if (PUBLIC_HOSTS.has(host) && (host !== CANONICAL_HOST || scheme !== "https")) {
      const location = `https://${CANONICAL_HOST}${pathname}${url.search}`;
      res.writeHead(301, {
        Location: location,
        "Cache-Control": "public, max-age=300",
      });
      return res.end();
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
      return res.end();
    }

    const routeCtx = { req, res, url, pathname };
    const routeHandled = await handleDomainRoute(routeCtx);
    if (routeHandled !== false) return;

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    console.error(`[server error] ${req.method} ${req.url} →`, err.message);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal server error");
    }
  }
}

let crashProtectionInstalled = false;
function installCrashProtection() {
  if (crashProtectionInstalled) return;
  crashProtectionInstalled = true;
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err.message, err.stack);
  });
  process.on("unhandledRejection", (err) => {
    console.error("[unhandledRejection]", err);
  });
}

module.exports = {
  ensureStoreInitialized,
  getServerPort,
  handleWebRequest,
  installCrashProtection,
};
