"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Static imports for modules that are safe to execute in-process.
const digestRunner = require("../digest-runner");
const reengagement = require("../reengagement");
const marketingWeeklyReport = require("../scripts/marketing-weekly-report");
const selectionDomain = require("../selection-domain");
const digestEntrypoint = require("../src/entrypoints/digest");
const configProvider = require("../src/runtime/config-provider");
const engagementEvents = require("../src/runtime/engagement-events");
const mailer = require("../src/runtime/mailer");
const personalization = require("../src/runtime/personalization");
const qualityScore = require("../src/runtime/quality-score");
const replyHandler = require("../src/runtime/reply-handler");
const intentService = require("../src/runtime/reply/intent-service");
const onboardingService = require("../src/runtime/reply/onboarding-service");
const transport = require("../src/runtime/reply/transport");
const store = require("../src/runtime/store");
const sandboxPipeline = require("../src/sandbox-pipeline");
const cacheBudget = require("../test-harness/cache/cache-budget");
const cacheClaude = require("../test-harness/cache/cache-claude");
const cacheCommon = require("../test-harness/cache/cache-common");
const cachePerplexity = require("../test-harness/cache/cache-perplexity");
const harnessConfigConstants = require("../test-harness/config/config-constants");
const harnessEvaluator = require("../test-harness/evaluator");
const harnessRuntime = require("../test-harness/harness-runtime");
const harnessPersonasCanonical = require("../test-harness/personas/personas-canonical");
const harnessPipeline = require("../test-harness/pipeline");
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
const topicDomain = require("../topic-domain");
const adminAuth = require("../web/admin-auth");
const adminApiRoutes = require("../web/routes/admin-api");
const coreApiRoutes = require("../web/routes/core-api");
const adminOpsService = require("../web/services/admin-ops");
const deliverySchedule = require("../web/services/delivery-schedule");

// Static resolution for modules with side-effects or browser globals.
const smokeAdminSchedulerScriptPath = require.resolve("../scripts/smoke-admin-scheduler.js");
const smokeWorkerScriptPath = require.resolve("../scripts/smoke-worker.js");
const testCriticalPathsScriptPath = require.resolve("../scripts/test-critical-paths.js");
const botServerEntrypointPath = require.resolve("../src/entrypoints/bot-server.js");
const schedulerWorkerEntrypointPath = require.resolve("../src/entrypoints/scheduler-worker.js");
const harnessRunMatrixScriptPath = require.resolve("../test-harness/run-matrix.js");
const webIndexPath = require.resolve("../web/index.js");
const webPreferencesSharedPath = require.resolve("../web/preferences-shared.js");
const webServerPath = require.resolve("../web/server.js");
const webSettingsRuntimePath = require.resolve("../web/settings-runtime.js");

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

function runModuleCoverageTests() {
  const sourceOnlyTargets = [
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
      file: "src/entrypoints/bot-server.js",
      absPath: botServerEntrypointPath,
      snippets: ["async function poll()", "runLoop();"],
    },
    {
      file: "src/entrypoints/scheduler-worker.js",
      absPath: schedulerWorkerEntrypointPath,
      snippets: ["function runDigest(trigger)", "setInterval(() => runDigest(\"interval\"), POLL_MS);"],
    },
    {
      file: "test-harness/run-matrix.js",
      absPath: harnessRunMatrixScriptPath,
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
      snippets: ["http.createServer", "server.listen(PORT"],
    },
    {
      file: "web/settings-runtime.js",
      absPath: webSettingsRuntimePath,
      snippets: ["window.SignalBriefPrefs", "document.getElementById"],
    },
  ];

  for (const target of sourceOnlyTargets) {
    assertNodeSyntaxFile(target.absPath);
    assertSourceIncludesPath(target.absPath, target.snippets);
  }

  assertExportShape("src/entrypoints/digest.js", digestEntrypoint, [
    "fetchTopicNews",
    "enrichItems",
    "buildEmail",
    "scoreColor",
  ]);
  assertExportShape("src/runtime/config-provider.js", configProvider, ["CONFIG_PATH", "loadConfig"]);
  assertExportShape("src/runtime/engagement-events.js", engagementEvents, ["appendEngagementEvent", "loadEngagementEvents"]);
  assertExportShape("src/runtime/mailer.js", mailer, ["sendEmail", "sendWelcomeEmail", "sendReengagementDay4Email"]);
  assertExportShape("src/runtime/personalization.js", personalization, ["applyAutoTopicLearning"]);
  assertExportShape("src/runtime/quality-score.js", qualityScore, ["computeDigestQualityScore", "qualityBand"]);
  assertExportShape("src/runtime/reply-handler.js", replyHandler, ["createReplyState", "resetReplyState", "handle", "handleCallback"]);
  assertExportShape("src/runtime/reply/intent-service.js", intentService, ["createIntentService", "normalizeIntentPayload"]);
  assertExportShape("src/runtime/reply/onboarding-service.js", onboardingService, ["createOnboardingService"]);
  assertExportShape("src/runtime/reply/transport.js", transport, ["httpsPost", "createTelegramTransport", "createAnthropicTransport"]);
  assertExportShape("src/runtime/store.js", store, ["initStore", "readUser", "writeUser", "findUserByToken"]);
  assertExportShape("src/sandbox-pipeline.js", sandboxPipeline, ["estimateCost", "runPipeline"]);

  const loadedModules = [
    ["digest-runner.js", digestRunner],
    ["reengagement.js", reengagement],
    ["scripts/marketing-weekly-report.js", marketingWeeklyReport],
    ["selection-domain.js", selectionDomain],
    ["test-harness/cache/cache-budget.js", cacheBudget],
    ["test-harness/cache/cache-claude.js", cacheClaude],
    ["test-harness/cache/cache-common.js", cacheCommon],
    ["test-harness/cache/cache-perplexity.js", cachePerplexity],
    ["test-harness/config/config-constants.js", harnessConfigConstants],
    ["test-harness/evaluator.js", harnessEvaluator],
    ["test-harness/harness-runtime.js", harnessRuntime],
    ["test-harness/personas/personas-canonical.js", harnessPersonasCanonical],
    ["test-harness/pipeline.js", harnessPipeline],
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
    ["topic-domain.js", topicDomain],
    ["web/admin-auth.js", adminAuth],
    ["web/routes/admin-api.js", adminApiRoutes],
    ["web/routes/core-api.js", coreApiRoutes],
    ["web/services/admin-ops.js", adminOpsService],
    ["web/services/delivery-schedule.js", deliverySchedule],
  ];

  for (const [name, exported] of loadedModules) {
    assertModuleLoaded(name, exported);
  }
}

module.exports = {
  runModuleCoverageTests,
};
