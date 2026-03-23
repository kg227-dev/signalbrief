"use strict";

const DEFAULT_PERPLEXITY_COST_PER_CALL = 0.005;
const DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK = 0.80;
const DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK = 4.00;

function calculateRunCosts(params = {}) {
  const {
    standardFetchCalls = 0,
    customFetchCalls = 0,
    claudeUsage = {},
    perplexityCostPerCall = DEFAULT_PERPLEXITY_COST_PER_CALL,
    claudeInputPerMtok = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
    claudeOutputPerMtok = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
  } = params;

  const perplexityCalls = Number(standardFetchCalls || 0) + Number(customFetchCalls || 0);
  const perplexityCost = Number(perplexityCostPerCall || 0) * perplexityCalls;
  const inputTokens = Number(claudeUsage.input_tokens || 0);
  const outputTokens = Number(claudeUsage.output_tokens || 0);
  const claudeCost = (inputTokens / 1_000_000 * Number(claudeInputPerMtok || 0))
    + (outputTokens / 1_000_000 * Number(claudeOutputPerMtok || 0));
  const totalCost = perplexityCost + claudeCost;

  return {
    perplexityCalls,
    perplexityCost,
    claudeCost,
    totalCost,
  };
}

function createDigestOrchestratorCostRuntime(deps) {
  const {
    fs,
    path,
    costLogPath,
    log,
    formatEtDateKey,
    perplexityCostPerCall = DEFAULT_PERPLEXITY_COST_PER_CALL,
    claudeInputPerMtok = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
    claudeOutputPerMtok = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};

  function appendCostLog(entry) {
    try {
      const dir = path.dirname(costLogPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(costLogPath, `${JSON.stringify(entry)}\n`);
    } catch (e) {
      logger(`[warn] Cost log write failed: ${e.message}`);
    }
  }

  function recordRunCost(params = {}) {
    const {
      now,
      runId,
      targetChatId,
      standardFetchCalls,
      customFetchCalls,
      claudeUsage,
      dueUsers,
      deliveredUsers,
      failedUsers,
      publicDigestUrl,
      runValueState,
      blockedReason,
    } = params;

    const costs = calculateRunCosts({
      standardFetchCalls,
      customFetchCalls,
      claudeUsage,
      perplexityCostPerCall,
      claudeInputPerMtok,
      claudeOutputPerMtok,
    });

    appendCostLog({
      date: formatEtDateKey(now),
      run_id: runId,
      run_at: now.toISOString(),
      run_at_et: now.toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      on_demand: !!targetChatId,
      perplexity_calls: costs.perplexityCalls,
      perplexity_calls_standard: Number(standardFetchCalls || 0),
      perplexity_calls_custom: Number(customFetchCalls || 0),
      perplexity_cost_usd: parseFloat(costs.perplexityCost.toFixed(5)),
      claude_tokens_in: Number(claudeUsage?.input_tokens || 0),
      claude_tokens_out: Number(claudeUsage?.output_tokens || 0),
      claude_cost_usd: parseFloat(costs.claudeCost.toFixed(6)),
      total_cost_usd: parseFloat(costs.totalCost.toFixed(5)),
      users_targeted: Array.isArray(dueUsers) ? dueUsers.length : 0,
      users_served: Array.isArray(deliveredUsers) ? deliveredUsers.length : 0,
      digest_url: String(publicDigestUrl || ""),
      per_user: Array.isArray(deliveredUsers) ? deliveredUsers : [],
      per_user_failed: Array.isArray(failedUsers) ? failedUsers : [],
      run_value_state: runValueState ? String(runValueState) : (Array.isArray(deliveredUsers) && deliveredUsers.length > 0 ? "delivered" : "zero_value"),
      blocked_reason: blockedReason ? String(blockedReason) : null,
    });

    logger(`Run cost: $${costs.totalCost.toFixed(4)} (Perplexity $${costs.perplexityCost.toFixed(3)} - Claude in=${Number(claudeUsage?.input_tokens || 0)} out=${Number(claudeUsage?.output_tokens || 0)} $${costs.claudeCost.toFixed(4)})`);
    return costs;
  }

  return {
    appendCostLog,
    recordRunCost,
  };
}

module.exports = {
  createDigestOrchestratorCostRuntime,
  calculateRunCosts,
  DEFAULT_PERPLEXITY_COST_PER_CALL,
  DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
  DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
};
