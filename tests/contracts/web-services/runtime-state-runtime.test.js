"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/services/runtime-state-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createRuntimeStateInspector } = runtime;
assert.strictEqual(typeof createRuntimeStateInspector, "function");

const inspector = createRuntimeStateInspector({
  fs: {
    statSync() { throw new Error("missing"); },
    readdirSync() { return []; },
  },
  childProcess: {
    spawnSync() {
      return { status: 0, stdout: "abc123\n" };
    },
  },
  os: { hostname: () => "test-host" },
  processRef: {
    cwd: () => process.cwd(),
    pid: 123,
    env: { NODE_ENV: "test" },
  },
  runtimePaths: {
    appRoot: process.cwd(),
    dataDir: path.join(process.cwd(), "data"),
    sqlitePath: path.join(process.cwd(), "data", "signalbrief.sqlite"),
    archiveDir: path.join(process.cwd(), "archive"),
    digestRecordsDir: path.join(process.cwd(), "data", "digest-records"),
    costLogPath: path.join(process.cwd(), "data", "cost-log.json"),
    engagementEventsPath: path.join(process.cwd(), "data", "engagement-events.jsonl"),
    adminActionLogPath: path.join(process.cwd(), "data", "admin-action-log.jsonl"),
    adminMessageLogPath: path.join(process.cwd(), "data", "admin-message-log.jsonl"),
    digestIncidentLogPath: path.join(process.cwd(), "data", "digest-incident-log.jsonl"),
    archiveLegacyUsageLogPath: path.join(process.cwd(), "data", "archive-legacy-usage-log.jsonl"),
    schedulerHeartbeatPath: path.join(process.cwd(), "data", "scheduler-heartbeat.json"),
    schedulerControlPath: path.join(process.cwd(), "data", "scheduler-control.json"),
    digestRunLockPath: path.join(process.cwd(), "data", "digest-run-lock.json"),
    digestOnDemandCooldownPath: path.join(process.cwd(), "data", "digest-ondemand-cooldown.json"),
    domainStatsPath: path.join(process.cwd(), "data", "domain-stats.json"),
    sourceRegistryPath: path.join(process.cwd(), "data", "source-registry.json"),
  },
  store: {
    getStateSnapshot() {
      return {
        mode: "canary",
        file: { initialized: true },
        sqlite: { initialized: true },
      };
    },
  },
  loadCostRunsNewest: () => [],
  loadEngagementEvents: () => [],
  digestDeliveryRecordRuntime: {
    summarizeRecordsState: () => ({ latest_timestamp: null }),
  },
});

const diagnostics = inspector.getRuntimeStateDiagnostics();
assert.strictEqual(diagnostics.store.backend, "canary");
assert.strictEqual(diagnostics.store.initialized, true);
assert.strictEqual(diagnostics.store.sqlite_path, path.join(process.cwd(), "data", "signalbrief.sqlite"));

const health = inspector.getRuntimeStateHealth();
assert.strictEqual(health.store_backend, "canary");
assert.strictEqual(health.store_sqlite_path, path.join(process.cwd(), "data", "signalbrief.sqlite"));
