"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const SHARED_REL = "web/server-runtime-shared-handlers-runtime.js";
const CORE_REL = "web/server-runtime-core-registry-runtime.js";
const ADMIN_REL = "web/server-runtime-admin-registry-runtime.js";
const PUBLIC_REL = "web/server-runtime-public-registry-runtime.js";

for (const relPath of [SHARED_REL, CORE_REL, ADMIN_REL, PUBLIC_REL]) {
  const absPath = path.join(process.cwd(), relPath);
  assertNodeSyntaxFile(absPath);
}

const sharedRuntime = require(path.join(process.cwd(), SHARED_REL));
const coreRuntime = require(path.join(process.cwd(), CORE_REL));
const adminRuntime = require(path.join(process.cwd(), ADMIN_REL));
const publicRuntime = require(path.join(process.cwd(), PUBLIC_REL));

assertModuleExports(() => sharedRuntime, SHARED_REL);
assertModuleExports(() => coreRuntime, CORE_REL);
assertModuleExports(() => adminRuntime, ADMIN_REL);
assertModuleExports(() => publicRuntime, PUBLIC_REL);

const { createSharedRouteHandlers } = sharedRuntime;
const { createCoreRouteDependencies } = coreRuntime;
const { createAdminRouteDependencies } = adminRuntime;
const { createPublicRouteDependencies } = publicRuntime;

const noop = () => {};
const noopAsync = async () => {};

function testSharedHandlersRegistry() {
  const handlers = createSharedRouteHandlers({
    requireJsonBody: async () => ({}),
    json: noop,
    getClientIp: () => "127.0.0.1",
    checkRateLimit: () => ({ limited: false }),
    allUsers: () => [],
    findUserByToken: () => null,
    normalizeReferralToken: (value) => String(value || ""),
    generateToken: () => "token",
    writeUser: noop,
    sendReferralThankYou: noopAsync,
    sendWelcomeEmail: noopAsync,
    runDigestTrigger: noopAsync,
    startDigestTrigger: noopAsync,
    getBaseUrl: () => "http://localhost:3003",
    DEFAULT_TOPICS: ["AIxTECH"],
    MAX_CUSTOM_KEYWORDS: 3,
    allowExampleSignups: true,
    PROTECTED_FIELDS: [],
    isAdminAuthed: () => false,
    logAdminActionEvent: noop,
  });

  assert.strictEqual(typeof handlers.handleSignup, "function");
  assert.strictEqual(typeof handlers.handleSettings, "function");
  assert.strictEqual(typeof handlers.handleAdminRunDigest, "function");
}

function testCoreRegistryAliases() {
  const sharedHandlers = {
    handleSignup: noopAsync,
    handleSettings: noopAsync,
  };
  const deps = {
    json: noop,
    DEFAULT_TOPICS: [],
    INDUSTRY_TOPICS: [],
    CAPABILITY_TOPICS: [],
    digestRunStatus: noop,
    getCachedOrRefreshSchedulerHeartbeat: noop,
    findUserByToken: noop,
    allUsers: noop,
    writeUser: noop,
    isLegacyArchiveEndpointEnabled: noop,
    recordLegacyArchiveUsage: noop,
    getArchiveLegacyDeprecationDeadlineUtc: noop,
    readArchiveFilesForDir: noop,
    getAllowedArchiveDatesForUser: noop,
    archiveRelevanceScore: noop,
    path,
    fs: require("fs"),
    APP_ROOT: process.cwd(),
    decodeDigestIdParam: noop,
    buildDigestId: noop,
    toEtDateKey: noop,
    appendWebEngagementEvent: noop,
    sendTransparentGif: noop,
    normalizeEngagementUrl: noop,
    requireJsonBody: noopAsync,
    normalizeBookmarkUrl: noop,
    sendMagicLinkEmail: noopAsync,
  };

  const coreDeps = createCoreRouteDependencies({ deps, sharedHandlers });
  assert.strictEqual(coreDeps.handleSignup, sharedHandlers.handleSignup);
  assert.strictEqual(coreDeps.handleSettings, sharedHandlers.handleSettings);
  assert.strictEqual(coreDeps.readArchiveFiles, deps.readArchiveFilesForDir);
  assert.strictEqual(coreDeps.getAllowedArchiveDates, deps.getAllowedArchiveDatesForUser);
  assert.strictEqual(coreDeps.appendEngagementEventChecked, deps.appendWebEngagementEvent);
}

function testAdminRegistryIncludesRunHandler() {
  const sharedHandlers = {
    handleAdminRunDigest: noopAsync,
  };
  const deps = {
    json: noop,
    isAdminAuthed: noop,
    getClientIp: noop,
    checkLoginRate: noop,
    requireJsonBody: noopAsync,
    CONFIG: {},
    verifyAdminPassword: noop,
    createAdminSession: noop,
    clearAdminSessionByRequest: noop,
    getBaseUrl: noop,
    emitIgnoredEventsIfDue: noop,
    loadCostRunsNewest: noop,
    allUsers: noop,
    loadEngagementEvents: noop,
    parseIsoTs: noop,
    computeFeedbackTrend: noop,
    digestRunStatus: noop,
    getCachedOrRefreshSchedulerHeartbeat: noop,
    readJsonLineLog: noop,
    ADMIN_MESSAGE_LOG: "/tmp/admin-message.log",
    ADMIN_ACTION_LOG: "/tmp/admin-action.log",
    maskEmail: noop,
    logAdminActionEvent: noop,
    normalizeDeliveryTimeInput: noop,
    writeUser: noop,
    deleteUser: noop,
    sendMagicLinkEmail: noopAsync,
    logAdminMessageEvent: noop,
    summarizeMessage: noop,
    hashText: noop,
    escapeHtml: noop,
    sendEmail: noopAsync,
    sendTelegramText: noopAsync,
    formatTimeEt: noop,
    parseEtNowParts: noop,
    computeNextDeliveryEt: noop,
    formatDaysLabel: noop,
    computeQualityTrend: noop,
    estimateSandboxCost: noop,
    runSandboxPipeline: noopAsync,
    requestSchedulerWorkerRestart: noop,
  };

  const adminDeps = createAdminRouteDependencies({ deps, sharedHandlers });
  assert.strictEqual(adminDeps.handleAdminRunDigest, sharedHandlers.handleAdminRunDigest);
}

function testPublicRegistryAddsBaseUrl() {
  const deps = {
    path,
    fs: require("fs"),
    APP_ROOT: process.cwd(),
    assetVersion: "abc123",
    readArchiveFilesForDir: () => [],
    findUserByToken: noop,
    loadLatestDigestSnapshot: noop,
    loadDigestSnapshotByRunId: noop,
    renderPublicDigestMissingPage: () => "<html></html>",
    formatPublicDigestDateLabel: () => "Mar 13, 2026",
    renderPublicDigestPageTemplate: (payload) => payload,
    getBaseUrl: () => "https://getsignalbrief.com",
    isAdminAuthed: () => false,
    serveFile: noop,
    WEB_DIR: process.cwd(),
  };

  const publicDeps = createPublicRouteDependencies(deps);
  const rendered = publicDeps.renderPublicDigestPage({ dateKey: "2026-03-13" });
  assert.strictEqual(rendered.baseUrl, "https://getsignalbrief.com");
  assert.strictEqual(publicDeps.readArchiveFiles, deps.readArchiveFilesForDir);
  assert.strictEqual(publicDeps.findUserByToken, deps.findUserByToken);
  assert.strictEqual(publicDeps.loadLatestDigestSnapshot, deps.loadLatestDigestSnapshot);
  assert.strictEqual(publicDeps.loadDigestSnapshotByRunId, deps.loadDigestSnapshotByRunId);
  assert.strictEqual(publicDeps.getBaseUrl, deps.getBaseUrl);
}

testSharedHandlersRegistry();
testCoreRegistryAliases();
testAdminRegistryIncludesRunHandler();
testPublicRegistryAddsBaseUrl();
