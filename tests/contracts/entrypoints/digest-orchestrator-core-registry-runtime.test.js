"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-core-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createDigestOrchestratorCoreRuntimeRegistry } = runtime;

const counts = {
  bootstrap: 0,
  incident: 0,
  spendGuard: 0,
  circuitBreaker: 0,
  lock: 0,
  transport: 0,
  formatting: 0,
  data: 0,
  archive: 0,
  deliveryRecord: 0,
  retryState: 0,
  orchestratorArchive: 0,
  cost: 0,
  audit: 0,
};

let getConfigCalls = 0;
let getEmailTemplateCalls = 0;
let bootstrapEnsureCalls = 0;

const registry = createDigestOrchestratorCoreRuntimeRegistry({
  fs: {},
  path,
  https: {},
  processRef: {},
  appRoot: "/app",
  runtimePaths: {
    archiveDir: "/app/archive",
    digestRecordsDir: "/app/records",
    digestRetryStatePath: "/app/retry-state.json",
    costLogPath: "/app/cost-log.json",
    digestRunLockPath: "/app/digest-run.lock",
    digestIncidentLogPath: "/app/incident-log.json",
    spendGuardStatePath: "/app/spend-guard.json",
    circuitBreakerStatePath: "/app/circuit-breaker.json",
    incidentStorePath: "/app/incident-store.json",
    digestAuditDir: "/app/digest-audit",
  },
  getConfig: () => {
    getConfigCalls += 1;
    return {
      admin: { email: "ops@getsignalbrief.com" },
      user: { timezone: "America/New_York" },
    };
  },
  getEmailTemplate: () => {
    getEmailTemplateCalls += 1;
    return "<html></html>";
  },
  getBaseUrl: () => "https://getsignalbrief.com",
  buildPublicDigestUrl: () => "",
  initStore: () => {},
  log: () => {},
  sendOpsAlert: async () => {},
  formatEtDateKey: () => "2026-04-08",
  getOpsAlertEmail: () => "ops@getsignalbrief.com",
  normalizeTopicToken: (value) => String(value || "").trim().toLowerCase(),
  normalizeUrlForDedup: (value) => `normalized:${String(value || "")}`,
  annotateEditorialSignals: (items) => (
    Array.isArray(items) ? items.map((item) => ({ ...item, hard_exclude: false })) : []
  ),
  createRepeatIndex: () => ({ repeatIndex: true }),
  isRepeatedItem: () => false,
  dedupItemsAgainstRepeatIndex: (items) => items,
  parseSourceDomainShared: (value) => `shared:${String(value || "")}`,
  createDigestFormattingRuntime: (options) => {
    counts.formatting += 1;
    assert.strictEqual(options.BASE_URL, "https://getsignalbrief.com");
    assert.strictEqual(options.EMAIL_TEMPLATE, "<html></html>");
    return {
      scoreColor: (value) => `score:${value}`,
      stripInlineHtml: (value) => `strip:${value}`,
      generateLeadSubjectLine: (value) => `subject:${value}`,
      generateEditorialNote: (value) => `note:${value}`,
      topicVisual: (value) => `visual:${value}`,
      escapeHtml: (value) => `escape:${value}`,
      buildEmailHeaderMeta: (value) => `meta:${value}`,
      renderDigestItemHtml: (value) => `item:${value}`,
      applyTemplateSlots: (value) => `slots:${value}`,
      buildEmail: (value) => `email:${value}`,
    };
  },
  createDigestDataRuntime: (options) => {
    counts.data += 1;
    assert.ok(options.CONFIG);
    return {
      fetchTopicNews: (...args) => ({ kind: "fetch", args }),
      enrichItems: (...args) => ({ kind: "enrich", args }),
    };
  },
  createDigestArchiveRuntime: () => {
    counts.archive += 1;
    return {
      parseSourceDomain: (value) => `parsed:${value}`,
      loadRecentArchiveItems: () => ["recent-items"],
      loadRecentArchiveByDate: () => ["by-date"],
      dedupAgainstRecentArchives: (...args) => ({ kind: "dedup", args }),
      buildRecentRepeatIndex: () => ({ recentRepeatIndex: true }),
      saveToArchive: (...args) => ({ kind: "save", args }),
    };
  },
  createDigestDeliveryRecordRuntime: () => {
    counts.deliveryRecord += 1;
    return { label: "delivery-record" };
  },
  createDigestRetryStateRuntime: () => {
    counts.retryState += 1;
    return { label: "retry-state" };
  },
  createDigestOrchestratorArchiveRuntime: () => {
    counts.orchestratorArchive += 1;
    return {
      persistSharedArchive: (...args) => ({ kind: "persist", args }),
    };
  },
  createDigestOrchestratorCostRuntime: () => {
    counts.cost += 1;
    return {
      recordRunCost: (...args) => ({ kind: "cost", args }),
    };
  },
  createDigestOrchestratorIncidentRuntime: () => {
    counts.incident += 1;
    return {
      emitDigestIncident: (...args) => ({ kind: "incident", args }),
    };
  },
  createDigestOrchestratorLockRuntime: () => {
    counts.lock += 1;
    return {
      acquireDigestLock: (...args) => ({ ok: true, args }),
      releaseDigestLock: (...args) => ({ ok: true, args }),
    };
  },
  createDigestOrchestratorTransportRuntime: () => {
    counts.transport += 1;
    return {
      httpsPost: (...args) => ({ kind: "post", args }),
      httpsPostWithRetry: (...args) => ({ kind: "retry", args }),
    };
  },
  createDigestOrchestratorBootstrapRuntime: (options) => {
    counts.bootstrap += 1;
    assert.strictEqual(typeof options.releaseDigestLock, "function");
    return {
      ensureRuntimeBootstrap: () => {
        bootstrapEnsureCalls += 1;
      },
    };
  },
  createDigestOrchestratorSpendGuardRuntime: () => {
    counts.spendGuard += 1;
    return { label: "spend-guard" };
  },
  createDigestOrchestratorCircuitBreakerRuntime: () => {
    counts.circuitBreaker += 1;
    return { label: "circuit-breaker" };
  },
  createDigestOrchestratorAuditRuntime: () => {
    counts.audit += 1;
    return {
      writeDigestAuditLog: (...args) => ({ kind: "audit", args }),
    };
  },
  lockStates: { held: true },
  readDigestLockState: () => null,
  clearDigestLockFile: () => true,
  getDigestLockOwnerStatus: () => "clear",
  digestLockStaleMs: 30_000,
  perplexityCostPerCall: 0.005,
  claudeInputPerMtok: 0.8,
  claudeOutputPerMtok: 4,
});

assert.strictEqual(getConfigCalls, 0);
assert.strictEqual(getEmailTemplateCalls, 0);
assert.deepStrictEqual(counts, {
  bootstrap: 0,
  incident: 0,
  spendGuard: 0,
  circuitBreaker: 0,
  lock: 0,
  transport: 0,
  formatting: 0,
  data: 0,
  archive: 0,
  deliveryRecord: 0,
  retryState: 0,
  orchestratorArchive: 0,
  cost: 0,
  audit: 0,
});

registry.ensureDigestRuntimeBootstrap();
registry.ensureDigestRuntimeBootstrap();
assert.strictEqual(counts.bootstrap, 1);
assert.strictEqual(bootstrapEnsureCalls, 2);

assert.deepStrictEqual(registry.acquireDigestLock("scheduled"), {
  ok: true,
  args: ["scheduled"],
});
assert.deepStrictEqual(registry.releaseDigestLock("scheduled"), {
  ok: true,
  args: ["scheduled"],
});
assert.strictEqual(counts.lock, 1);

assert.deepStrictEqual(registry.httpsPost("host", "/path"), {
  kind: "post",
  args: ["host", "/path"],
});
assert.strictEqual(registry.httpsPostWithRetry("host", "/path").kind, "retry");
assert.strictEqual(counts.transport, 1);

assert.strictEqual(registry.buildEmail("payload"), "email:payload");
assert.strictEqual(registry.escapeHtml("payload"), "escape:payload");
assert.strictEqual(registry.topicVisual("payload"), "visual:payload");
assert.strictEqual(counts.formatting, 1);
assert.strictEqual(getConfigCalls, 1);
assert.strictEqual(getEmailTemplateCalls, 1);

assert.deepStrictEqual(registry.fetchTopicNews("TECHNOLOGY"), {
  kind: "fetch",
  args: ["TECHNOLOGY"],
});
assert.deepStrictEqual(registry.enrichItems(["item"]), {
  kind: "enrich",
  args: [["item"]],
});
assert.strictEqual(counts.data, 1);
assert.strictEqual(getConfigCalls, 2);

assert.strictEqual(registry.parseSourceDomain("https://example.com"), "parsed:https://example.com");
assert.deepStrictEqual(registry.loadRecentArchiveItems(), ["recent-items"]);
assert.deepStrictEqual(registry.loadRecentArchiveByDate("2026-04-08"), ["by-date"]);
assert.deepStrictEqual(registry.dedupAgainstRecentArchives(["x"]), {
  kind: "dedup",
  args: [["x"]],
});
assert.deepStrictEqual(registry.buildRecentRepeatIndex(["x"]), { recentRepeatIndex: true });
assert.strictEqual(counts.archive, 1);

assert.deepStrictEqual(registry.persistSharedArchive({ dateStr: "Apr 8" }), {
  kind: "persist",
  args: [{ dateStr: "Apr 8" }],
});
assert.strictEqual(counts.orchestratorArchive, 1);

const deliveryRecordRuntime = registry.getDigestDeliveryRecordRuntime();
assert.strictEqual(deliveryRecordRuntime, registry.getDigestDeliveryRecordRuntime());
assert.strictEqual(counts.deliveryRecord, 1);

const retryStateRuntime = registry.getDigestRetryStateRuntime();
assert.strictEqual(retryStateRuntime, registry.getDigestRetryStateRuntime());
assert.strictEqual(counts.retryState, 1);

assert.strictEqual(registry.getDigestOrchestratorSpendGuardRuntime().label, "spend-guard");
assert.strictEqual(registry.getDigestOrchestratorSpendGuardRuntime().label, "spend-guard");
assert.strictEqual(counts.spendGuard, 1);

assert.strictEqual(registry.getDigestOrchestratorCircuitBreakerRuntime().label, "circuit-breaker");
assert.strictEqual(registry.getDigestOrchestratorCircuitBreakerRuntime().label, "circuit-breaker");
assert.strictEqual(counts.circuitBreaker, 1);

assert.deepStrictEqual(registry.emitDigestIncident("x"), {
  kind: "incident",
  args: ["x"],
});
assert.strictEqual(counts.incident, 1);

assert.deepStrictEqual(registry.recordRunCost({ runId: "r1" }), {
  kind: "cost",
  args: [{ runId: "r1" }],
});
assert.strictEqual(counts.cost, 1);

assert.deepStrictEqual(registry.writeDigestAuditLog({ digestDateKey: "2026-04-08" }), {
  kind: "audit",
  args: [{ digestDateKey: "2026-04-08" }],
});
assert.strictEqual(counts.audit, 1);

process.stdout.write("[digest-orchestrator-core-registry-runtime] all assertions passed\n");
