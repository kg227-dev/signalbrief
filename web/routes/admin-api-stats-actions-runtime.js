const {
  buildReferrals,
  buildEngagementMetrics,
} = require("../services/admin-stats-referrals");
const {
  buildMonthRunSummary,
  buildPerUserCostRollup,
} = require("../services/admin-stats-costs");
const {
  buildAdminRoster,
  buildDeliveryWarnings,
} = require("../services/admin-stats-roster");
const { buildDeliveryReliabilitySnapshot } = require("../services/admin-stats-delivery");
const { summarizeRosterQuality } = require("../services/admin-stats-quality");
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
    if (process.env.DEBUG_WEB_SERVER === "1") {
      console.warn(`[web] ignored-events backfill failed: ${error.message}`);
    }
    return fallback;
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
    maskEmail,
    BASE_URL,
    computeNextDeliveryEt,
    formatDaysLabel,
    computeQualityTrend,
    parseEtNowParts,
  } = deps;

  const runs = loadCostRunsNewest();
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
  } = buildMonthRunSummary(runs, monthPrefix);

  const usersAll = allUsers();
  const referrals = buildReferrals(usersAll);
  const engagement = buildEngagementMetrics({
    usersAll,
    referrals,
    loadEngagementEvents,
    parseIsoTs,
  });
  const perUser = buildPerUserCostRollup(runs);

  const roster = buildAdminRoster({
    usersAll,
    computeQualityTrend,
    formatDaysLabel,
    computeNextDeliveryEt,
    BASE_URL,
  });
  const activeUsersCount = roster.filter((user) => user.status === "active").length;
  const activeTelegramUsersCount = roster.filter((user) => user.status === "active" && user.telegram).length;
  const monthUsersServedFromRoster = roster.filter((user) => user.last_digest && user.last_digest.startsWith(monthPrefix)).length;

  const deliveryWarnings = buildDeliveryWarnings(roster);
  const deliveryReliability = buildDeliveryReliabilitySnapshot({
    runs,
    roster,
    parseEtNowParts,
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
  const summary = buildSummaryPayload({
    runs,
    monthRuns,
    monthDeliveries,
    monthLabel,
    monthUsersServedFromRoster,
    monthUniqueUsersLogSize,
    roster,
    activeUsersCount,
    activeTelegramUsersCount,
    quality,
    feedbackTrend,
  });
  const health = buildHealthPayload({
    runs,
    deliveryWarnings,
    deliveryReliability,
    schedulerWorker,
    digestRun,
    ignoredBackfill,
  });

  return {
    summary,
    health,
    runs: runs.slice(0, 10),
    per_user: perUser,
    roster,
    engagement,
    referrals,
    admin_messages: adminMessages,
  };
}

module.exports = {
  resolveSchedulerHeartbeatLoader,
  emitIgnoredBackfillSafe,
  buildAdminStatsPayload,
};
