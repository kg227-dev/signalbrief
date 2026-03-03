const { mean } = require("../evaluator");
const { COMPOSITE_WEIGHTS } = require("../config");

function getPersonaSuiteScore(suite, personaId, fallback = null) {
  if (!suite) return fallback;
  const row = suite.per_persona && suite.per_persona[personaId];
  const rowScore = row ? row.score : null;
  if (rowScore !== null && rowScore !== undefined && rowScore !== "" && Number.isFinite(Number(rowScore))) {
    return Number(rowScore);
  }
  if (suite.score !== null && suite.score !== undefined && suite.score !== "" && Number.isFinite(Number(suite.score))) {
    return Number(suite.score);
  }
  return fallback;
}

module.exports = {
  id: "09-end-to-end",
  name: "End-to-End Composite",

  async run(context) {
    const { personas, suiteResultsById } = context;

    const topicSuite = suiteResultsById["01-topic-matching"];
    const relevanceSuite = suiteResultsById["02-relevance-scoring"];
    const analysisSuite = suiteResultsById["03-analysis-quality"];
    const diversitySuite = suiteResultsById["04-diversity"];
    const customSuite = suiteResultsById["05-custom-topics"];

    const perPersona = {};
    const scores = [];

    for (const persona of personas) {
      const components = [
        {
          key: "topic_matching",
          label: "Topic Matching",
          weight: COMPOSITE_WEIGHTS.topic_matching,
          score: getPersonaSuiteScore(topicSuite, persona.id, 0),
        },
        {
          key: "relevance_scoring",
          label: "Relevance Scoring",
          weight: COMPOSITE_WEIGHTS.relevance_scoring,
          score: getPersonaSuiteScore(relevanceSuite, persona.id, 0),
        },
        {
          key: "analysis_quality",
          label: "Analysis Quality",
          weight: COMPOSITE_WEIGHTS.analysis_quality,
          score: getPersonaSuiteScore(analysisSuite, persona.id, Number(analysisSuite?.score || 0)),
        },
        {
          key: "diversity",
          label: "Diversity",
          weight: COMPOSITE_WEIGHTS.diversity,
          score: getPersonaSuiteScore(diversitySuite, persona.id, 0),
        },
      ];

      const hasCustom = (persona.custom_topics || []).length > 0 || (persona.topics || []).some((t) => String(t).startsWith("custom_"));
      if (hasCustom) {
        components.push({
          key: "custom_topics",
          label: "Custom Topics",
          weight: COMPOSITE_WEIGHTS.custom_topics,
          score: getPersonaSuiteScore(customSuite, persona.id, Number(customSuite?.score || 0)),
        });
      }

      const weightSum = components.reduce((sum, c) => sum + c.weight, 0);
      const weighted = components.reduce((sum, c) => sum + c.score * c.weight, 0);
      const final = weightSum ? weighted / weightSum : 0;

      const status = final >= 80 ? "pass" : final >= 65 ? "warn" : "fail";
      perPersona[persona.id] = {
        persona: persona.name,
        score: Number(final.toFixed(2)),
        status,
        components: components.map((c) => ({
          key: c.key,
          label: c.label,
          weight: c.weight,
          score: Number(c.score.toFixed(2)),
        })),
      };
      scores.push(final);
    }

    const ranked = Object.values(perPersona).sort((a, b) => b.score - a.score);
    const suiteScore = Number(mean(scores).toFixed(2));

    let status = "pass";
    if (suiteScore < 80 && suiteScore >= 65) status = "warn";
    else if (suiteScore < 65) status = "fail";

    const failures = ranked
      .filter((r) => r.score < 65)
      .map((r) => ({ persona: r.persona, issue: `Composite score ${r.score.toFixed(1)} below 65.` }));

    const suggestions = [];
    if (ranked.length > 0) {
      const bottom = ranked[ranked.length - 1];
      if (bottom.score < 80) {
        suggestions.push(
          `Prioritize fixes for ${bottom.persona}; it has the lowest composite score (${bottom.score.toFixed(1)}).`
        );
      }
    }

    return {
      id: this.id,
      name: this.name,
      score: suiteScore,
      score_label: `${suiteScore.toFixed(1)}`,
      status,
      per_persona: perPersona,
      failures,
      suggestions,
      details: {
        target: "Composite >= 80 for all core personas.",
        ranking: ranked,
      },
      confidence: 0.84,
    };
  },
};
