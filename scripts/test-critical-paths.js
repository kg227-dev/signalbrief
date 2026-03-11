#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DIGEST_RUN_LOCK_FILE,
  DIGEST_TRIGGER_STATUS,
  digestRunStatus,
  normalizeDigestTriggerResult,
  triggerDigest,
} = require("../src/jobs/digest-runner-runtime");
const { handleCoreApiRoutes } = require("../web/api/core");
const { handlePublicStaticRoutes } = require("../web/api/public");
const { parseSourceDomain } = require("../src/domains/digest");
const mailer = require("../src/platform/mailer");
const store = require("../src/platform/store");
const {
  loadConfig,
  validateConfigSchema,
} = require("../src/runtime/config-provider");
const {
  resetAdminAuthState,
  isAdminAuthed,
  getAdminActor,
} = require("../web/admin-auth");

const TEST_FILE_SUFFIX = ".test.js";
const TEST_DIR_EXCLUDES = new Set([
  ".git",
  ".desloppify",
  ".claude",
  "node_modules",
  "test-results",
]);

function log(msg) {
  process.stdout.write(`[critical-tests] ${msg}\n`);
}

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
      return this.body;
    },
  };
}

function buildCoreDeps(overrides = {}) {
  return {
    json(res, data, status = 200) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return { status, data };
    },
    DEFAULT_TOPICS: ["AI×TECH", "STRATEGY"],
    INDUSTRY_TOPICS: ["HEALTHCARE"],
    CAPABILITY_TOPICS: ["AI×TECH", "STRATEGY"],
    findUserByToken: () => null,
    handleSignup: () => ({ ok: true }),
    handleSettings: () => ({ ok: true }),
    signUnsubEmail: () => "good-signature",
    allUsers: () => [],
    writeUser: () => {},
    blankReengagementState: () => ({ day4_sent_at: null, day8_sent_at: null, auto_paused_at: null, reactivated_at: null }),
    isLegacyArchiveEndpointEnabled: () => true,
    recordLegacyArchiveUsage: () => {},
    ARCHIVE_LEGACY_DEPRECATION_DEADLINE_UTC: "2026-06-30T00:00:00Z",
    readArchiveFiles: () => [],
    getAllowedArchiveDates: () => new Set(),
    archiveRelevanceScore: () => 0,
    path,
    fs,
    APP_ROOT: process.cwd(),
    decodeDigestIdParam: () => "",
    buildDigestId: () => "digest-id",
    toEtDateKey: () => "2026-03-06",
    appendEngagementEventChecked: () => ({ ok: true }),
    resetReengagementState: () => ({ day4_sent_at: null, day8_sent_at: null, auto_paused_at: null, reactivated_at: null }),
    sendTransparentGif: () => {},
    normalizeEngagementUrl: (value) => String(value || ""),
    requireJsonBody: async () => ({}),
    normalizeBookmarkUrl: (value) => String(value || ""),
    sendMagicLinkEmail: async () => {},
    ...overrides,
  };
}

function collectSidecarTestFiles(rootDir) {
  const out = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (TEST_DIR_EXCLUDES.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(TEST_FILE_SUFFIX)) continue;
      const absPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, absPath).split(path.sep).join("/");
      if (relPath === "src/module-coverage.test.js") continue;
      out.push(relPath);
    }
  }

  walk(rootDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function testSidecarModuleContracts() {
  const rootDir = path.join(__dirname, "..");
  const sidecarTests = collectSidecarTestFiles(rootDir);
  for (const relPath of sidecarTests) {
    require(path.join(rootDir, relPath));
  }
  assert.ok(sidecarTests.length >= 40, `expected sidecar coverage tests, found ${sidecarTests.length}`);
  return sidecarTests.length;
}

async function testModuleCoverageContracts() {
  const { runModuleCoverageTests } = require("../src/module-coverage.test");
  runModuleCoverageTests();
}

async function testDigestRunnerLockContract() {
  const lockDir = path.dirname(DIGEST_RUN_LOCK_FILE);
  const lockBackup = fs.existsSync(DIGEST_RUN_LOCK_FILE)
    ? fs.readFileSync(DIGEST_RUN_LOCK_FILE, "utf8")
    : null;
  fs.mkdirSync(lockDir, { recursive: true });

  try {
    fs.writeFileSync(DIGEST_RUN_LOCK_FILE, JSON.stringify({
      startedAt: new Date().toISOString(),
      mode: "critical-test",
    }));

    const busyRun = await triggerDigest({
      source: "test:critical",
      trigger: "critical_lock_busy",
      queue: false,
      maxAdmissionWaitMs: 0,
      serializeAdmission: false,
    });
    const busy = normalizeDigestTriggerResult(busyRun);
    assert.strictEqual(busyRun.ok, false, "busy lock should block new trigger");
    assert.strictEqual(busy.status, DIGEST_TRIGGER_STATUS.BUSY, "busy lock should normalize as BUSY");

    fs.writeFileSync(DIGEST_RUN_LOCK_FILE, "{invalid-json");
    const unhealthyRun = await triggerDigest({
      source: "test:critical",
      trigger: "critical_lock_corrupt",
      queue: false,
      maxAdmissionWaitMs: 0,
      serializeAdmission: false,
    });
    const unhealthy = normalizeDigestTriggerResult(unhealthyRun);
    assert.strictEqual(unhealthyRun.ok, false, "corrupt lock should block trigger");
    assert.strictEqual(unhealthy.status, DIGEST_TRIGGER_STATUS.LOCK_UNHEALTHY, "corrupt lock should normalize as LOCK_UNHEALTHY");

    const deadPidProbe = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    const deadPid = Number(String(deadPidProbe.stdout || "").trim());
    assert.ok(Number.isInteger(deadPid) && deadPid > 0, "dead pid probe should return a pid");
    fs.writeFileSync(DIGEST_RUN_LOCK_FILE, JSON.stringify({
      startedAt: new Date().toISOString(),
      mode: "critical-test",
      pid: deadPid,
    }));
    const recovered = digestRunStatus();
    assert.strictEqual(recovered.running, false, "dead-pid lock should self-heal and not block runs");
    assert.strictEqual(fs.existsSync(DIGEST_RUN_LOCK_FILE), false, "dead-pid lock should be cleared from disk");
  } finally {
    if (lockBackup == null) {
      try {
        if (fs.existsSync(DIGEST_RUN_LOCK_FILE)) fs.unlinkSync(DIGEST_RUN_LOCK_FILE);
      } catch (err) {
        process.stderr.write(`[critical-tests] lock cleanup failed: ${err.message}\n`);
      }
    } else {
      fs.writeFileSync(DIGEST_RUN_LOCK_FILE, lockBackup);
    }
  }
}

async function invokeCoreRoute(method, rawUrl, pathname, depsOverrides = {}) {
  const res = buildMockRes();
  const ctx = {
    req: { method, headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res,
    url: new URL(`http://localhost${rawUrl}`),
    pathname,
  };
  await handleCoreApiRoutes(ctx, buildCoreDeps(depsOverrides));
  return res;
}

async function testCoreApiRoutesContract() {
  const topicsRes = await invokeCoreRoute("GET", "/api/topics", "/api/topics");
  assert.strictEqual(topicsRes.statusCode, 200, "/api/topics should return 200");
  const topicsBody = JSON.parse(topicsRes.body || "{}");
  assert.deepStrictEqual(topicsBody.industries, ["HEALTHCARE"], "/api/topics should return configured industry list");

  let signupCalled = false;
  await invokeCoreRoute("POST", "/api/signup", "/api/signup", {
    handleSignup: async () => {
      signupCalled = true;
      return "signup-called";
    },
  });
  assert.strictEqual(signupCalled, true, "/api/signup should delegate to handleSignup");

  const unsubRes = await invokeCoreRoute(
    "GET",
    "/api/unsubscribe/legacy?email=test%40example.com&sig=wrong",
    "/api/unsubscribe/legacy",
    {
    signUnsubEmail: () => "expected",
    }
  );
  assert.strictEqual(unsubRes.statusCode, 403, "/api/unsubscribe/legacy should reject bad signatures");

  const bookmarkMissingTokenRes = await invokeCoreRoute("POST", "/api/bookmarks", "/api/bookmarks", {
    requireJsonBody: async () => ({ action: "add", item: { url: "https://example.com/a" } }),
  });
  assert.strictEqual(bookmarkMissingTokenRes.statusCode, 400, "/api/bookmarks should require token");

  const bookmarkInvalidTokenRes = await invokeCoreRoute("POST", "/api/bookmarks", "/api/bookmarks", {
    requireJsonBody: async () => ({ token: "bad", action: "add", item: { url: "https://example.com/a" } }),
    findUserByToken: () => null,
  });
  assert.strictEqual(bookmarkInvalidTokenRes.statusCode, 401, "/api/bookmarks should reject invalid token");

  const pauseMissingTokenRes = await invokeCoreRoute("GET", "/api/pause", "/api/pause");
  assert.strictEqual(pauseMissingTokenRes.statusCode, 302, "/api/pause should redirect on missing token");
  assert.ok(
    String(pauseMissingTokenRes.headers.Location || "").includes("invalid_token=1"),
    "/api/pause missing token should redirect to explicit invalid token state"
  );

  const reactivateMissingTokenRes = await invokeCoreRoute("GET", "/api/reactivate", "/api/reactivate");
  assert.strictEqual(reactivateMissingTokenRes.statusCode, 302, "/api/reactivate should redirect on missing token");
  assert.ok(
    String(reactivateMissingTokenRes.headers.Location || "").includes("invalid_token=1"),
    "/api/reactivate missing token should redirect to explicit invalid token state"
  );
}

async function testSharedSourceDomainContract() {
  const fromUrl = parseSourceDomain({ url: "https://www.Example.com/path?a=1", source: "ignored" });
  assert.strictEqual(fromUrl, "example.com", "source domain parser should normalize hostname from URL");

  const fromSource = parseSourceDomain({ url: "not-a-url", source: "https://WWW.BLOOMBERG.COM/markets" });
  assert.strictEqual(fromSource, "bloomberg.com", "source domain parser should fallback to source field");
}

async function testConfigSchemaContract() {
  const currentConfig = loadConfig({ reload: true });
  const valid = validateConfigSchema(currentConfig);
  assert.strictEqual(valid.ok, true, "active config.json should satisfy schema validation");
  assert.strictEqual(valid.errors.length, 0, "active config.json should produce zero schema errors");

  const invalid = {
    user: { email: "", deliveryTime: "7am", timezone: "" },
    digest: { itemCount: 0 },
    topics: [{ tag: "AI×TECH", queries: [] }],
    admin: { email: "", salt: "", passwordHash: "" },
    keys: {},
  };
  const bad = validateConfigSchema(invalid);
  assert.strictEqual(bad.ok, false, "invalid config shape should be rejected");
  assert.ok(
    bad.errors.some((row) => row.includes("user.deliveryTime")),
    "invalid config should include delivery-time schema error"
  );
  assert.ok(
    bad.errors.some((row) => row.includes("digest.itemCount")),
    "invalid config should include digest itemCount schema error"
  );
  assert.ok(
    bad.errors.some((row) => row.includes("topics[0].queries")),
    "invalid config should include topic queries schema error"
  );
}

async function testMailerResultContract() {
  const emptySend = await mailer.sendEmail("", "Subject", "<p>Body</p>");
  assert.strictEqual(emptySend.ok, false, "sendEmail should fail for missing recipient");
  assert.strictEqual(emptySend.via, "none", "sendEmail missing recipient should report via=none");
  assert.strictEqual(emptySend.skipped, true, "sendEmail missing recipient should be marked skipped");
  assert.ok(typeof emptySend.error === "string" && emptySend.error.length > 0, "sendEmail should include an error message");

  const day4 = await mailer.sendReengagementDay4Email({});
  assert.strictEqual(day4.via, "none", "lifecycle mail skip should use same contract");
  assert.strictEqual(day4.skipped, true, "lifecycle mail skip should be marked skipped");

  const welcome = await mailer.sendWelcomeEmail({
    name: "Contract Tester",
    email: "",
    token: "token",
    preferences: {},
    topics: [],
  });
  assert.strictEqual(welcome.via, "none", "sendWelcomeEmail should return same sendEmail contract");
  assert.strictEqual(welcome.skipped, true, "sendWelcomeEmail should propagate skipped contract");
}

async function testAdminPageGuardContract() {
  const res = buildMockRes();
  const routeResult = handlePublicStaticRoutes({
    req: { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res,
    url: new URL("http://localhost/admin"),
    pathname: "/admin",
  }, {
    isAdminAuthed: () => false,
    path,
    fs,
    APP_ROOT: process.cwd(),
    readArchiveFiles: () => [],
    renderPublicDigestMissingPage: () => "",
    formatPublicDigestDateLabel: () => "",
    renderPublicDigestPage: () => "",
    serveFile: () => {
      throw new Error("admin page should not be served without auth");
    },
    WEB_DIR: process.cwd(),
  });

  assert.strictEqual(routeResult, "", "unauthenticated admin route should end response");
  assert.strictEqual(res.statusCode, 302, "admin HTML route should redirect when unauthenticated");
  assert.ok(
    String(res.headers.Location || "").startsWith("/admin/login?next="),
    "admin HTML route should redirect to login with next param"
  );
}

async function testAdminLocalBypassContract() {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSignalbriefEnv = process.env.SIGNALBRIEF_ENV;
  const prevDeployEnv = process.env.DEPLOY_ENV;
  const prevAppEnv = process.env.APP_ENV;
  const prevBypass = process.env.ADMIN_LOCAL_BYPASS;

  const localReadOnlyReq = {
    method: "GET",
    url: "/api/admin/stats",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const localMutatingReq = {
    method: "POST",
    url: "/api/admin/delete-user",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const remoteReadOnlyReq = {
    method: "GET",
    url: "/api/admin/stats",
    headers: {},
    socket: { remoteAddress: "203.0.113.9" },
  };

  try {
    process.env.ADMIN_LOCAL_BYPASS = "1";

    process.env.NODE_ENV = "production";
    delete process.env.SIGNALBRIEF_ENV;
    delete process.env.DEPLOY_ENV;
    delete process.env.APP_ENV;
    resetAdminAuthState();
    assert.strictEqual(
      isAdminAuthed(localReadOnlyReq),
      false,
      "local admin bypass must never apply in production runtime"
    );

    process.env.NODE_ENV = "development";
    resetAdminAuthState();
    assert.strictEqual(
      isAdminAuthed(localReadOnlyReq),
      true,
      "local read-only admin route should allow bypass in explicit non-production runtime"
    );
    assert.strictEqual(
      getAdminActor(localReadOnlyReq),
      "local-bypass",
      "local bypass actor should be attributed for read-only bypass requests"
    );
    assert.strictEqual(
      isAdminAuthed(localMutatingReq),
      false,
      "local bypass must not authorize mutating admin routes"
    );
    assert.strictEqual(
      getAdminActor(localMutatingReq),
      "unknown",
      "mutating local admin routes should not be attributed as bypass actor"
    );
    assert.strictEqual(
      isAdminAuthed(remoteReadOnlyReq),
      false,
      "local bypass must never apply to non-local clients"
    );
  } finally {
    if (prevNodeEnv == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevSignalbriefEnv == null) delete process.env.SIGNALBRIEF_ENV;
    else process.env.SIGNALBRIEF_ENV = prevSignalbriefEnv;
    if (prevDeployEnv == null) delete process.env.DEPLOY_ENV;
    else process.env.DEPLOY_ENV = prevDeployEnv;
    if (prevAppEnv == null) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevAppEnv;
    if (prevBypass == null) delete process.env.ADMIN_LOCAL_BYPASS;
    else process.env.ADMIN_LOCAL_BYPASS = prevBypass;
    resetAdminAuthState();
  }
}

async function testReplyHandlerCommandFlow() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-critical-"));
  const dataDir = path.join(tmpRoot, "data");
  const transportLog = path.join(tmpRoot, "transport.log");
  const settingsLinkValue = `critical-${crypto.randomUUID()}`;
  const prevDataDir = process.env.SIGNALBRIEF_DATA_DIR;
  const prevDryRun = process.env.SIGNALBRIEF_TRANSPORT_DRY_RUN;
  const prevLogFile = process.env.SIGNALBRIEF_TRANSPORT_LOG_FILE;
  const prevBaseUrl = process.env.BASE_URL;

  try {
    fs.mkdirSync(dataDir, { recursive: true });

    process.env.SIGNALBRIEF_DATA_DIR = dataDir;
    process.env.SIGNALBRIEF_TRANSPORT_DRY_RUN = "1";
    process.env.SIGNALBRIEF_TRANSPORT_LOG_FILE = transportLog;
    process.env.BASE_URL = process.env.BASE_URL || "http://localhost:3003";

    store.resetStoreState({ dataDir, initialize: true });
    store.writeUser("chat-critical", {
      chatId: "chat-critical",
      token: settingsLinkValue,
      name: "Critical Tester",
      email: "critical@example.com",
      status: "active",
      digests_received: 3,
      bookmarks: [],
      topic_weights: {},
      custom_topics: [],
      digest_dates: [],
      last_digest_items: [],
      preferences: {
        delivery_time: "07:00",
        frequency: "daily_weekday",
        days_of_week: [1, 2, 3, 4, 5],
        items_per_digest: 5,
        timezone: "America/New_York",
        email_enabled: true,
        telegram_enabled: true,
      },
    });

    const {
      handleIncomingMessage,
      resetReplyRuntimeState,
    } = require("../src/runtime/reply/reply-handler-runtime");
    resetReplyRuntimeState();
    await handleIncomingMessage("/settings", "chat-critical");

    const lines = fs.existsSync(transportLog)
      ? fs.readFileSync(transportLog, "utf8").trim().split("\n").filter(Boolean)
      : [];
    assert.ok(lines.length > 0, "reply-handler should emit at least one transport call");
    const sent = lines
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean)
      .find((entry) => entry.kind === "telegram" && entry.method === "sendMessage");
    assert.ok(sent, "reply-handler should call Telegram sendMessage");
    assert.strictEqual(String(sent.payload.chat_id), "chat-critical", "reply-handler should target the requested chat");
    assert.ok(
      String(sent.payload.text || "").includes(`/settings?token=${settingsLinkValue}`),
      "reply-handler /settings should include personalized settings link"
    );
  } finally {
    if (prevDataDir == null) delete process.env.SIGNALBRIEF_DATA_DIR;
    else process.env.SIGNALBRIEF_DATA_DIR = prevDataDir;
    if (prevDryRun == null) delete process.env.SIGNALBRIEF_TRANSPORT_DRY_RUN;
    else process.env.SIGNALBRIEF_TRANSPORT_DRY_RUN = prevDryRun;
    if (prevLogFile == null) delete process.env.SIGNALBRIEF_TRANSPORT_LOG_FILE;
    else process.env.SIGNALBRIEF_TRANSPORT_LOG_FILE = prevLogFile;
    if (prevBaseUrl == null) delete process.env.BASE_URL;
    else process.env.BASE_URL = prevBaseUrl;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function main() {
  await testDigestRunnerLockContract();
  log("PASS digest-runner lock contract");

  await testCoreApiRoutesContract();
  log("PASS core web API route contract");

  await testSharedSourceDomainContract();
  log("PASS shared source-domain contract");

  await testConfigSchemaContract();
  log("PASS config schema contract");

  await testMailerResultContract();
  log("PASS mailer result contract");

  await testAdminPageGuardContract();
  log("PASS admin page auth guard");

  await testAdminLocalBypassContract();
  log("PASS admin local bypass contract");

  await testReplyHandlerCommandFlow();
  log("PASS reply-handler command flow");

  await testModuleCoverageContracts();
  log("PASS module coverage contracts");

  const sidecarCount = await testSidecarModuleContracts();
  log(`PASS sidecar module contracts (${sidecarCount} files)`);

  log("All critical path tests passed.");
}

main().catch((err) => {
  process.stderr.write(`[critical-tests] FAIL ${err.stack || err.message}\n`);
  process.exit(1);
});
