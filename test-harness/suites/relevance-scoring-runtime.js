const { buildDigestForPersona, matchWeightToTag } = require("../runtime/pipeline");
const { mean, spearmanCorrelation } = require("../runtime/evaluator");

function stddev(values) {
  const arr = (values || []).filter((value) => Number.isFinite(value));
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const variance = mean(arr.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function buildRelevanceRows(digest, weights) {
  return digest.items.map((item) => ({
    headline: item.headline,
    tag: item.tag,
    relevance: Number(item.relevanceScore || 0),
    weight: Number(matchWeightToTag(item.tag, weights) || 0),
    topic_match: Number(item.topicMatch || 0),
    base_score: Number(item.baseScore || 0),
  }));
}

function hasWeightSignal(rows) {
  const weightValues = rows.map((row) => row.weight);
  return (
    weightValues.some((value) => Math.abs(value) > 0.01)
    && new Set(weightValues.map((value) => value.toFixed(3))).size > 1
  );
}

function scoreWithWeights(rows, scoreValues) {
  const weightValues = rows.map((row) => row.weight);
  const corr = spearmanCorrelation(weightValues, scoreValues);
  const anomalies = rows.filter(
    (row) => (row.weight <= -2 && row.relevance > 8) || (row.weight >= 4 && row.relevance < 5)
  );
  const anomalyRate = rows.length ? anomalies.length / rows.length : 0;
  const spread = stddev(scoreValues);
  const corrNorm = ((corr + 1) / 2) * 100;
  const spreadScore = Math.max(0, Math.min(100, (spread / 2.0) * 100));
  const anomalyPenalty = Math.min(50, anomalyRate * 100);
  const score = Math.max(0, Math.min(100, 0.7 * corrNorm + 0.3 * spreadScore - anomalyPenalty));

  return {
    mode: "weights",
    corr,
    spread,
    anomalies,
    anomalyRate,
    score,
    passed: corr >= 0.65 && anomalyRate <= 0.05,
  };
}

function scoreWithBaseline(rows, scoreValues) {
  if (rows.length < 3) {
    return {
      mode: "baseline-low-sample",
      corr: 0,
      spread: stddev(scoreValues),
      anomalies: [],
      anomalyRate: 0,
      score: rows.length ? 75 : 0,
      passed: rows.length > 0,
    };
  }

  const expected = rows.map((row) => Number((row.base_score * 0.6 + row.topic_match * 0.4).toFixed(3)));
  const corr = spearmanCorrelation(expected, scoreValues);
  const anomalies = rows.filter(
    (row) => (row.topic_match >= 7 && row.relevance < 6) || (row.topic_match <= 3 && row.relevance > 8.8)
  );
  const anomalyRate = rows.length ? anomalies.length / rows.length : 0;
  const spread = stddev(scoreValues);
  const corrNorm = ((corr + 1) / 2) * 100;
  const spreadScore = Math.max(0, Math.min(100, (spread / 2.0) * 100));
  const anomalyPenalty = Math.min(40, anomalyRate * 100);
  const score = Math.max(0, Math.min(100, 0.75 * corrNorm + 0.25 * spreadScore - anomalyPenalty));

  return {
    mode: "baseline-no-weights",
    corr,
    spread,
    anomalies,
    anomalyRate,
    score,
    passed: corr >= 0.6 && anomalyRate <= 0.1,
  };
}

function evaluatePersonaRelevance(persona, dataset, runtime) {
  const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime.digestPolicies);
  const weights = persona.topic_weights || {};
  const rows = buildRelevanceRows(digest, weights);
  const scoreValues = rows.map((row) => row.relevance);
  const evaluation = hasWeightSignal(rows) ? scoreWithWeights(rows, scoreValues) : scoreWithBaseline(rows, scoreValues);

  return {
    personaRow: {
      persona: persona.name,
      mode: evaluation.mode,
      correlation_spearman: Number(evaluation.corr.toFixed(3)),
      score_spread_stddev: Number(evaluation.spread.toFixed(3)),
      anomaly_rate: Number(evaluation.anomalyRate.toFixed(3)),
      anomalies: evaluation.anomalies,
      score: Number(evaluation.score.toFixed(2)),
      passed: evaluation.passed,
    },
    raw: evaluation,
  };
}

function computeRelevanceSuiteStatus(tweaker, suiteScore) {
  if (!tweaker) return "pass";
  const failedGate = tweaker.correlation_spearman < 0.65 || tweaker.anomaly_rate > 0.05;
  if (failedGate && suiteScore >= 70) return "warn";
  if (failedGate) return "fail";
  return "pass";
}

async function runRelevanceScoringSuite(context, suiteMeta) {
  const { personas, dataset, runtime } = context;
  const perPersona = {};
  const failures = [];
  const suggestions = [];
  const suiteScores = [];

  for (const persona of personas) {
    const { personaRow, raw } = evaluatePersonaRelevance(persona, dataset, runtime);
    perPersona[persona.id] = personaRow;
    suiteScores.push(raw.score);

    if (!raw.passed && persona.id === "weight_tweaker") {
      failures.push({
        persona: persona.name,
        issue: `Weight-to-score gate missed (corr=${raw.corr.toFixed(2)} target>=0.65, anomalyRate=${(raw.anomalyRate * 100).toFixed(1)}% target<=5%).`,
        evidence: raw.anomalies,
      });
    }
  }

  const suiteScore = Number(mean(suiteScores).toFixed(2));
  const tweaker = perPersona.weight_tweaker;
  const status = computeRelevanceSuiteStatus(tweaker, suiteScore);
  if (status !== "pass") {
    suggestions.push("Increase separation between exact-tag and partial-tag topicMatch scores to improve ordering sensitivity.");
    suggestions.push("Audit weight matching for ambiguous labels and ensure strong positive weights do not lose to weak base-score noise.");
  }

  return {
    id: suiteMeta.id,
    name: suiteMeta.name,
    score: suiteScore,
    score_label: `${suiteScore.toFixed(1)}%`,
    status,
    per_persona: perPersona,
    failures,
    suggestions,
    details: {
      target: "Weight Tweaker Spearman >= 0.65 and anomaly rate <= 5%",
      weight_tweaker_correlation: tweaker ? tweaker.correlation_spearman : null,
      weight_tweaker_anomaly_rate: tweaker ? tweaker.anomaly_rate : null,
    },
    confidence: 0.84,
  };
}

module.exports = {
  runRelevanceScoringSuite,
};
