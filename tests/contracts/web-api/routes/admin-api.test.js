"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin/admin-api.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createAdminApiRouteHandler } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

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

function baseDeps(overrides = {}) {
  return {
    json,
    getClientIp: () => "127.0.0.1",
    checkLoginRate: () => false,
    requireJsonBody: async () => ({}),
    CONFIG: { admin: { email: "admin@example.com", salt: "salt", passwordHash: "00".repeat(64) } },
    verifyAdminPassword: () => false,
    createAdminSession: () => "session-token",
    clearAdminSessionByRequest: () => true,
    BASE_URL: "https://getsignalbrief.com",
    getBaseUrl: () => "https://getsignalbrief.com",
    isAdminAuthed: () => false,
    emitIgnoredEventsIfDue: () => {},
    getCachedOrRefreshSchedulerHeartbeat: () => null,
    readSchedulerHeartbeat: () => null,
    allUsers: () => [],
    readJsonLineLog: () => [],
    ADMIN_ACTION_LOG: "/tmp/admin-action-log.json",
    ADMIN_MESSAGE_LOG: "/tmp/admin-message-log.json",
    normalizeDeliveryTimeInput: () => "07:00",
    writeUser: () => {},
    deleteUser: () => {},
    logAdminActionEvent: () => {},
    formatTimeEt: () => "07:00 AM ET",
    requestSchedulerWorkerRestart: () => ({ ok: true }),
    sendMagicLinkEmail: async () => ({ ok: true }),
    estimateSandboxCost: () => ({ ok: true }),
    runSandboxPipeline: async () => ({ ok: true }),
    runDigestTrigger: async () => ({ ok: true }),
    startDigestTrigger: async () => ({ ok: true }),
    ...overrides,
  };
}

async function invoke(handler, { method, pathname, search = "", headers = {} }) {
  const req = {
    method,
    url: `${pathname}${search}`,
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}${search}`);
  const handled = await handler({ req, res, url, pathname });
  return { handled, res };
}

(async () => {
  {
    const handler = createAdminApiRouteHandler(baseDeps({
      checkLoginRate: () => true,
    }));
    const { handled, res } = await invoke(handler, {
      method: "POST",
      pathname: "/api/admin/login",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(JSON.parse(res.body).error, "Too many attempts. Try again in 15 minutes.");
  }

  {
    const handler = createAdminApiRouteHandler(baseDeps({
      requireJsonBody: async () => ({ email: "", password: "" }),
    }));
    const { handled, res } = await invoke(handler, {
      method: "POST",
      pathname: "/api/admin/login",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(JSON.parse(res.body).error, "Email and password required");
  }

  {
    const handler = createAdminApiRouteHandler(baseDeps({
      isAdminAuthed: () => false,
    }));
    const { handled, res } = await invoke(handler, {
      method: "GET",
      pathname: "/api/admin/check",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).authenticated, false);
  }

  {
    const handler = createAdminApiRouteHandler(baseDeps());
    const { handled } = await invoke(handler, {
      method: "GET",
      pathname: "/api/admin/not-a-route",
    });
    assert.strictEqual(handled, false);
  }

  {
    const handler = createAdminApiRouteHandler(baseDeps({
      isAdminAuthed: () => true,
    }));
    const { handled } = await invoke(handler, {
      method: "GET",
      pathname: "/api/admin/retrieval-eval/status",
    });
    assert.strictEqual(handled, false);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
