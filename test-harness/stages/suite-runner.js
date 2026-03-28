const { SUITE_IDS } = require("../config");
const { createDigestPolicies } = require("../runtime/pipeline");

const suiteModules = [
  require("../suites/01-topic-matching"),
  require("../suites/02-relevance-scoring"),
  require("../suites/03-analysis-quality"),
  require("../suites/04-diversity"),
  require("../suites/06-depth-control"),
  require("../suites/07-item-count"),
  require("../suites/08-cross-day-freshness"),
  require("../suites/09-end-to-end"),
  require("../suites/10-module-coverage"),
];

function selectSuites(args) {
  if (!args.run_suite_ids || !args.run_suite_ids.length) {
    return suiteModules;
  }

  const wanted = new Set(
    args.run_suite_ids.map((raw) =>
      String(raw)
        .trim()
        .toLowerCase()
    )
  );

  return suiteModules.filter((suite) => {
    const id = String(suite.id || "").toLowerCase();
    const shortId = id.slice(0, 2);
    const key = id.replace(/^\d+-/, "");
    return wanted.has(id) || wanted.has(shortId) || wanted.has(key);
  });
}

function buildRuntime({ args, appConfig, dataset, recentRepeatIndex }) {
  const digestPolicies = createDigestPolicies({
    rankingPolicy: {
      repeatIndex: recentRepeatIndex,
      repeatPenalty: Math.max(0, Number(appConfig?.digest?.crossDayRepeatPenalty || 0.8)),
      minBaseScoreForFinal: Number(appConfig?.digest?.minBaseScoreForFinal || 6.5),
    },
    depthPolicy: {
      defaultItemCount: Number(dataset?.metadata?.selection_target || appConfig?.digest?.itemCount || 5),
      minFilteredItems: 3,
    },
  });

  return {
    defaultItemCount: digestPolicies.depthPolicy.defaultItemCount,
    digestPolicies,
    max_analysis_samples: args.max_analysis_samples,
    max_depth_pairs: args.max_depth_pairs,
    allow_live_api: args.allow_live_api,
    refresh_cache: args.refresh_cache,
    no_judge: args.no_judge,
    judge_model: args.judge_model,
    analysis_calibration_samples: Number(args.analysis_calibration_samples || 0),
    freshness_max_snapshots: Number(args.freshness_max_snapshots || 120),
    freshness_window_days: Math.max(3, Number(appConfig?.digest?.crossDayDedupDays || 3)),
    confidence_bootstrap: args.confidence_bootstrap,
    run_label: args.run_label,
  };
}

function buildCompositeSummary(suiteResultsById) {
  const compositeSuite = suiteResultsById["09-end-to-end"] || null;
  const rankedComposite = compositeSuite?.details?.ranking || [];

  return {
    compositeSuite,
    compositeScoresByPersona: compositeSuite?.per_persona || {},
    compositeSummary: {
      average_score: compositeSuite ? Number(compositeSuite.score || 0) : 0,
      best_persona: rankedComposite[0] || null,
      worst_persona: rankedComposite[rankedComposite.length - 1] || null,
    },
  };
}

/**
 * Suite runner stage interface.
 * @returns {Promise<{runtime: object, suiteResults: Array, suiteResultsById: object, compositeSummary: object, compositeScoresByPersona: object}>}
 */
async function runSuiteRunnerStage({
  args,
  appConfig,
  personas,
  dataset,
  archives,
  recentRepeatIndex,
  evaluator,
  budget,
}) {
  const runtime = buildRuntime({ args, appConfig, dataset, recentRepeatIndex });
  const chosenSuites = selectSuites(args);
  const suiteResults = [];
  const suiteResultsById = {};

  for (const suite of chosenSuites) {
    if (!SUITE_IDS.includes(suite.id)) continue;

    const result = await suite.run({
      personas,
      dataset,
      archives,
      runtime,
      evaluator,
      appConfig,
      budget,
      suiteResultsById,
    });

    suiteResults.push(result);
    suiteResultsById[suite.id] = result;
  }

  const {
    compositeSummary,
    compositeScoresByPersona,
  } = buildCompositeSummary(suiteResultsById);

  return {
    runtime,
    suiteResults,
    suiteResultsById,
    compositeSummary,
    compositeScoresByPersona,
  };
}

module.exports = {
  runSuiteRunnerStage,
};
