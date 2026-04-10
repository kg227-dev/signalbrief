"use strict";

function budgetGuardStatus(budget, estimateUsd) {
  const remainingAfterReserve = Number(budget.remaining_usd || 0) - Number(budget.reserve_usd || 0);
  const estimate = Number(estimateUsd || 0);
  return {
    ok: remainingAfterReserve >= estimate,
    estimate_usd: Number(estimate.toFixed(6)),
    remaining_after_reserve_usd: Number(Math.max(0, remainingAfterReserve).toFixed(6)),
  };
}

function buildScenarioEstimate(services, scenario) {
  const digestConfig = services.CONFIG?.digest || {};
  const hardCalls = Number(digestConfig?.search_budget?.scheduled?.hard_calls || 36);
  const perplexityEstimate = Math.max(1, hardCalls) * 0.005;
  const claudeEstimate = 0.08;
  const personaCount = Array.isArray(scenario?.dueUsers) ? scenario.dueUsers.length : 0;
  return Number((perplexityEstimate + claudeEstimate + (personaCount * 0.0005)).toFixed(4));
}

function computeScenarioCost(result = {}) {
  const fetchResult = result?.fetchResult || {};
  const enrichResult = result?.enrichResult || {};
  const perplexityCost = Number(fetchResult.standardFetchCalls || 0) * 0.005;
  const claudeCost = (
    (Number(enrichResult.claudeUsage?.input_tokens || 0) / 1_000_000) * 0.8
    + (Number(enrichResult.claudeUsage?.output_tokens || 0) / 1_000_000) * 4.0
  );
  return {
    perplexityCost: Number(perplexityCost.toFixed(6)),
    claudeCost: Number(claudeCost.toFixed(6)),
    totalCost: Number((perplexityCost + claudeCost).toFixed(6)),
  };
}

function resolveEvalSelectionTarget({ scenarioId, dueUsers, baseSelectionTarget }) {
  return Math.max(1, Number(baseSelectionTarget || 0));
}

module.exports = {
  budgetGuardStatus,
  buildScenarioEstimate,
  computeScenarioCost,
  resolveEvalSelectionTarget,
};
