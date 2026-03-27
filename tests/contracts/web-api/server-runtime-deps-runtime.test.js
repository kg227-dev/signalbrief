"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime-deps-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createServerRouteDependencies } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const noop = () => {};
const noopAsync = async () => {};

const deps = {
  requireJsonBody: async () => ({}),
  json: noop,
  getClientIp: () => "127.0.0.1",
  checkRateLimit: () => ({ limited: false }),
  allUsers: () => [],
  findUserByToken: () => null,
  normalizeReferralToken: () => "",
  generateToken: () => "token",
  writeUser: noop,
  deleteUser: noop,
  sendReferralThankYou: noopAsync,
  sendWelcomeEmail: noopAsync,
  runDigestTrigger: noopAsync,
  startDigestTrigger: noopAsync,
  getBaseUrl: () => "http://localhost:3003",
  DEFAULT_TOPICS: ["AI×TECH"],
  MAX_CUSTOM_KEYWORDS: 3,
  allowExampleSignups: true,
  PROTECTED_FIELDS: [],
  isAdminAuthed: () => false,
  logAdminActionEvent: noop,
  INDUSTRY_TOPICS: ["HEALTHCARE"],
  CAPABILITY_TOPICS: ["AI×TECH"],
  digestRunStatus: () => ({ running: false, state: "absent", lock: {} }),
  getCachedOrRefreshSchedulerHeartbeat: () => ({ healthy: true, available: true, status: "ready" }),
  isLegacyArchiveEndpointEnabled: () => true,
  recordLegacyArchiveUsage: noop,
  getArchiveLegacyDeprecationDeadlineUtc: () => "2026-12-31T00:00:00Z",
  readArchiveFilesForDir: () => [],
  getAllowedArchiveDatesForUser: () => new Set(),
  archiveRelevanceScore: () => 0,
  path,
  fs,
  APP_ROOT: process.cwd(),
  decodeDigestIdParam: () => "",
  buildDigestId: () => "digest-id",
  toEtDateKey: () => "2026-03-11",
  appendWebEngagementEvent: () => ({ ok: true }),
  sendTransparentGif: noop,
  normalizeEngagementUrl: (value) => String(value || ""),
  normalizeBookmarkUrl: (value) => String(value || ""),
  sendMagicLinkEmail: noopAsync,
  checkLoginRate: () => false,
  CONFIG: { admin: { email: "admin@example.com", salt: "salt", passwordHash: "hash" } },
  verifyAdminPassword: () => false,
  createAdminSession: () => "session",
  clearAdminSessionByRequest: noop,
  emitIgnoredEventsIfDue: noop,
  loadCostRunsNewest: () => [],
  loadEngagementEvents: () => [],
  parseIsoTs: () => null,
  computeFeedbackTrend: () => ({}),
  readJsonLineLog: () => [],
  ADMIN_MESSAGE_LOG: "/tmp/admin-message.log",
  ADMIN_ACTION_LOG: "/tmp/admin-action.log",
  maskEmail: (value) => value,
  normalizeDeliveryTimeInput: () => "07:00",
  logAdminMessageEvent: noop,
  summarizeMessage: (value) => value,
  hashText: (value) => value,
  escapeHtml: (value) => value,
  sendEmail: noopAsync,
  sendTelegramText: noopAsync,
  formatTimeEt: () => "7:00 AM ET",
  parseEtNowParts: () => ({}),
  computeNextDeliveryEt: () => null,
  formatDaysLabel: () => "Weekdays",
  computeQualityTrend: () => ({}),
  estimateSandboxCost: () => ({}),
  runSandboxPipeline: noopAsync,
  requestSchedulerWorkerRestart: () => ({}),
  assetVersion: "abc123",
  renderPublicDigestMissingPage: () => "<html></html>",
  formatPublicDigestDateLabel: () => "Mar 11, 2026",
  renderPublicDigestPageTemplate: () => "<html></html>",
  serveFile: noop,
  WEB_DIR: process.cwd(),
};

const routes = createServerRouteDependencies(deps);
assert.ok(routes && typeof routes === "object");
assert.strictEqual(typeof routes.handleCoreApiRoute, "function");
assert.strictEqual(typeof routes.handleAdminApiRoute, "function");
assert.strictEqual(typeof routes.handlePublicStaticRoute, "function");
