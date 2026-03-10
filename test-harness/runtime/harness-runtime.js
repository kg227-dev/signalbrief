const fs = require("fs");

const {
  COSTS,
  MODEL_PRICING,
  IMPROVEMENT_LOG_FILE,
  ensureHarnessPaths,
  parseArgs,
  loadAppConfig,
  writeJson,
} = require("../config");
const { loadBudget } = require("../cache");
const { buildPersonas } = require("./personas");
const { buildEvaluator } = require("./evaluator");
const { runDatasetStage, standardTopicUniverse } = require("../stages/dataset");
const { runSuiteRunnerStage } = require("../stages/suite-runner");
const { runAnalyticsStage } = require("../stages/analytics");
const { runReportingStage } = require("../stages/reporting");

function ensureImprovementLogFile() {
  if (!fs.existsSync(IMPROVEMENT_LOG_FILE)) {
    writeJson(IMPROVEMENT_LOG_FILE, []);
  }
}

function buildRunId(timestamp) {
  return String(timestamp || "").replace(/[:.]/g, "-");
}

function parseHarnessArgs(argv) {
  const args = parseArgs(argv);
  if (args.matrix) {
    throw new Error("--matrix is handled by test-harness/run-matrix.js. Use `node test-harness/run-matrix.js --matrix=<path>`.");
  }
  return args;
}

function buildHarnessEvaluator({ appConfig, budget, args }) {
  return buildEvaluator({
    appConfig,
    budget,
    allowLiveApi: args.allow_live_api,
    refreshCache: args.refresh_cache,
    noJudge: args.no_judge,
    costs: {
      ...COSTS,
      model_pricing: MODEL_PRICING,
    },
    judgeModel: args.judge_model,
  });
}

async function runHarness(argv = process.argv.slice(2)) {
  ensureHarnessPaths();

  const args = parseHarnessArgs(argv);
  const appConfig = loadAppConfig();
  const budget = loadBudget();
  const personas = buildPersonas(standardTopicUniverse(appConfig), { includeStress: true });
  const { dataset, archives, recentRepeatIndex } = await runDatasetStage({
    appConfig,
    personas,
    args,
    budget,
  });

  ensureImprovementLogFile();

  const evaluator = buildHarnessEvaluator({
    appConfig,
    budget,
    args,
  });

  const { suiteResults, compositeSummary, compositeScoresByPersona } = await runSuiteRunnerStage({
    args,
    appConfig,
    personas,
    dataset,
    archives,
    recentRepeatIndex,
    evaluator,
    budget,
  });

  const timestamp = new Date().toISOString();
  const runId = buildRunId(timestamp);
  const { sampleSizes, confidence, improvementPriorities, regressionAgainstBaseline } = runAnalyticsStage({
    suiteResults,
    evaluator,
    confidenceBootstrap: args.confidence_bootstrap,
    compositeAverage: compositeSummary.average_score,
  });

  const { report, rolling, datasetSnapshotPath, datasetRunSnapshotPath } = runReportingStage({
    timestamp,
    runId,
    runLabel: args.run_label || null,
    budget,
    suites: suiteResults,
    sampleSizes,
    confidence,
    regressionAgainstBaseline,
    compositeScoresByPersona,
    improvementPriorities,
    compositeSummary,
    dataset,
  });

  return {
    args,
    report,
    dataset,
    datasetSnapshotPath,
    datasetRunSnapshotPath,
    rolling,
    budget,
  };
}

module.exports = {
  runHarness,
};
