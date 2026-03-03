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
      }));

      const weightValues = rows.map((r) => r.weight);
      const scoreValues = rows.map((r) => r.relevance);

      const corr = spearmanCorrelation(weightValues, scoreValues);
      const spread = stddev(scoreValues);
      const highLowAnomalies = rows.filter((r) => (r.weight <= -2 && r.relevance > 8) || (r.weight >= 4 && r.relevance < 5));
      const anomalyRate = rows.length ? highLowAnomalies.length / rows.length : 0;

      const corrNorm = ((corr + 1) / 2) * 100;
      const spreadScore = Math.max(0, Math.min(100, (spread / 2.0) * 100));
      const anomalyPenalty = Math.min(50, anomalyRate * 100);
      const score = Math.max(0, Math.min(100, 0.7 * corrNorm + 0.3 * spreadScore - anomalyPenalty));

      const passed = corr >= 0.65 && anomalyRate <= 0.05;

      perPersona[persona.id] = {
        persona: persona.name,
        correlation_spearman: Number(corr.toFixed(3)),
        score_spread_stddev: Number(spread.toFixed(3)),
        anomaly_rate: Number(anomalyRate.toFixed(3)),
        anomalies: highLowAnomalies,
        score: Number(score.toFixed(2)),
        passed,
      };

      suiteScores.push(score);

      if (!passed && persona.id === "weight_tweaker") {
        failures.push({
          persona: persona.name,
          issue: `Weight-to-score gate missed (corr=${corr.toFixed(2)} target>=0.65, anomalyRate=${(anomalyRate * 100).toFixed(1)}% target<=5%).`,
          evidence: highLowAnomalies,
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
