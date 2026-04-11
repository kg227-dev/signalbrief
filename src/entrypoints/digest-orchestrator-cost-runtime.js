"use strict";

const DEFAULT_SEARCH_MODEL = "sonar";
const DEFAULT_SEARCH_CONTEXT_SIZE = "low";
const DEFAULT_PERPLEXITY_COST_PER_CALL = 0.005;
const DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK = 0.80;
const DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK = 4.00;

const SEARCH_MODEL_PRICING = Object.freeze({
  "sonar": Object.freeze({
    input_per_mtok: 1.00,
    output_per_mtok: 1.00,
    request_fee_per_call: Object.freeze({
      low: 0.005,
      medium: 0.008,
      high: 0.012,
    }),
  }),
  "sonar-pro": Object.freeze({
    input_per_mtok: 3.00,
    output_per_mtok: 15.00,
    request_fee_per_call: Object.freeze({
      low: 0.014,
      medium: 0.018,
      high: 0.022,
    }),
  }),
  "sonar-reasoning": Object.freeze({
    input_per_mtok: 3.00,
    output_per_mtok: 15.00,
    request_fee_per_call: Object.freeze({
      low: 0.014,
      medium: 0.018,
      high: 0.022,
    }),
  }),
  "sonar-reasoning-pro": Object.freeze({
    input_per_mtok: 3.00,
    output_per_mtok: 15.00,
    request_fee_per_call: Object.freeze({
      low: 0.014,
      medium: 0.018,
      high: 0.022,
    }),
  }),
});

const ANTHROPIC_MODEL_PRICING = Object.freeze({
  "claude-haiku-4-5": Object.freeze({ input_per_mtok: 1.00, output_per_mtok: 5.00 }),
  "claude-haiku-4.5": Object.freeze({ input_per_mtok: 1.00, output_per_mtok: 5.00 }),
  "claude-3-haiku-20240307": Object.freeze({ input_per_mtok: 0.25, output_per_mtok: 1.25 }),
  "claude-3-haiku@20240307": Object.freeze({ input_per_mtok: 0.25, output_per_mtok: 1.25 }),
  "claude-3-5-haiku-20241022": Object.freeze({ input_per_mtok: 0.80, output_per_mtok: 4.00 }),
});

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeUsage(usage = {}) {
  return {
    input_tokens: Math.max(0, toFiniteNumber(usage?.input_tokens, 0)),
    output_tokens: Math.max(0, toFiniteNumber(usage?.output_tokens, 0)),
  };
}

function normalizeModelKey(value, fallback = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || String(fallback || "").trim().toLowerCase();
}

function resolveSearchModelPricing(searchModel, {
  fallbackRequestFeePerCall = DEFAULT_PERPLEXITY_COST_PER_CALL,
} = {}) {
  const modelKey = normalizeModelKey(searchModel, DEFAULT_SEARCH_MODEL);
  return SEARCH_MODEL_PRICING[modelKey] || {
    input_per_mtok: 0,
    output_per_mtok: 0,
    request_fee_per_call: {
      low: toFiniteNumber(fallbackRequestFeePerCall, DEFAULT_PERPLEXITY_COST_PER_CALL),
      medium: toFiniteNumber(fallbackRequestFeePerCall, DEFAULT_PERPLEXITY_COST_PER_CALL),
      high: toFiniteNumber(fallbackRequestFeePerCall, DEFAULT_PERPLEXITY_COST_PER_CALL),
    },
  };
}

function resolveAnthropicModelPricing(model, {
  fallbackInputPerMtok = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
  fallbackOutputPerMtok = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
} = {}) {
  const modelKey = normalizeModelKey(model, "");
  return ANTHROPIC_MODEL_PRICING[modelKey] || {
    input_per_mtok: toFiniteNumber(fallbackInputPerMtok, DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK),
    output_per_mtok: toFiniteNumber(fallbackOutputPerMtok, DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK),
  };
}

function calculateAnthropicUsageCost({
  usage = {},
  model = "",
  fallbackInputPerMtok = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
  fallbackOutputPerMtok = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
} = {}) {
  const normalizedUsage = normalizeUsage(usage);
  const pricing = resolveAnthropicModelPricing(model, {
    fallbackInputPerMtok,
    fallbackOutputPerMtok,
  });
  const inputCost = (normalizedUsage.input_tokens / 1_000_000) * pricing.input_per_mtok;
  const outputCost = (normalizedUsage.output_tokens / 1_000_000) * pricing.output_per_mtok;
  return {
    inputTokens: normalizedUsage.input_tokens,
    outputTokens: normalizedUsage.output_tokens,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    pricing,
  };
}

function calculateSearchUsageCost({
  standardFetchCalls = 0,
  usage = {},
  searchModel = DEFAULT_SEARCH_MODEL,
  contextSize = DEFAULT_SEARCH_CONTEXT_SIZE,
  fallbackRequestFeePerCall = DEFAULT_PERPLEXITY_COST_PER_CALL,
} = {}) {
  const normalizedUsage = normalizeUsage(usage);
  const pricing = resolveSearchModelPricing(searchModel, {
    fallbackRequestFeePerCall,
  });
  const requestCount = Math.max(0, toFiniteNumber(standardFetchCalls, 0));
  const normalizedContextSize = String(contextSize || DEFAULT_SEARCH_CONTEXT_SIZE).trim().toLowerCase();
  const requestFeePerCall = toFiniteNumber(
    pricing.request_fee_per_call?.[normalizedContextSize],
    toFiniteNumber(pricing.request_fee_per_call?.[DEFAULT_SEARCH_CONTEXT_SIZE], fallbackRequestFeePerCall)
  );
  const requestCost = requestCount * requestFeePerCall;
  const inputCost = (normalizedUsage.input_tokens / 1_000_000) * pricing.input_per_mtok;
  const outputCost = (normalizedUsage.output_tokens / 1_000_000) * pricing.output_per_mtok;
  return {
    requestCount,
    inputTokens: normalizedUsage.input_tokens,
    outputTokens: normalizedUsage.output_tokens,
    requestFeePerCall,
    requestCost,
    inputCost,
    outputCost,
    tokenCost: inputCost + outputCost,
    totalCost: requestCost + inputCost + outputCost,
    pricing,
  };
}

function calculateRunCosts(params = {}) {
  const {
    standardFetchCalls = 0,
    searchUsage = {},
    claudeUsage = {},
    classifierUsage = {},
    searchModel = DEFAULT_SEARCH_MODEL,
    searchContextSize = DEFAULT_SEARCH_CONTEXT_SIZE,
    enrichModel = "",
    classifierModel = "",
    perplexityCostPerCall = DEFAULT_PERPLEXITY_COST_PER_CALL,
    claudeInputPerMtok = DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
    claudeOutputPerMtok = DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
  } = params;

  const searchCosts = calculateSearchUsageCost({
    standardFetchCalls,
    usage: searchUsage,
    searchModel,
    contextSize: searchContextSize,
    fallbackRequestFeePerCall: perplexityCostPerCall,
  });
  const enrichCosts = calculateAnthropicUsageCost({
    usage: claudeUsage,
    model: enrichModel,
    fallbackInputPerMtok: claudeInputPerMtok,
    fallbackOutputPerMtok: claudeOutputPerMtok,
  });
  const classifierCosts = calculateAnthropicUsageCost({
    usage: classifierUsage,
    model: classifierModel,
    fallbackInputPerMtok: claudeInputPerMtok,
    fallbackOutputPerMtok: claudeOutputPerMtok,
  });
  const anthropicCost = enrichCosts.totalCost + classifierCosts.totalCost;
  const totalCost = searchCosts.totalCost + anthropicCost;

  return {
    perplexityCalls: searchCosts.requestCount,
    perplexityCost: searchCosts.totalCost,
    searchCost: searchCosts.totalCost,
    searchRequestCost: searchCosts.requestCost,
    searchTokenCost: searchCosts.tokenCost,
    searchInputTokens: searchCosts.inputTokens,
    searchOutputTokens: searchCosts.outputTokens,
    claudeCost: anthropicCost,
    anthropicCost,
    enrichCost: enrichCosts.totalCost,
    enrichInputTokens: enrichCosts.inputTokens,
    enrichOutputTokens: enrichCosts.outputTokens,
    classifierCost: classifierCosts.totalCost,
    classifierInputTokens: classifierCosts.inputTokens,
    classifierOutputTokens: classifierCosts.outputTokens,
    totalAnthropicInputTokens: enrichCosts.inputTokens + classifierCosts.inputTokens,
    totalAnthropicOutputTokens: enrichCosts.outputTokens + classifierCosts.outputTokens,
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
      standardFetchCalls,
      searchUsage,
      claudeUsage,
      classifierUsage,
      searchModel,
      searchContextSize,
      enrichModel,
      classifierModel,
      dueUsers,
      deliveredUsers,
      failedUsers,
      publicDigestUrl,
      runValueState,
      blockedReason,
    } = params;

    const costs = calculateRunCosts({
      standardFetchCalls,
      searchUsage,
      claudeUsage,
      classifierUsage,
      searchModel,
      searchContextSize,
      enrichModel,
      classifierModel,
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
      perplexity_calls: costs.perplexityCalls,
      perplexity_calls_standard: Number(standardFetchCalls || 0),
      perplexity_cost_usd: parseFloat(costs.searchCost.toFixed(5)),
      search_model: String(searchModel || DEFAULT_SEARCH_MODEL || "").trim() || DEFAULT_SEARCH_MODEL,
      search_context_size: String(searchContextSize || DEFAULT_SEARCH_CONTEXT_SIZE || "").trim() || DEFAULT_SEARCH_CONTEXT_SIZE,
      search_request_cost_usd: parseFloat(costs.searchRequestCost.toFixed(5)),
      search_token_cost_usd: parseFloat(costs.searchTokenCost.toFixed(6)),
      search_tokens_in: Number(costs.searchInputTokens || 0),
      search_tokens_out: Number(costs.searchOutputTokens || 0),
      claude_tokens_in: Number(costs.totalAnthropicInputTokens || 0),
      claude_tokens_out: Number(costs.totalAnthropicOutputTokens || 0),
      claude_cost_usd: parseFloat(costs.anthropicCost.toFixed(6)),
      anthropic_cost_usd: parseFloat(costs.anthropicCost.toFixed(6)),
      enrich_model: String(enrichModel || "").trim() || null,
      enrich_tokens_in: Number(costs.enrichInputTokens || 0),
      enrich_tokens_out: Number(costs.enrichOutputTokens || 0),
      enrich_cost_usd: parseFloat(costs.enrichCost.toFixed(6)),
      classifier_model: String(classifierModel || "").trim() || null,
      classifier_tokens_in: Number(costs.classifierInputTokens || 0),
      classifier_tokens_out: Number(costs.classifierOutputTokens || 0),
      classifier_cost_usd: parseFloat(costs.classifierCost.toFixed(6)),
      billable_total_cost_usd: parseFloat(costs.totalCost.toFixed(5)),
      total_cost_usd: parseFloat(costs.totalCost.toFixed(5)),
      cost_version: 2,
      users_due: Array.isArray(dueUsers) ? dueUsers.length : 0,
      users_served: Array.isArray(deliveredUsers) ? deliveredUsers.length : 0,
      digest_url: String(publicDigestUrl || ""),
      per_user: Array.isArray(deliveredUsers) ? deliveredUsers : [],
      per_user_failed: Array.isArray(failedUsers) ? failedUsers : [],
      run_value_state: runValueState ? String(runValueState) : (Array.isArray(deliveredUsers) && deliveredUsers.length > 0 ? "delivered" : "zero_value"),
      blocked_reason: blockedReason ? String(blockedReason) : null,
    });

    logger(
      `Run cost: $${costs.totalCost.toFixed(4)} `
      + `(Search $${costs.searchCost.toFixed(4)} `
      + `Anthropic $${costs.anthropicCost.toFixed(4)} `
      + `enrich in=${costs.enrichInputTokens} out=${costs.enrichOutputTokens} `
      + `classifier in=${costs.classifierInputTokens} out=${costs.classifierOutputTokens})`
    );
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
  calculateAnthropicUsageCost,
  calculateSearchUsageCost,
  DEFAULT_PERPLEXITY_COST_PER_CALL,
  DEFAULT_CLAUDE_HAIKU_IN_PER_MTOK,
  DEFAULT_CLAUDE_HAIKU_OUT_PER_MTOK,
  DEFAULT_SEARCH_MODEL,
  DEFAULT_SEARCH_CONTEXT_SIZE,
  SEARCH_MODEL_PRICING,
  ANTHROPIC_MODEL_PRICING,
};
