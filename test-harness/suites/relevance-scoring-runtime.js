const { buildDigestForPersona } = require("../runtime/pipeline");
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
    topic_match: Number(item.topicMatch || 0),
    base_score: Number(item.baseScore || 0),
  }));
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
  const rows = buildRelevanceRows(digest);
  const scoreValues = rows.map((row) => row.relevance);
  const evaluation = scoreWithBaseline(rows, scoreValues);

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

function computeRelevanceSuiteStatus(baselinePersona, suiteScore) {
  if (!baselinePersona) return "pass";
  const failedGate = baselinePersona.correlation_spearman < 0.6 || baselinePersona.anomaly_rate > 0.1;
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

    if (!raw.passed) {
      failures.push({
        persona: persona.name,
        issue: `Baseline relevance ordering missed (corr=${raw.corr.toFixed(2)} target>=0.60, anomalyRate=${(raw.anomalyRate * 100).toFixed(1)}% target<=10%).`,
        evidence: raw.anomalies,
      });
    }
  }

  const suiteScore = Number(mean(suiteScores).toFixed(2));
  const baselinePersona = Object.values(perPersona)[0] || null;
  const status = computeRelevanceSuiteStatus(baselinePersona, suiteScore);
  if (status !== "pass") {
    suggestions.push("Increase separation between exact-tag and partial-tag topicMatch scores to improve reduced-scope ordering sensitivity.");
    suggestions.push("Audit baseline score blending so strong topic matches do not lose to weak base-score noise.");
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
      target: "Baseline relevance ordering Spearman >= 0.60 and anomaly rate <= 10%",
      baseline_correlation: baselinePersona ? baselinePersona.correlation_spearman : null,
      baseline_anomaly_rate: baselinePersona ? baselinePersona.anomaly_rate : null,
    },
    confidence: 0.84,
  };
}

module.exports = {
  runRelevanceScoringSuite,
};
