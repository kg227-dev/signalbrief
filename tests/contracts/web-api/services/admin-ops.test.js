"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/admin-ops.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const { createAdminOpsService } = require(TARGET_PATH);
assertModuleExports(() => ({ createAdminOpsService }), TARGET_REL);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-admin-ops-test-"));
const files = {
  costLogPath: path.join(tempDir, "cost-log.json"),
  schedulerHeartbeatFile: path.join(tempDir, "scheduler-heartbeat.json"),
  adminMessageLog: path.join(tempDir, "admin-message-log.json"),
  adminActionLog: path.join(tempDir, "admin-action-log.json"),
};

function buildService(opts = {}) {
  return createAdminOpsService({
    runtime: {
      fs,
      path,
    },
    files,
    requestContext: {
      getRequestHost: () => "localhost",
      getClientIp: () => "127.0.0.1",
      getAdminActor: () => "admin@example.com",
    },
    loaders: {
      loadEngagementEvents: () => [],
    },
  });
}

try {
  const service = buildService();

  fs.writeFileSync(
    files.costLogPath,
    `${JSON.stringify({ run_id: "old", total_cost_usd: 0.11 })}\n${JSON.stringify({ run_id: "new", total_cost_usd: 0.22 })}\n`
  );
  const costRuns = service.loadCostRunsNewest();
  assert.strictEqual(costRuns.length, 2, "cost log rows should be loaded");
  assert.strictEqual(costRuns[0].run_id, "new", "cost rows should be returned newest-first");

  const heartbeatNow = new Date().toISOString();
  fs.writeFileSync(files.schedulerHeartbeatFile, JSON.stringify({ updated_at: heartbeatNow, poll_ms: 60_000, worker: "scheduler-worker" }));
  const heartbeat = service.getCachedOrRefreshSchedulerHeartbeat(Date.now());
  assert.strictEqual(heartbeat.available, true);
  assert.strictEqual(heartbeat.healthy, true);

  const req = { method: "POST", url: "/api/admin/bulk", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  service.logAdminActionEvent(req, {
    action: "bulk_pause",
    target_email: "a@example.com",
    success: true,
    details: { reason: "test" },
  });
  service.logAdminMessageEvent(req, {
    user_email: "a@example.com",
    success: true,
    summary: "sent",
  });

  const actionRows = service.readJsonLineLog(files.adminActionLog, 10);
  const messageRows = service.readJsonLineLog(files.adminMessageLog, 10);
  assert.strictEqual(actionRows.length, 1, "admin action log should persist rows");
  assert.strictEqual(messageRows.length, 1, "admin message log should persist rows");
  assert.strictEqual(actionRows[0].actor, "admin@example.com");
  assert.strictEqual(actionRows[0].action, "bulk_pause");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
