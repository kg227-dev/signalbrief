"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/core-api.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createCoreApiRouteHandler } = runtime;
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
    DEFAULT_TOPICS: ["AI×TECH"],
    INDUSTRY_TOPICS: ["HEALTHCARE"],
    CAPABILITY_TOPICS: ["AI×TECH"],
    digestRunStatus: () => ({ running: false, state: "absent", lock: {} }),
    getCachedOrRefreshSchedulerHeartbeat: () => ({
      available: true,
      healthy: true,
      status: "ready",
      blocked: false,
      summary: "ok",
      updated_at: new Date().toISOString(),
      age_seconds: 0,
      poll_ms: 300000,
      in_flight: false,
      last_error: null,
      lock_state: null,
      lock_error: null,
      blocked_state: null,
      consecutive_lock_unhealthy: 0,
    }),
    findUserByToken: () => null,
    handleSignup: async () => {},
    handleSettings: async () => {},
    allUsers: () => [],
    writeUser: () => {},
    isLegacyArchiveEndpointEnabled: () => true,
    recordLegacyArchiveUsage: () => {},
    getArchiveLegacyDeprecationDeadlineUtc: () => "2026-06-30T00:00:00Z",
    readArchiveFiles: () => [],
    getAllowedArchiveDates: () => new Set(),
    archiveRelevanceScore: () => 0,
    path,
    fs: require("fs"),
    APP_ROOT: process.cwd(),
    decodeDigestIdParam: () => "",
    buildDigestId: () => "digest-id",
    toEtDateKey: () => "2026-03-12",
    appendEngagementEventChecked: () => ({ ok: true }),
    sendTransparentGif: () => {},
    normalizeEngagementUrl: (value) => String(value || ""),
    requireJsonBody: async () => ({}),
    normalizeBookmarkUrl: (value) => String(value || ""),
    sendMagicLinkEmail: async () => {},
    ...overrides,
  };
}

async function invoke(handler, { method, pathname, search = "" }) {
  const req = { method, url: `${pathname}${search}` };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}${search}`);
  const handled = await handler({ req, res, url, pathname });
  return { handled, res };
}

(async () => {
  {
    const handler = createCoreApiRouteHandler(baseDeps());
    const { handled, res } = await invoke(handler, { method: "GET", pathname: "/api/topics" });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body.topics, ["AI×TECH"]);
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps());
    const { handled, res } = await invoke(handler, { method: "GET", pathname: "/api/user" });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(JSON.parse(res.body).error, "token required");
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps({
      findUserByToken: () => ({
        chatId: "123",
        email: "user@example.com",
        name: "User Example",
        status: "active",
        topics: ["AI×TECH", "HEALTHCARE"],
        custom_keywords: ["custom_ai"],
        watchlist: ["Nvidia"],
        bookmarks: [{ url: "https://example.com/a", title: "A", date: "2026-03-13", tag: "AI×TECH" }],
        preferences: { depth: "headline_plus_why", days_of_week: [1, 3], items_per_digest: 7 },
        topic_weights: { "AI×TECH": 2 },
        token: "should-not-leak",
        admin: { role: "owner" },
      }),
    }));
    const { handled, res } = await invoke(handler, {
      method: "GET",
      pathname: "/api/user",
      search: "?token=test-token",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.chatId, "123");
    assert.strictEqual(body.email, "user@example.com");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, "telegram"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, "custom_keywords"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, "watchlist"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, "source_preferences"), false);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(body.preferences, "items_per_digest"),
      false,
      "public user record should not expose deprecated items_per_digest"
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(body, "topic_weights"),
      false,
      "public user record should not expose deprecated topic weights"
    );
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, "token"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(body, "admin"), false);
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps({
      findUserByToken: () => ({
        chatId: "123",
        email: "user@example.com",
        preferences: {
          email_enabled: "false",
          telegram_enabled: "0",
          consultant_lens_mode: "true",
        },
      }),
    }));
    const { handled, res } = await invoke(handler, {
      method: "GET",
      pathname: "/api/user",
      search: "?token=test-token",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.preferences.email_enabled, false);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(body.preferences, "telegram_enabled"),
      false,
      "public user record should not expose deprecated telegram_enabled"
    );
    assert.strictEqual(body.preferences.consultant_lens_mode, true);
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps({
      getRuntimeStateHealth: () => ({
        ok: true,
        status: "ok",
        reason: "runtime state paths aligned",
        store_backend: "sqlite",
        store_sqlite_path: "/app/data/signalbrief.sqlite",
        mismatch_flags: {},
        component_roots: {},
      }),
    }));
    const { handled, res } = await invoke(handler, {
      method: "GET",
      pathname: "/api/health/scheduler",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.runtime_state.store_backend, "sqlite");
    assert.strictEqual(payload.runtime_state.store_sqlite_path, "/app/data/signalbrief.sqlite");
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps());
    const { handled, res } = await invoke(handler, {
      method: "GET",
      pathname: "/api/health/scheduler",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).ok, true);
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps({
      digestRunStatus: () => ({
        running: true,
        state: "corrupt",
        lock: { error: "invalid_json", mode: "scheduled", ageMs: 1500 },
      }),
      getCachedOrRefreshSchedulerHeartbeat: () => ({
        available: true,
        healthy: true,
        blocked: false,
        status: "ready",
      }),
    }));
    const { handled, res } = await invoke(handler, {
      method: "GET",
      pathname: "/api/health/scheduler",
    });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 503);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.ok, false);
    assert.strictEqual(payload.digest_lock.unhealthy, true);
  }

  {
    let signupCalled = false;
    const handler = createCoreApiRouteHandler(baseDeps({
      handleSignup: async () => {
        signupCalled = true;
      },
    }));
    const { handled } = await invoke(handler, { method: "POST", pathname: "/api/signup" });
    assert.strictEqual(handled, true);
    assert.strictEqual(signupCalled, true);
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps({
      requireJsonBody: async () => ({ email: "not-an-email" }),
    }));
    const { handled, res } = await invoke(handler, { method: "POST", pathname: "/api/request-link" });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(JSON.parse(res.body).error, "valid email required");
  }

  {
    let sendCount = 0;
    const handler = createCoreApiRouteHandler(baseDeps({
      requireJsonBody: async () => ({ email: "user@example.com" }),
      allUsers: () => [{ email: "user@example.com", token: "token-123" }],
      sendMagicLinkEmail: async (user) => {
        sendCount += 1;
        assert.strictEqual(user.email, "user@example.com");
        return { ok: true, via: "gmail" };
      },
    }));
    const { handled, res } = await invoke(handler, { method: "POST", pathname: "/api/request-link" });
    assert.strictEqual(handled, true);
    assert.strictEqual(sendCount, 1);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { success: true });
  }

  {
    let sendCount = 0;
    const handler = createCoreApiRouteHandler(baseDeps({
      requireJsonBody: async () => ({ email: "missing@example.com" }),
      allUsers: () => [{ email: "user@example.com", token: "token-123" }],
      sendMagicLinkEmail: async () => {
        sendCount += 1;
      },
    }));
    const { handled, res } = await invoke(handler, { method: "POST", pathname: "/api/request-link" });
    assert.strictEqual(handled, true);
    assert.strictEqual(sendCount, 0);
    // Returns generic 200 for unknown emails to prevent user enumeration.
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { success: true });
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps({
      requireJsonBody: async () => ({ email: "user@example.com" }),
      allUsers: () => [{ email: "user@example.com", token: "token-123" }],
      sendMagicLinkEmail: async () => {
        throw new Error("gmail send failed");
      },
    }));
    const { handled, res } = await invoke(handler, { method: "POST", pathname: "/api/request-link" });
    assert.strictEqual(handled, true);
    assert.strictEqual(res.statusCode, 502);
    assert.deepStrictEqual(JSON.parse(res.body), {
      success: false,
      error: "Could not send link right now.",
    });
  }

  {
    const handler = createCoreApiRouteHandler(baseDeps());
    const { handled } = await invoke(handler, { method: "GET", pathname: "/no-such-route" });
    assert.strictEqual(handled, false);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
