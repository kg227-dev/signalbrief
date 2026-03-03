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
        is_stress: !!persona.is_stress,
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
    const coreRows = ranked.filter((r) => !r.is_stress);
    const coreScores = coreRows.map((r) => r.score);
    const allSuiteScore = Number(mean(scores).toFixed(2));
    const coreAvg = Number(mean(coreScores).toFixed(2));
    const coreFloor = coreScores.length ? Number(Math.min(...coreScores).toFixed(2)) : 0;
    const coreAt80 = coreScores.filter((s) => s >= 80).length;

    let status = "pass";
    if ((coreAvg < 80 || coreFloor < 70) && coreAvg >= 70) status = "warn";
    else if (coreAvg < 70 || coreFloor < 65) status = "fail";

    const failures = coreRows
      .filter((r) => r.score < 65)
      .map((r) => ({ persona: r.persona, issue: `Composite score ${r.score.toFixed(1)} below 65.` }));

    const suggestions = [];
    if (coreRows.length > 0) {
      const bottom = coreRows[coreRows.length - 1];
      if (bottom.score < 80) {
        suggestions.push(
          `Prioritize fixes for ${bottom.persona}; it has the lowest core composite score (${bottom.score.toFixed(1)}).`
        );
      }
    }

    return {
      id: this.id,
      name: this.name,
      score: coreAvg,
      score_label: `${coreAvg.toFixed(1)}`,
      status,
      per_persona: perPersona,
      failures,
      suggestions,
      details: {
        target: "Core personas: avg >= 85, floor >= 75, at least 8/10 >= 80 for certification.",
        ranking: ranked,
        core_persona_summary: {
          count: coreRows.length,
          average: coreAvg,
          floor: coreFloor,
          at_or_above_80: coreAt80,
        },
        all_persona_average: allSuiteScore,
      },
      confidence: 0.86,
    };
  },
};
