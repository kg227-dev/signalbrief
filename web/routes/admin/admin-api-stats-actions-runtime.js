const fs = require("fs");
const path = require("path");

const { isDebugWebServerEnabled } = require("../../server-runtime-env-runtime");
const {
  buildAdminRoster,
  buildDeliveryOperationsSnapshot,
  buildDeliveryReliabilitySnapshot,
  buildDeliveryWarnings,
  buildDigestInsights,
  buildEngagementMetrics,
  buildHistoricalAvgCostPerRun,
  buildMonthRunSummary,
  buildPerUserCostRollup,
  buildProjectedWindowCostSummary,
  buildReferrals,
  buildTrailingWindowCostSummary,
  enrichRunsWithDigestMetadata,
  expandRunsByRecipient,
  summarizeRosterQuality,
} = require("../../services/admin");
const {
  attachDiagnosisToAuditDocument,
  buildProductBlockerFromAuditDoc,
} = require("../../../src/runtime/root-cause-diagnosis-runtime");
const {
  mapAdminMessages,
  buildSummaryPayload,
  buildHealthPayload,
} = require("./admin-api-stats-payload-runtime");

function resolveSchedulerHeartbeatLoader({
  getCachedOrRefreshSchedulerHeartbeat,
  readSchedulerHeartbeat,
}) {
  if (typeof getCachedOrRefreshSchedulerHeartbeat === "function") {
    return getCachedOrRefreshSchedulerHeartbeat;
  }
  if (typeof readSchedulerHeartbeat === "function") {
    return readSchedulerHeartbeat;
  }
  return () => null;
}

function emitIgnoredBackfillSafe({
  emitIgnoredEventsIfDue,
  config,
}) {
  const fallback = { emitted: 0, considered: 0 };
  try {
    return emitIgnoredEventsIfDue({
      window_hours: Number(config?.digest?.ignoredWindowHours || 24),
      max_age_days: 45,
    }) || fallback;
  } catch (error) {
    if (isDebugWebServerEnabled()) {
      console.warn(`[web] ignored-events backfill failed: ${error.message}`);
    }
    return fallback;
  }
}

function loadLatestAuditProductBlocker(digestAuditDir) {
  const auditDir = String(digestAuditDir || "").trim();
  if (!auditDir) return null;
  try {
    const latestFile = fs.readdirSync(auditDir)
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort()
      .reverse()[0];
    if (!latestFile) return null;
    const raw = fs.readFileSync(path.join(auditDir, latestFile), "utf8");
    const auditDoc = attachDiagnosisToAuditDocument(JSON.parse(raw));
    return buildProductBlockerFromAuditDoc(auditDoc);
  } catch {
    return null;
  }
}

function buildAdminStatsPayload({
  deps,
  loadSchedulerHeartbeat,
  ignoredBackfill,
}) {
  const {
    loadCostRunsNewest,
    allUsers,
    loadEngagementEvents,
    parseIsoTs,
    computeFeedbackTrend,
    digestRunStatus,
    readJsonLineLog,
    ADMIN_MESSAGE_LOG,
    DIGEST_INCIDENT_LOG,
    countArchiveDigestsForUser,
    maskEmail,
    computeNextDeliveryEt,
    formatDaysLabel,
    computeQualityTrend,
    parseEtNowParts,
    CONFIG,
    getRuntimeStateDiagnostics,
    buildRecentDigestsExport,
    digestAuditDir,
  } = deps;

  const usersAll = allUsers();
  const recipientTokenById = new Map();
  for (const user of usersAll) {
    const token = String(user?.token || "").trim();
    if (!token) continue;
    const emailKey = String(user?.email || "").toLowerCase().trim();
    if (emailKey) recipientTokenById.set(emailKey, token);
    const chatKey = String(user?.chatId || "").toLowerCase().trim();
    if (chatKey) recipientTokenById.set(chatKey, token);
  }

  const runsRaw = loadCostRunsNewest();
  const engagementEventsForRuns = loadEngagementEvents({ max_age_days: 120, dedupe: false });
  const runs = enrichRunsWithDigestMetadata(runsRaw, engagementEventsForRuns, {
    recipientTokenById,
  });
  const runsForTable = enrichRunsWithDigestMetadata(
    expandRunsByRecipient(runsRaw),
    engagementEventsForRuns,
    { recipientTokenById }
  );
  const engagementEvents = [];
  const seenEventKeys = new Set();
  for (const event of engagementEventsForRuns) {
    const key = String(event?.event_key || "");
    if (!key || seenEventKeys.has(key)) continue;
    seenEventKeys.add(key);
    engagementEvents.push(event);
  }
  const now = new Date();
  const monthPrefix = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
  const monthLabel = now.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const {
    monthRuns,
    monthDeliveries,
    monthUniqueUsersLogSize,
    monthTotalRuns,
    monthTotalDeliveries,
    monthTotalUniqueUsersLogSize,
  } = buildMonthRunSummary(runs, monthPrefix);

  const referrals = buildReferrals(usersAll);
  const engagement = buildEngagementMetrics({
    usersAll,
    referrals,
    loadEngagementEvents: () => engagementEvents,
    parseIsoTs,
  });
  const perUser = buildPerUserCostRollup(runs);

  const recentDigests = typeof buildRecentDigestsExport === "function"
    ? buildRecentDigestsExport({ days: 7 })
    : { rows: [] };
  const roster = buildAdminRoster({
    usersAll,
    countArchiveDigestsForUser,
    computeQualityTrend,
    formatDaysLabel,
    computeNextDeliveryEt,
    recentDigestRows: recentDigests.rows,
  });
  const activeUsersCount = roster.filter((user) => user.status === "active").length;
  const monthUsersServedFromRoster = roster.filter((user) => user.last_digest && user.last_digest.startsWith(monthPrefix)).length;

  const deliveryWarnings = buildDeliveryWarnings(roster);
  const deliveryReliability = buildDeliveryReliabilitySnapshot({
    runs,
    roster,
    parseEtNowParts,
  });
  const deliveryOperations = buildDeliveryOperationsSnapshot({
    runs,
    roster,
    parseEtNowParts,
    readJsonLineLog,
    digestIncidentLog: DIGEST_INCIDENT_LOG,
  });
  const digestRun = digestRunStatus();
  const schedulerWorker = loadSchedulerHeartbeat();
  const adminMessages = mapAdminMessages({
    readJsonLineLog,
    adminMessageLog: ADMIN_MESSAGE_LOG,
    maskEmail,
  });

  const quality = summarizeRosterQuality(roster);
  const feedbackTrend = computeFeedbackTrend(usersAll);
  const nowParts = parseEtNowParts();
  const trailing7dCost = buildTrailingWindowCostSummary(runs, {
    nowParts,
    days: 7,
  });
  const historicalAvg = buildHistoricalAvgCostPerRun(runs, { nowParts, days: 30 });
  const projected7dCost = buildProjectedWindowCostSummary({
    roster,
    nowParts,
    config: CONFIG,
    days: 7,
    historicalAvg,
  });
  const summary = buildSummaryPayload({
    runs,
    monthRuns,
    monthDeliveries,
    monthLabel,
    monthUsersServedFromRoster,
    monthUniqueUsersLogSize,
    monthTotalRuns,
    monthTotalDeliveries,
    monthTotalUniqueUsersLogSize,
    roster,
    activeUsersCount,
    quality,
    feedbackTrend,
    trailing7dCost,
    projected7dCost,
    historicalAvg,
  });
  const runtimeStateDiagnostics = typeof getRuntimeStateDiagnostics === "function"
    ? getRuntimeStateDiagnostics()
    : null;
  const digestInsights = buildDigestInsights(recentDigests.rows, { days: 7 });
  const productBlocker = loadLatestAuditProductBlocker(digestAuditDir);
  const health = buildHealthPayload({
    runs,
    deliveryWarnings,
    deliveryReliability,
    deliveryOperations,
    schedulerWorker,
    digestRun,
    ignoredBackfill,
    productBlocker,
    runtimeState: runtimeStateDiagnostics ? {
      ok: runtimeStateDiagnostics.ok,
      status: runtimeStateDiagnostics.status,
      roots: runtimeStateDiagnostics.roots,
      mismatch_flags: runtimeStateDiagnostics.mismatch_flags,
      latest_timestamps: runtimeStateDiagnostics.latest_timestamps,
    } : null,
  });

  return {
    summary,
    health,
    runs: runsForTable.filter(r => Number(r.users_served || 0) > 0).slice(0, 10),
    per_user: perUser,
    roster,
    engagement,
    referrals,
    admin_messages: adminMessages,
    digest_insights: digestInsights,
  };
}

module.exports = {
  resolveSchedulerHeartbeatLoader,
  emitIgnoredBackfillSafe,
  loadLatestAuditProductBlocker,
  buildAdminStatsPayload,
};
