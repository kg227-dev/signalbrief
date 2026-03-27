const { mean } = require("../runtime/evaluator");
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

function buildComponentRows(persona, suites) {
  return [
    {
      key: "topic_matching",
      label: "Topic Matching",
      weight: COMPOSITE_WEIGHTS.topic_matching,
      score: getPersonaSuiteScore(suites.topicSuite, persona.id, 0),
    },
    {
      key: "relevance_scoring",
      label: "Relevance Scoring",
      weight: COMPOSITE_WEIGHTS.relevance_scoring,
      score: getPersonaSuiteScore(suites.relevanceSuite, persona.id, 0),
    },
    {
      key: "analysis_quality",
      label: "Analysis Quality",
      weight: COMPOSITE_WEIGHTS.analysis_quality,
      score: getPersonaSuiteScore(suites.analysisSuite, persona.id, Number(suites.analysisSuite?.score || 0)),
    },
    {
      key: "diversity",
      label: "Diversity",
      weight: COMPOSITE_WEIGHTS.diversity,
      score: getPersonaSuiteScore(suites.diversitySuite, persona.id, 0),
    },
  ];
}

function computePersonaComposite(components) {
  const weightSum = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, component) => sum + component.score * component.weight, 0);
  const final = weightSum ? weighted / weightSum : 0;
  return {
    score: final,
    status: final >= 80 ? "pass" : final >= 65 ? "warn" : "fail",
    components: components.map((component) => ({
      key: component.key,
      label: component.label,
      weight: component.weight,
      score: Number(component.score.toFixed(2)),
    })),
  };
}

function computeEndToEndStatus(coreAvg, coreFloor) {
  if ((coreAvg < 80 || coreFloor < 70) && coreAvg >= 70) return "warn";
  if (coreAvg < 70 || coreFloor < 65) return "fail";
  return "pass";
}

async function runEndToEndSuite(context, suiteMeta) {
  const { personas, suiteResultsById } = context;
  const suites = {
    topicSuite: suiteResultsById["01-topic-matching"],
    relevanceSuite: suiteResultsById["02-relevance-scoring"],
    analysisSuite: suiteResultsById["03-analysis-quality"],
    diversitySuite: suiteResultsById["04-diversity"],
  };

  const perPersona = {};
  const allScores = [];
  for (const persona of personas) {
    const composite = computePersonaComposite(buildComponentRows(persona, suites));
    perPersona[persona.id] = {
      persona: persona.name,
      is_stress: !!persona.is_stress,
      score: Number(composite.score.toFixed(2)),
      status: composite.status,
      components: composite.components,
    };
    allScores.push(composite.score);
  }

  const ranked = Object.values(perPersona).sort((a, b) => b.score - a.score);
  const coreRows = ranked.filter((row) => !row.is_stress);
  const coreScores = coreRows.map((row) => row.score);
  const allSuiteScore = Number(mean(allScores).toFixed(2));
  const coreAvg = Number(mean(coreScores).toFixed(2));
  const coreFloor = coreScores.length ? Number(Math.min(...coreScores).toFixed(2)) : 0;
  const coreAt80 = coreScores.filter((score) => score >= 80).length;
  const status = computeEndToEndStatus(coreAvg, coreFloor);

  const failures = coreRows
    .filter((row) => row.score < 65)
    .map((row) => ({ persona: row.persona, issue: `Composite score ${row.score.toFixed(1)} below 65.` }));

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
    id: suiteMeta.id,
    name: suiteMeta.name,
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
}

module.exports = {
  runEndToEndSuite,
};
