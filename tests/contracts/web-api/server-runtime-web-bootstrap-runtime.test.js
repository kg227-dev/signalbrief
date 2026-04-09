"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime-web-bootstrap-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  buildWebRouteDependencies,
  createWebRequestHandler,
} = runtime;

function buildRouteDependenciesStub() {
  const noop = () => false;
  const noopAsync = async () => false;
  return {
    json: () => {},
    serveFile: () => {},
    requireJsonBody: () => ({}),
    getClientIp: () => "127.0.0.1",
    getBaseUrl: () => "https://getsignalbrief.com",
    normalizeReferralToken: (value) => String(value || ""),
    generateToken: () => "token",
    allUsers: () => [],
    findUserByToken: () => null,
    handleSignup: noopAsync,
    handleSettings: noopAsync,
    writeUser: () => {},
    deleteUser: () => {},
    sendMagicLinkEmail: async () => ({ ok: true }),
    sendEmail: async () => ({ ok: true }),
    sendReferralThankYou: async () => ({ ok: true }),
    sendWelcomeEmail: async () => ({ ok: true }),
    startDigestTrigger: async () => ({ ok: true }),
    DEFAULT_TOPICS: [],
    MAX_CUSTOM_KEYWORDS: 0,
    allowExampleSignups: false,
    PROTECTED_FIELDS: [],
    INDUSTRY_TOPICS: [],
    digestRunStatus: () => ({ running: false, state: "absent", lock: {} }),
    getCachedOrRefreshSchedulerHeartbeat: () => null,
    emitIgnoredEventsIfDue: noop,
    loadCostRunsNewest: () => [],
    loadEngagementEvents: () => [],
    parseIsoTs: () => null,
    computeFeedbackTrend: () => ({}),
    requestSchedulerWorkerRestart: () => ({ ok: true }),
    forkSchedulerWorker: () => 1234,
    getRuntimeStateHealth: () => ({ ok: true }),
    getRuntimeStateDiagnostics: () => ({ ok: true }),
    readJsonLineLog: () => [],
    normalizeDeliveryTimeInput: (value) => String(value || ""),
    logAdminActionEvent: noop,
    logAdminMessageEvent: noop,
    summarizeMessage: (value) => String(value || ""),
    hashText: (value) => String(value || ""),
    maskEmail: (value) => String(value || ""),
    escapeHtml: (value) => String(value || ""),
    formatTimeEt: (value) => String(value || ""),
    parseEtNowParts: () => ({}),
    computeNextDeliveryEt: () => null,
    formatDaysLabel: () => "",
    computeQualityTrend: () => ({}),
    getAllowedArchiveDatesForUser: () => [],
    readArchiveFilesForDir: () => [],
    archiveRelevanceScore: () => 0,
    countArchiveDigestsForUser: () => 0,
    loadCurrentDigestSnapshot: () => null,
    loadDigestSnapshotByRunId: () => null,
    loadLatestDigestSnapshot: () => null,
    regenerateDigestSnapshot: noopAsync,
    resendDigestSnapshot: noopAsync,
    loadSourceRegistry: () => [],
    inspectStandardTopicBrokerConfig: () => ({}),
    buildSourceRegistryMap: () => new Map(),
    listSourceRegistryEntries: () => [],
    getSourceRegistryEntry: () => null,
    getSourceRegistryIdentityEntry: () => null,
    updateBrokerTopicConfig: () => ({}),
    updateBrokerSourceConfig: () => ({}),
    upsertSourceRegistryEntry: () => ({}),
    resetSourceRegistryEntry: () => ({}),
    resetSourceRegistryIdentityEntry: () => ({}),
    setAdminSourceRegistry: noop,
    renderPublicDigestMissingPage: () => "<html></html>",
    formatPublicDigestDateLabel: (value) => value,
    renderPublicDigestPageTemplate: () => "<html></html>",
    assetVersion: "v1",
    WEB_DIR: "/tmp",
    CONFIG: {},
    APP_ROOT: "/tmp",
    archiveDir: "/tmp/archive",
    path: require("path"),
    fs: require("fs"),
  };
}

function testBuildWebRouteDependencies() {
  const merged = buildWebRouteDependencies({
    request: { one: 1, shared: "request" },
    auth: { two: 2, shared: "auth" },
    public: { three: 3 },
    runtime: { four: 4 },
  });

  assert.deepStrictEqual(merged, {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    shared: "auth",
  });
}

async function testRequestHandler404Flow() {
  const calls = [];
  const handler = createWebRequestHandler({
    routeDependencies: buildRouteDependenciesStub(),
    ensureStoreInitialized: () => {
      calls.push("store");
    },
    getServerPort: () => {
      calls.push("port");
      return 3922;
    },
    applyCanonicalHostPolicy: (input) => {
      calls.push(["canonical", input.pathname]);
      return false;
    },
    applyResponseCorsPolicy: () => {
      calls.push("cors");
    },
    handleCorsPreflightPolicy: () => {
      calls.push("preflight");
      return false;
    },
    handleRequestErrorPolicy: () => {
      calls.push("error-policy");
    },
    getRequestHost: () => "getsignalbrief.com",
    getRequestScheme: () => "https",
    canonicalHost: "getsignalbrief.com",
    publicHosts: ["getsignalbrief.com"],
    trustedCorsOrigins: ["https://getsignalbrief.com"],
    onError: () => {
      calls.push("on-error");
    },
  });

  const res = {
    writeHead(code) {
      calls.push(["writeHead", code]);
    },
    end(body) {
      calls.push(["end", body]);
    },
  };

  await handler({ method: "GET", url: "/missing" }, res);

  assert.deepStrictEqual(calls, [
    "store",
    "port",
    ["canonical", "/missing"],
    "cors",
    "preflight",
    ["writeHead", 404],
    ["end", "Not found"],
  ]);
}

async function testRequestHandlerErrorFlow() {
  const calls = [];
  const handler = createWebRequestHandler({
    routeDependencies: buildRouteDependenciesStub(),
    ensureStoreInitialized: () => {
      calls.push("store");
    },
    getServerPort: () => 3922,
    applyCanonicalHostPolicy: () => {
      throw new Error("boom");
    },
    applyResponseCorsPolicy: () => {
      calls.push("cors");
    },
    handleCorsPreflightPolicy: () => false,
    handleRequestErrorPolicy: () => {
      calls.push("error-policy");
    },
    getRequestHost: () => "getsignalbrief.com",
    getRequestScheme: () => "https",
    canonicalHost: "getsignalbrief.com",
    publicHosts: ["getsignalbrief.com"],
    trustedCorsOrigins: ["https://getsignalbrief.com"],
    onError: (err) => {
      calls.push(["on-error", err.message]);
    },
  });

  const res = {
    writeHead() {
      calls.push("writeHead");
    },
    end() {
      calls.push("end");
    },
  };

  await handler({ method: "GET", url: "/missing" }, res);

  assert.deepStrictEqual(calls, [
    "store",
    ["on-error", "boom"],
    "error-policy",
  ]);
}

(async () => {
  testBuildWebRouteDependencies();
  await testRequestHandler404Flow();
  await testRequestHandlerErrorFlow();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
