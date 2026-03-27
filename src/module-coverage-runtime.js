"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Static imports for modules that are safe to execute in-process.
const digestRunner = require("./jobs/digest-runner-runtime");
const reengagement = require("./jobs/reengagement-runtime");
const marketingWeeklyReport = require("../scripts/marketing-weekly-report");
const selectionDomain = require("./digest/domain/selection-domain-runtime");
const schedulerWorkerEntrypoint = require("../src/entrypoints/scheduler-worker");
const digestEntrypoint = require("../src/entrypoints/digest");
const configProvider = require("../src/runtime/config-provider");
const engagementEvents = require("../src/runtime/engagement/engagement-events-runtime");
const mailer = require("../src/runtime/mailer/mailer-runtime");
const personalization = require("../src/runtime/personalization/personalization-runtime");
const qualityScore = require("../src/runtime/quality-score");
const store = require("../src/runtime/store");
const sandboxPipeline = require("../src/sandbox-pipeline-runtime");
const cacheBudget = require("../test-harness/cache/cache-budget");
const cacheClaude = require("../test-harness/cache/cache-claude");
const cacheCommon = require("../test-harness/cache/cache-common");
const cachePerplexity = require("../test-harness/cache/cache-perplexity");
const harnessConfigConstants = require("../test-harness/config/config-constants");
const harnessEvaluator = require("../test-harness/runtime/evaluator");
const harnessRuntime = require("../test-harness/runtime/harness-runtime");
const harnessMatrixRuntime = require("../test-harness/runtime/matrix-runtime");
const harnessPersonasCanonical = require("../test-harness/personas/personas-canonical");
const harnessPipeline = require("../test-harness/runtime/pipeline");
const harnessAnalyticsStage = require("../test-harness/stages/analytics");
const harnessDatasetStage = require("../test-harness/stages/dataset");
const harnessSuiteRunnerStage = require("../test-harness/stages/suite-runner");
const harnessSuiteModuleCoverage = require("../test-harness/suites/10-module-coverage");
const harnessSuiteAnalysisQuality = require("../test-harness/suites/analysis-quality-runtime");
const harnessSuiteCrossDayFreshness = require("../test-harness/suites/cross-day-freshness-runtime");
const harnessSuiteCustomTopics = require("../test-harness/suites/custom-topics-runtime");
const harnessSuiteDepthControl = require("../test-harness/suites/depth-control-runtime");
const harnessSuiteEndToEnd = require("../test-harness/suites/end-to-end-runtime");
const harnessSuiteRelevanceScoring = require("../test-harness/suites/relevance-scoring-runtime");
const topicDomain = require("./digest/domain/topic-domain-runtime");
const adminAuth = require("../web/admin-auth");
const adminApiRoutes = require("../web/routes/admin-api");
const coreApiRoutes = require("../web/routes/core-api");
const adminOpsService = require("../web/services/admin-ops");
const archiveScoringService = require("../web/services/archive-scoring");
const deliverySchedule = require("../web/services/delivery-schedule");
const reengagementStateService = require("../web/services/reengagement-state");
const requestMetadataService = require("../web/services/request-metadata");
const webRateLimitService = require("../web/services/web-rate-limit");

// Static resolution for modules with side-effects or browser globals.
const smokeAdminSchedulerScriptPath = require.resolve("../scripts/smoke-admin-scheduler.js");
const smokeWorkerScriptPath = require.resolve("../scripts/smoke-worker.js");
const testCriticalPathsScriptPath = require.resolve("../scripts/test-critical-paths.js");
const harnessRunMatrixScriptPath = require.resolve("../test-harness/run-matrix.js");
const harnessMatrixRuntimePath = require.resolve("../test-harness/runtime/matrix-runtime.js");
const webIndexPath = require.resolve("../web/index.js");
const webPreferencesSharedPath = require.resolve("../web/preferences-shared.js");
const webServerPath = require.resolve("../web/server.js");
const webSettingsRuntimePath = require.resolve("../web/settings-runtime.js");
const webSettingsUiRuntimePath = require.resolve("../web/settings-ui-runtime.js");

function assertNodeSyntaxFile(absPath) {
  execFileSync(process.execPath, ["--check", absPath], { stdio: "pipe" });
}

function assertModuleLoaded(name, exported) {
  assert.ok(exported !== undefined && exported !== null, `${name} should export a value`);
  const type = typeof exported;
  assert.ok(type === "object" || type === "function", `${name} should export an object or function`);
}

function assertExportShape(name, exported, expectedKeys) {
  assertModuleLoaded(name, exported);
  for (const key of expectedKeys) {
    assert.ok(key in exported, `${name} should export ${key}`);
  }
}

function assertSourceIncludesPath(absPath, snippets) {
  const source = fs.readFileSync(absPath, "utf8");
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${absPath} should include snippet: ${snippet}`);
  }
}

const SOURCE_ONLY_TARGETS = [
  {
    file: "scripts/smoke-admin-scheduler.js",
    absPath: smokeAdminSchedulerScriptPath,
    snippets: ["spawn(process.execPath", "[smoke-admin-scheduler] ok"],
  },
  {
    file: "scripts/smoke-worker.js",
    absPath: smokeWorkerScriptPath,
    snippets: ["spawn(process.execPath", "[smoke-worker] ok"],
  },
  {
    file: "scripts/test-critical-paths.js",
    absPath: testCriticalPathsScriptPath,
    snippets: ["testModuleCoverageContracts", "main().catch((err)"],
  },
  {
    file: "test-harness/run-matrix.js",
    absPath: harnessRunMatrixScriptPath,
    snippets: ["runMatrix", "main().catch((err)"],
  },
  {
    file: "test-harness/runtime/matrix-runtime.js",
    absPath: harnessMatrixRuntimePath,
    snippets: ["buildWindowPlan", "Matrix report written:"],
  },
  {
    file: "web/index.js",
    absPath: webIndexPath,
    snippets: ["window.SignalBriefPrefs", "document.querySelector"],
  },
  {
    file: "web/preferences-shared.js",
    absPath: webPreferencesSharedPath,
    snippets: ["bootstrapPreferences", "SignalBriefPrefs"],
  },
  {
    file: "web/server.js",
    absPath: webServerPath,
    snippets: ["http.createServer", "server.listen(port", "getServerPort()"],
  },
  {
    file: "web/settings-runtime.js",
    absPath: webSettingsRuntimePath,
    snippets: ["bootstrapSettingsRuntime", "document.getElementById"],
  },
  {
    file: "web/settings-ui-runtime.js",
    absPath: webSettingsUiRuntimePath,
    snippets: ["bootstrapSettingsUiRuntime", "SignalBriefSettingsUiRuntime"],
  },
];

const EXPORT_SHAPES = [
  ["src/entrypoints/scheduler-worker.js", schedulerWorkerEntrypoint, ["runDigest", "writeHeartbeat", "startSchedulerWorker", "stopSchedulerWorker"]],
  ["src/entrypoints/digest.js", digestEntrypoint, ["fetchTopicNews", "enrichItems", "buildEmail", "scoreColor"]],
  ["src/runtime/config-provider.js", configProvider, ["CONFIG_PATH", "loadConfig"]],
  ["src/runtime/engagement/engagement-events-runtime.js", engagementEvents, ["appendEngagementEvent", "loadEngagementEvents"]],
  ["src/runtime/mailer/mailer-runtime.js", mailer, ["sendEmail", "sendWelcomeEmail", "sendReengagementDay4Email"]],
  ["src/runtime/personalization/personalization-runtime.js", personalization, ["applyAutoTopicLearning"]],
  ["src/runtime/quality-score.js", qualityScore, ["computeDigestQualityScore", "qualityBand"]],
  ["src/runtime/store.js", store, ["createStore", "initStore", "readUser", "writeUser", "findUserByToken"]],
  ["src/sandbox-pipeline-runtime.js", sandboxPipeline, ["estimateCost", "runPipeline"]],
];

const LOADED_MODULES = [
  ["src/jobs/digest-runner-runtime.js", digestRunner],
  ["src/jobs/reengagement-runtime.js", reengagement],
  ["scripts/marketing-weekly-report.js", marketingWeeklyReport],
  ["src/digest/domain/selection-domain-runtime.js", selectionDomain],
  ["test-harness/cache/cache-budget.js", cacheBudget],
  ["test-harness/cache/cache-claude.js", cacheClaude],
  ["test-harness/cache/cache-common.js", cacheCommon],
  ["test-harness/cache/cache-perplexity.js", cachePerplexity],
  ["test-harness/config/config-constants.js", harnessConfigConstants],
  ["test-harness/runtime/evaluator.js", harnessEvaluator],
  ["test-harness/runtime/harness-runtime.js", harnessRuntime],
  ["test-harness/runtime/matrix-runtime.js", harnessMatrixRuntime],
  ["test-harness/personas/personas-canonical.js", harnessPersonasCanonical],
  ["test-harness/runtime/pipeline.js", harnessPipeline],
  ["test-harness/stages/analytics.js", harnessAnalyticsStage],
  ["test-harness/stages/dataset.js", harnessDatasetStage],
  ["test-harness/stages/suite-runner.js", harnessSuiteRunnerStage],
  ["test-harness/suites/10-module-coverage.js", harnessSuiteModuleCoverage],
  ["test-harness/suites/analysis-quality-runtime.js", harnessSuiteAnalysisQuality],
  ["test-harness/suites/cross-day-freshness-runtime.js", harnessSuiteCrossDayFreshness],
  ["test-harness/suites/custom-topics-runtime.js", harnessSuiteCustomTopics],
  ["test-harness/suites/depth-control-runtime.js", harnessSuiteDepthControl],
  ["test-harness/suites/end-to-end-runtime.js", harnessSuiteEndToEnd],
  ["test-harness/suites/relevance-scoring-runtime.js", harnessSuiteRelevanceScoring],
  ["src/digest/domain/topic-domain-runtime.js", topicDomain],
  ["web/admin-auth.js", adminAuth],
  ["web/routes/admin-api.js", adminApiRoutes],
  ["web/routes/core-api.js", coreApiRoutes],
  ["web/services/admin-ops.js", adminOpsService],
  ["web/services/archive-scoring.js", archiveScoringService],
  ["web/services/delivery-schedule.js", deliverySchedule],
  ["web/services/reengagement-state.js", reengagementStateService],
  ["web/services/request-metadata.js", requestMetadataService],
  ["web/services/web-rate-limit.js", webRateLimitService],
];

function assertSourceOnlyTargets() {
  for (const target of SOURCE_ONLY_TARGETS) {
    assertNodeSyntaxFile(target.absPath);
    assertSourceIncludesPath(target.absPath, target.snippets);
  }
}

function assertExportShapes() {
  for (const [name, exported, keys] of EXPORT_SHAPES) {
    assertExportShape(name, exported, keys);
  }
}

function assertLoadedModules() {
  for (const [name, exported] of LOADED_MODULES) {
    assertModuleLoaded(name, exported);
  }
}

function assertBehaviorContracts() {
  const sampleItems = [
    { tag: "AI×TECH", headline: "AI deal 1", url: "https://a.example/1", source_domain: "a.example" },
    { tag: "AI×TECH", headline: "AI deal 2", url: "https://b.example/2", source_domain: "b.example" },
    { tag: "HEALTHCARE", headline: "Health update", url: "https://c.example/3", source_domain: "c.example" },
  ];
  const selected = selectionDomain.selectItemsByPolicy(
    sampleItems,
    { maxItems: 2, perTagCap: 1, perSourceCap: 1 },
    {
      normalizeUrl: (url) => String(url || ""),
      parseDomain: (item) => String(item?.source_domain || "unknown"),
      normalizeTopicToken: topicDomain.normalizeTopicToken,
      headlineFingerprint: (item) => String(item?.headline || ""),
      isCandidate: () => true,
    }
  );
  assert.strictEqual(selected.length, 2, "selection-domain-runtime should enforce selection policy caps");
  assert.notStrictEqual(
    topicDomain.normalizeTopicToken(selected[0].tag),
    topicDomain.normalizeTopicToken(selected[1].tag),
    "selection-domain-runtime should respect per-tag cap"
  );

  const exactTopicScore = topicDomain.computeTopicMatch(
    { tag: "AI×TECH", headline: "", summary: "" },
    ["AI×TECH"]
  );
  assert.strictEqual(exactTopicScore, 10, "topic-domain-runtime should score exact tag-topic matches as strong");
  const customTopicScore = topicDomain.computeTopicMatch(
    { tag: "", headline: "Federal Reserve weighs additional interest rate cuts", summary: "" },
    ["custom_rate_cuts"]
  );
  assert.ok(customTopicScore >= 7, "topic-domain-runtime should recognize custom keyword topic matches");

  const busyOutcome = digestRunner.toDigestTriggerOutcome({
    ok: false,
    code: "busy",
    admission: { lockState: "valid", lock: null },
  });
  assert.strictEqual(busyOutcome.busy, true, "digest-runner should normalize busy trigger outcomes");
  const unhealthyOutcome = digestRunner.toDigestTriggerOutcome({
    ok: false,
    code: "corrupt",
    admission: { lock: { error: "invalid_json" } },
  });
  assert.strictEqual(unhealthyOutcome.lockUnhealthy, true, "digest-runner should normalize unhealthy lock outcomes");
}

function runModuleCoverageTests() {
  assertSourceOnlyTargets();
  assertExportShapes();
  assertLoadedModules();
  assertBehaviorContracts();
}

module.exports = {
  runModuleCoverageTests,
};
