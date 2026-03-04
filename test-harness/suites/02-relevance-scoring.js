const { buildDigestForPersona, matchWeightToTag } = require("../pipeline");
const { mean, spearmanCorrelation } = require("../evaluator");

function stddev(values) {
  const arr = (values || []).filter((v) => Number.isFinite(v));
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const variance = mean(arr.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

module.exports = {
  id: "02-relevance-scoring",
  name: "Relevance Scoring",

  async run(context) {
    const { personas, dataset, runtime } = context;
    const perPersona = {};
    const failures = [];
    const suggestions = [];
    const suiteScores = [];

    for (const persona of personas) {
      const digest = buildDigestForPersona(dataset.enriched_items, persona, runtime);
      const weights = persona.topic_weights || {};
      const rows = digest.items.map((item) => ({
        headline: item.headline,
        tag: item.tag,
        relevance: Number(item.relevanceScore || 0),
        weight: Number(matchWeightToTag(item.tag, weights) || 0),
        topic_match: Number(item.topicMatch || 0),
        base_score: Number(item.baseScore || 0),
      }));

      const weightValues = rows.map((r) => r.weight);
      const scoreValues = rows.map((r) => r.relevance);
      const hasWeightSignal = weightValues.some((v) => Math.abs(v) > 0.01)
        && new Set(weightValues.map((v) => v.toFixed(3))).size > 1;

      let corr = 0;
      let spread = stddev(scoreValues);
      let anomalies = [];
      let anomalyRate = 0;
      let score = 0;
      let passed = false;
      let mode = "weights";

      if (hasWeightSignal) {
        corr = spearmanCorrelation(weightValues, scoreValues);
        anomalies = rows.filter((r) => (r.weight <= -2 && r.relevance > 8) || (r.weight >= 4 && r.relevance < 5));
        anomalyRate = rows.length ? anomalies.length / rows.length : 0;

        const corrNorm = ((corr + 1) / 2) * 100;
        const spreadScore = Math.max(0, Math.min(100, (spread / 2.0) * 100));
        const anomalyPenalty = Math.min(50, anomalyRate * 100);
        score = Math.max(0, Math.min(100, 0.7 * corrNorm + 0.3 * spreadScore - anomalyPenalty));
        passed = corr >= 0.65 && anomalyRate <= 0.05;
      } else if (rows.length < 3) {
        mode = "baseline-low-sample";
        score = rows.length ? 75 : 0;
        passed = rows.length > 0;
      } else {
        mode = "baseline-no-weights";
        const expected = rows.map((r) => Number((r.base_score * 0.6 + r.topic_match * 0.4).toFixed(3)));
        corr = spearmanCorrelation(expected, scoreValues);
        anomalies = rows.filter((r) => (r.topic_match >= 7 && r.relevance < 6) || (r.topic_match <= 3 && r.relevance > 8.8));
        anomalyRate = rows.length ? anomalies.length / rows.length : 0;

        const corrNorm = ((corr + 1) / 2) * 100;
        const spreadScore = Math.max(0, Math.min(100, (spread / 2.0) * 100));
        const anomalyPenalty = Math.min(40, anomalyRate * 100);
        score = Math.max(0, Math.min(100, 0.75 * corrNorm + 0.25 * spreadScore - anomalyPenalty));
        passed = corr >= 0.6 && anomalyRate <= 0.1;
      }

      perPersona[persona.id] = {
        persona: persona.name,
        mode,
        correlation_spearman: Number(corr.toFixed(3)),
        score_spread_stddev: Number(spread.toFixed(3)),
        anomaly_rate: Number(anomalyRate.toFixed(3)),
        anomalies,
        score: Number(score.toFixed(2)),
        passed,
      };

      suiteScores.push(score);

      if (!passed && persona.id === "weight_tweaker") {
        failures.push({
          persona: persona.name,
          issue: `Weight-to-score gate missed (corr=${corr.toFixed(2)} target>=0.65, anomalyRate=${(anomalyRate * 100).toFixed(1)}% target<=5%).`,
          evidence: anomalies,
        });
      }
    }

    const suiteScore = Number(mean(suiteScores).toFixed(2));
    const tweaker = perPersona.weight_tweaker;

    let status = "pass";
    if (tweaker && (tweaker.correlation_spearman < 0.65 || tweaker.anomaly_rate > 0.05) && suiteScore >= 70) status = "warn";
    else if (tweaker && (tweaker.correlation_spearman < 0.65 || tweaker.anomaly_rate > 0.05)) status = "fail";

    if (status !== "pass") {
      suggestions.push(
        "Increase separation between exact-tag and partial-tag topicMatch scores to improve ordering sensitivity."
      );
      suggestions.push(
        "Audit weight matching for ambiguous labels and ensure strong positive weights do not lose to weak base-score noise."
      );
    }

    return {
      id: this.id,
      name: this.name,
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
  },
};
