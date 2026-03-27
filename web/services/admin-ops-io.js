const { appendJsonLineLog } = require("./admin-ops-utils");

function isScheduledRunRecord(run) {
  const row = run && typeof run === "object" ? run : {};
  const normalizedMode = String(row.mode || "").trim().toLowerCase();
  if (normalizedMode) return normalizedMode === "scheduled";
  return row.on_demand !== true;
}

function normalizeHistoricalRunRecord(run) {
  const row = run && typeof run === "object" ? run : {};
  const legacyNonScheduled = !isScheduledRunRecord(row);
  const deliveredUsers = Array.isArray(row.per_user) ? row.per_user.length : Number(row.users_served || 0);
  const failedUsers = Array.isArray(row.per_user_failed) ? row.per_user_failed.length : Number(row.users_failed || 0);
  const dueUsers = Number(row.users_due);
  const legacyDueUsers = Number(row.users_targeted);
  return {
    ...row,
    mode: legacyNonScheduled ? "legacy_non_scheduled" : "scheduled",
    users_due: Number.isFinite(dueUsers)
      ? dueUsers
      : (Number.isFinite(legacyDueUsers) ? legacyDueUsers : Math.max(0, deliveredUsers + failedUsers)),
  };
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
          return normalizeHistoricalRunRecord(JSON.parse(line));
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

function createAdminAuditLoggers({
  fs,
  path,
  adminMessageLog,
  adminActionLog,
  getAdminActor,
}) {
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
    logAdminMessageEvent,
    logAdminActionEvent,
  };
}

module.exports = {
  createCostRunsReader,
  createAdminAuditLoggers,
  isScheduledRunRecord,
};
