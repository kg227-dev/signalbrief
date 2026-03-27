"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-users-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { handleAdminUserRoutes } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const source = require("fs").readFileSync(TARGET_PATH, "utf8");
if (!source.includes('pathname === "/api/admin/resend-digest" && req.method === "POST"')) {
  throw new Error("admin user routes should wire POST /api/admin/resend-digest");
}
if (!source.includes('pathname === "/api/admin/regenerate-digest" && req.method === "POST"')) {
  throw new Error("admin user routes should wire POST /api/admin/regenerate-digest");
}

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
      return this.body;
    },
  };
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
  return { status, data };
}

async function invoke({ method, pathname, body = null, deps = {} }) {
  const req = {
    method,
    url: pathname,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}`);
  const handled = await handleAdminUserRoutes({ req, res, url, pathname }, {
    json,
    isAdminAuthed: () => true,
    requireJsonBody: async () => body,
    allUsers: () => [],
    countArchiveDigestsForUser: () => 0,
    loadCurrentDigestSnapshot: () => null,
    readJsonLineLog: () => [],
    ADMIN_ACTION_LOG: "/tmp/admin-action-log.json",
    ADMIN_MESSAGE_LOG: "/tmp/admin-message-log.json",
    normalizeDeliveryTimeInput: () => "07:00",
    writeUser: () => {},
    deleteUser: () => {},
    logAdminActionEvent: () => {},
    formatTimeEt: () => "07:00 AM ET",
    handleAdminRunDigest: async () => {},
    requestSchedulerWorkerRestart: () => ({ ok: true }),
    loadLatestDigestSnapshot: () => null,
    regenerateDigestSnapshot: async () => ({
      subject: "SignalBrief: Story 1",
      item_count: 5,
      regenerated_at: "2026-03-27T12:00:00.000Z",
    }),
    resendDigestSnapshot: async () => ({ subject: "SignalBrief: Story 1", item_count: 5 }),
    buildRecentDigestsExport: () => ({ rows: [] }),
    getAdminActor: () => "qa-admin",
    ...deps,
  });
  return { handled, res };
}

(async () => {
  {
    const user = {
      chatId: "u-1",
      email: "ops@example.com",
      status: "active",
    };
    const snapshot = {
      status: "failed",
      date_et: "2026-03-27",
      selected_count: 5,
      items: Array.from({ length: 5 }, (_, index) => ({ headline: `Story ${index + 1}` })),
    };
    const { handled, res } = await invoke({
      method: "POST",
      pathname: "/api/admin/resend-digest",
      body: { email: user.email, date_et: "2026-03-27" },
      deps: {
        allUsers: () => [user],
        loadCurrentDigestSnapshot: () => snapshot,
      },
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).message, "Stored digest snapshot resent");
  }

  {
    const user = {
      chatId: "u-1",
      email: "ops@example.com",
      status: "paused",
    };
    const snapshot = {
      status: "sent",
      date_et: "2026-03-27",
      selected_count: 5,
      items: Array.from({ length: 5 }, (_, index) => ({ headline: `Story ${index + 1}` })),
    };
    const { handled, res } = await invoke({
      method: "POST",
      pathname: "/api/admin/regenerate-digest",
      body: { email: user.email, date_et: "2026-03-27" },
      deps: {
        allUsers: () => [user],
        loadCurrentDigestSnapshot: () => snapshot,
      },
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).message, "Stored digest summaries regenerated");
  }

  {
    const { handled } = await invoke({
      method: "GET",
      pathname: "/api/admin/not-a-route",
    });
    assert.strictEqual(handled, false);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
