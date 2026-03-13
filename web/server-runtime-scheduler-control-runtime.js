"use strict";

function createSchedulerWorkerRestartRequester({
  fs,
  path,
  schedulerControlFile,
}) {
  if (!fs || typeof fs.writeFileSync !== "function") {
    throw new TypeError("fs with writeFileSync is required");
  }
  if (!path || typeof path.dirname !== "function") {
    throw new TypeError("path with dirname is required");
  }
  if (!schedulerControlFile) {
    throw new TypeError("schedulerControlFile is required");
  }

  return function requestSchedulerWorkerRestart({
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

    const dir = path.dirname(schedulerControlFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(schedulerControlFile, JSON.stringify(payload, null, 2));

    return {
      request_id: requestId,
      requested_at: requestedAt,
      control_file: schedulerControlFile,
    };
  };
}

module.exports = {
  createSchedulerWorkerRestartRequester,
};
