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

      const corrNorm = ((corr + 1) / 2) * 100;
      const spreadScore = Math.max(0, Math.min(100, (spread / 2.0) * 100));
      const anomalyPenalty = highLowAnomalies.length * 12;
      const score = Math.max(0, Math.min(100, 0.7 * corrNorm + 0.3 * spreadScore - anomalyPenalty));

      const passed = corr >= 0.6 || rows.length < 3;

      perPersona[persona.id] = {
        persona: persona.name,
        correlation_spearman: Number(corr.toFixed(3)),
        score_spread_stddev: Number(spread.toFixed(3)),
        anomalies: highLowAnomalies,
        score: Number(score.toFixed(2)),
        passed,
      };

      suiteScores.push(score);

      if (!passed && persona.id === "weight_tweaker") {
        failures.push({
          persona: persona.name,
          issue: `Weight-to-score correlation below target (actual ${corr.toFixed(2)}, target > 0.6).`,
          evidence: highLowAnomalies,
        });
      }
    }

    const suiteScore = Number(mean(suiteScores).toFixed(2));
    const tweaker = perPersona.weight_tweaker;

    let status = "pass";
    if (tweaker && tweaker.correlation_spearman < 0.6 && suiteScore >= 60) status = "warn";
    else if (tweaker && tweaker.correlation_spearman < 0.6) status = "fail";

    if (status !== "pass") {
      suggestions.push(
        "Increase separation between exact-tag and partial-tag topicMatch scores to improve ordering sensitivity."
      );
      suggestions.push(
        "Audit weight matching for ambiguous labels (for example AI matching AIxTECH and unrelated variants)."
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
        target: "Spearman correlation > 0.6 for Weight Tweaker",
        weight_tweaker_correlation: tweaker ? tweaker.correlation_spearman : null,
      },
      confidence: 0.82,
    };
  },
};
