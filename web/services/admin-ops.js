const crypto = require("crypto");
const {
  readJsonLineTail,
  parseIsoTs,
  toNumericOrNull,
  maskEmail,
  summarizeMessage,
  hashText,
} = require("./admin-ops-utils");
const {
  createCostRunsReader,
  createLegacyArchiveUsageRecorder,
  createAdminAuditLoggers,
} = require("./admin-ops-io");
const {
  computeFeedbackTrend,
} = require("./admin-ops-analytics");
const { createSchedulerHeartbeatAccessor } = require("./admin-ops-scheduler");

function isLegacyArchiveEndpointEnabled(archiveLegacyDeprecationDeadlineUtc) {
  if (String(process.env.ARCHIVE_LEGACY_FORCE_ENABLE || "") === "1") return true;
  const ts = Date.parse(String(archiveLegacyDeprecationDeadlineUtc || ""));
  if (!Number.isFinite(ts)) return true;
  return Date.now() < ts;
}

function createAdminOpsService({
  runtime,
  files,
  requestContext,
  loaders,
  flags = {},
}) {
  const { fs, path } = runtime;
  const {
    costLogPath,
    schedulerHeartbeatFile,
    adminMessageLog,
    adminActionLog,
    archiveLegacyUsageLog,
  } = files;
  const {
    getRequestHost,
    getClientIp,
    getAdminActor,
  } = requestContext;
  const { loadEngagementEvents } = loaders;
  const { archiveLegacyDeprecationDeadlineUtc } = flags;

  const resolveArchiveLegacyDeprecationDeadline = typeof archiveLegacyDeprecationDeadlineUtc === "function"
    ? archiveLegacyDeprecationDeadlineUtc
    : () => archiveLegacyDeprecationDeadlineUtc;
  const resolveSchedulerHeartbeatFile = typeof schedulerHeartbeatFile === "function"
    ? schedulerHeartbeatFile
    : () => schedulerHeartbeatFile;
  const loadCostRunsNewest = createCostRunsReader({ fs, costLogPath });
  const heartbeatAccessor = createSchedulerHeartbeatAccessor({
    fs,
    getSchedulerHeartbeatFile: resolveSchedulerHeartbeatFile,
  });
  const recordLegacyArchiveUsage = createLegacyArchiveUsageRecorder({
    fs,
    path,
    archiveLegacyUsageLog,
    getRequestHost,
    getClientIp,
  });
  const {
    logAdminMessageEvent,
    logAdminActionEvent,
  } = createAdminAuditLoggers({
    fs,
    path,
    adminMessageLog,
    adminActionLog,
    getAdminActor,
  });

  function readJsonLineLog(filePath, limit = 30) {
    return readJsonLineTail({ fs, filePath, limit });
  }

  return {
    isLegacyArchiveEndpointEnabled: () => isLegacyArchiveEndpointEnabled(resolveArchiveLegacyDeprecationDeadline()),
    recordLegacyArchiveUsage,
    readJsonLineLog,
    parseIsoTs,
    computeFeedbackTrend: (users) => computeFeedbackTrend(users, { parseIsoTs, toNumericOrNull }),
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
