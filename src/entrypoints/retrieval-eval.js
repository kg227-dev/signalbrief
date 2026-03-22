#!/usr/bin/env node
"use strict";

const {
  DEFAULT_BUDGET_CAP_USD,
  DEFAULT_SCENARIOS,
} = require("../eval/retrieval/constants-runtime");
const { runRetrievalEval } = require("../eval/retrieval/runner-runtime");

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    scenarios: DEFAULT_SCENARIOS.slice(),
    budgetCapUsd: DEFAULT_BUDGET_CAP_USD,
    resetBudget: false,
    historicalDays: 14,
  };
  for (const token of argv) {
    if (token === "--reset-budget") {
      out.resetBudget = true;
      continue;
    }
    if (token.startsWith("--cap=")) {
      out.budgetCapUsd = Number(token.replace("--cap=", "").trim()) || DEFAULT_BUDGET_CAP_USD;
      continue;
    }
    if (token.startsWith("--scenarios=")) {
      out.scenarios = token.replace("--scenarios=", "").split(",").map((value) => value.trim()).filter(Boolean);
      continue;
    }
    if (token.startsWith("--historical-days=")) {
      out.historicalDays = Number(token.replace("--historical-days=", "").trim()) || 14;
    }
  }
  return out;
}

async function main() {
  const options = parseArgs();
  const result = await runRetrievalEval(options);
  const summary = result?.overall_summary || {};
  process.stdout.write(
    JSON.stringify({
      run_id: result?.run_id,
      status: result?.status,
      budget_spent_usd: result?.budget?.spent_usd,
      scenario_count: summary.scenario_count,
      persona_count: summary.persona_count,
      overall_score: summary.overall_score,
      strongest_persona: summary.strongest_persona,
      weakest_persona: summary.weakest_persona,
    }, null, 2) + "\n"
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[retrieval-eval] fatal: ${String(error?.message || error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
