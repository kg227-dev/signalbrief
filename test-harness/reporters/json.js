const fs = require("fs");
const path = require("path");
const { writeJson, readJson } = require("../config");

function suiteKey(id) {
  return String(id || "")
    .replace(/^\d+-/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
}

function writeRunReport({
  timestamp,
  runId,
  runLabel,
  runsDir,
  budget,
  suites,
  sampleSizes,
  confidence,
  regressionAgainstBaseline,
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
    run_id: runId,
    run_label: runLabel || null,
    budget: {
      spent: Number((budget.spent || 0).toFixed(6)),
      remaining: Number((budget.remaining || 0).toFixed(6)),
      cap: Number((budget.cap || 0).toFixed(6)),
      call_count: Array.isArray(budget.calls) ? budget.calls.length : 0,
    },
    sample_sizes: sampleSizes || {},
    confidence: confidence || {},
    regression_against_baseline: regressionAgainstBaseline || null,
    suites: suitesObj,
    composite_scores_by_persona: compositeScoresByPersona || {},
    improvement_priorities: improvementPriorities || [],
  };

  const file = path.join(runsDir, `run-${runId}.json`);
  writeJson(file, payload);
  return { file, payload };
}

function allSuitesPass(runPayload) {
  if (!runPayload || !runPayload.suites) return false;
  const statuses = Object.values(runPayload.suites).map((s) => String(s?.status || "").toLowerCase());
  if (!statuses.length) return false;
  return statuses.every((s) => s === "pass");
}

function writeRollingSummary({ resultsDir, runPayload }) {
  const file = path.join(resultsDir, "summary-rolling.json");
  const existing = readJson(file, { window: 7, entries: [], pass_streak: 0 });
  const entries = Array.isArray(existing?.entries) ? existing.entries.slice() : [];

  const compositeAvg = Number(
    runPayload?.suites?.["end-to-end"]?.score
      || runPayload?.suites?.["end_to_end"]?.score
      || runPayload?.suites?.["end-to-end-composite"]?.score
      || 0
  );

  entries.push({
    timestamp: runPayload?.timestamp || new Date().toISOString(),
    run_id: runPayload?.run_id || null,
    run_label: runPayload?.run_label || null,
    suites_all_pass: allSuitesPass(runPayload),
    composite_avg: Number(compositeAvg.toFixed(2)),
    budget_spent: Number(runPayload?.budget?.spent || 0),
  });

  const window = 7;
  const trimmed = entries.slice(-window);

  let passStreak = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (!trimmed[i].suites_all_pass) break;
    passStreak += 1;
  }

  const out = {
    window,
    last_updated: new Date().toISOString(),
    pass_streak: passStreak,
    entries: trimmed,
  };

  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  writeJson(file, out);
  return out;
}

module.exports = {
  writeRunReport,
  writeRollingSummary,
};
