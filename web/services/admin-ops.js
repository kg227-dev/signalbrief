const crypto = require("crypto");
const {
  appendJsonLineLog,
  readJsonLineTail,
  parseIsoTs,
  toNumericOrNull,
  maskEmail,
  summarizeMessage,
  hashText,
} = require("./admin-ops-utils");
const {
  computeFeedbackTrend,
  getRecentAutoAdjustmentsForUser,
} = require("./admin-ops-analytics");
const { createSchedulerHeartbeatAccessor } = require("./admin-ops-scheduler");

function isLegacyArchiveEndpointEnabled(archiveLegacyDeprecationDeadlineUtc) {
  if (String(process.env.ARCHIVE_LEGACY_FORCE_ENABLE || "") === "1") return true;
  const ts = Date.parse(String(archiveLegacyDeprecationDeadlineUtc || ""));
  if (!Number.isFinite(ts)) return true;
  return Date.now() < ts;
}

function createCostRunsReader({ fs, costLogPath }) {
  const cache = {
    mtimeMs: 0,
    size: 0,
    runsNewest: [],
  };

  return function loadCostRunsNewest() {
    if (!fs.existsSync(costLogPath)) {
      cache.mtimeMs = 0;
      cache.size = 0;
      cache.runsNewest = [];
      return [];
    }

    let stat;
    try {
      stat = fs.statSync(costLogPath);
    } catch {
      return [];
    }

    if (cache.runsNewest.length && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
      return cache.runsNewest;
    }

    const runs = fs.readFileSync(costLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();

    cache.mtimeMs = stat.mtimeMs;
    cache.size = stat.size;
    cache.runsNewest = runs;
    return runs;
  };
}

function createAdminOpsService({
  fs,
  path,
  costLogPath,
  schedulerHeartbeatFile,
  adminMessageLog,
  adminActionLog,
  archiveLegacyUsageLog,
  archiveLegacyDeprecationDeadlineUtc,
  getRequestHost,
  getClientIp,
  getAdminActor,
  loadEngagementEvents,
}) {
  const loadCostRunsNewest = createCostRunsReader({ fs, costLogPath });
  const heartbeatAccessor = createSchedulerHeartbeatAccessor({ fs, schedulerHeartbeatFile });

  function readJsonLineLog(filePath, limit = 30) {
    return readJsonLineTail({ fs, filePath, limit });
  }

  function recordLegacyArchiveUsage(req, endpoint, outcome, metadata = {}) {
    appendJsonLineLog({
      fs,
      path,
      filePath: archiveLegacyUsageLog,
      entry: {
        ts_utc: new Date().toISOString(),
        endpoint,
        outcome,
        method: req.method,
        host: getRequestHost(req),
        ip: getClientIp(req),
        metadata: metadata && typeof metadata === "object" ? metadata : {},
      },
      label: "archive-legacy-usage",
    });
  }

  function logAdminMessageEvent(req, payload) {
    const outcome = appendJsonLineLog({
      fs,
      path,
      filePath: adminMessageLog,
      entry: {
        at: new Date().toISOString(),
        actor: getAdminActor(req),
        ...payload,
      },
      label: "admin-message-log",
    });
    if (!outcome.ok) {
      const err = new Error(`admin message audit log write failed: ${outcome.error || "unknown error"}`);
      err.code = "admin_message_audit_write_failed";
      throw err;
    }
    return outcome;
  }

  function logAdminActionEvent(req, payload) {
    const outcome = appendJsonLineLog({
      fs,
      path,
      filePath: adminActionLog,
      entry: {
        at: new Date().toISOString(),
        actor: getAdminActor(req),
        ...payload,
      },
      label: "admin-action-log",
    });
    if (!outcome.ok) {
      const err = new Error(`admin action audit log write failed: ${outcome.error || "unknown error"}`);
      err.code = "admin_action_audit_write_failed";
      throw err;
    }
    return outcome;
  }

  return {
    isLegacyArchiveEndpointEnabled: () => isLegacyArchiveEndpointEnabled(archiveLegacyDeprecationDeadlineUtc),
    recordLegacyArchiveUsage,
    readJsonLineLog,
    parseIsoTs,
    computeFeedbackTrend: (users) => computeFeedbackTrend(users, { parseIsoTs, toNumericOrNull }),
    getRecentAutoAdjustmentsForUser: (user, limit = 8) => getRecentAutoAdjustmentsForUser(
      user,
      { loadEngagementEvents, parseIsoTs, toNumericOrNull },
      limit
    ),
    loadCostRunsNewest,
    getCachedOrRefreshSchedulerHeartbeat: (now = Date.now()) => heartbeatAccessor.getCachedOrRefresh(now),
    maskEmail,
    summarizeMessage,
    hashText: (text) => hashText({ crypto, text }),
    logAdminMessageEvent,
    logAdminActionEvent,
  };
}

module.exports = {
  createAdminOpsService,
};
