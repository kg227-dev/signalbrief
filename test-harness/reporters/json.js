const path = require("path");
const { writeJson } = require("../config");

function suiteKey(id) {
  return String(id || "")
    .replace(/^\d+-/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

function writeRunReport({
  timestamp,
  runId,
  runsDir,
  budget,
  suites,
  compositeScoresByPersona,
  improvementPriorities,
}) {
  const suitesObj = {};
  for (const suite of suites) {
    const key = suiteKey(suite.id || suite.name);
    suitesObj[key] = {
      score: suite.score,
      score_label: suite.score_label,
      status: suite.status,
      per_persona: suite.per_persona || {},
      failures: suite.failures || [],
      suggestions: suite.suggestions || [],
      details: suite.details || {},
      confidence: suite.confidence == null ? null : suite.confidence,
    };
  }

  const payload = {
    timestamp,
    budget: {
      spent: Number((budget.spent || 0).toFixed(6)),
      remaining: Number((budget.remaining || 0).toFixed(6)),
      cap: Number((budget.cap || 0).toFixed(6)),
      call_count: Array.isArray(budget.calls) ? budget.calls.length : 0,
    },
    suites: suitesObj,
    composite_scores_by_persona: compositeScoresByPersona || {},
    improvement_priorities: improvementPriorities || [],
  };

  const file = path.join(runsDir, `run-${runId}.json`);
  writeJson(file, payload);
  return { file, payload };
}

module.exports = {
  writeRunReport,
};
