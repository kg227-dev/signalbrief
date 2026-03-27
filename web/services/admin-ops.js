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
  createAdminAuditLoggers,
} = require("./admin-ops-io");
const {
  computeFeedbackTrend,
} = require("./admin-ops-analytics");
const { createSchedulerHeartbeatAccessor } = require("./admin-ops-scheduler");

function createAdminOpsService({
  runtime,
  files,
  requestContext,
  loaders,
}) {
  const { fs, path } = runtime;
  const {
    costLogPath,
    schedulerHeartbeatFile,
    adminMessageLog,
    adminActionLog,
  } = files;
  const {
    getAdminActor,
  } = requestContext;
  void loaders;
  const resolveSchedulerHeartbeatFile = typeof schedulerHeartbeatFile === "function"
    ? schedulerHeartbeatFile
    : () => schedulerHeartbeatFile;
  const loadCostRunsNewest = createCostRunsReader({ fs, costLogPath });
  const heartbeatAccessor = createSchedulerHeartbeatAccessor({
    fs,
    getSchedulerHeartbeatFile: resolveSchedulerHeartbeatFile,
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
