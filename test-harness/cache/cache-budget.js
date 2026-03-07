const {
  BUDGET_FILE,
  BUDGET_CAP_USD,
  COSTS,
  JUDGE_MODELS,
  MODEL_PRICING,
  writeJson,
  readJson,
} = require("../config");

function normalizeBudget(raw = {}) {
  const cap = Number(raw.cap);
  const spent = Number(raw.spent);
  const normalized = {
    cap: Number.isFinite(cap) ? cap : BUDGET_CAP_USD,
    spent: Number.isFinite(spent) ? spent : 0,
    remaining: 0,
    calls: Array.isArray(raw.calls) ? raw.calls : [],
  };
  normalized.remaining = Math.max(0, Number((normalized.cap - normalized.spent).toFixed(6)));
  return normalized;
}

function loadBudget() {
  const data = readJson(BUDGET_FILE, null);
  if (!data) {
    const fresh = normalizeBudget({});
    writeJson(BUDGET_FILE, fresh);
    return fresh;
  }
  const normalized = normalizeBudget(data);
  writeJson(BUDGET_FILE, normalized);
  return normalized;
}

function saveBudget(budget) {
  const normalized = normalizeBudget(budget);
  writeJson(BUDGET_FILE, normalized);
  return normalized;
}

function ensureBudget(budget, estimateUsd, reason) {
  const estimate = Number(estimateUsd) || 0;
  if (estimate <= 0) return;
  if (budget.remaining < estimate) {
    const msg = [
      `Budget guard triggered before ${reason}.`,
      `Estimated call cost: $${estimate.toFixed(5)}.`,
      `Remaining budget: $${budget.remaining.toFixed(5)}.`,
      "Run with cache-only data or increase budget cap.",
    ].join(" ");
    throw new Error(msg);
  }
}

function recordBudgetCall(budget, entry) {
  const cost = Number(entry?.cost_usd || 0);
  const payload = {
    ts: new Date().toISOString(),
    provider: entry.provider || "unknown",
    purpose: entry.purpose || "unknown",
    cache_key: entry.cache_key || null,
    model: entry.model || null,
    endpoint: entry.endpoint || null,
    input_tokens: Number(entry.input_tokens || 0),
    output_tokens: Number(entry.output_tokens || 0),
    cost_usd: Number(cost.toFixed(6)),
    from_cache: !!entry.from_cache,
  };

  const next = normalizeBudget(budget);
  if (payload.cost_usd > 0) {
    next.spent = Number((next.spent + payload.cost_usd).toFixed(6));
    next.remaining = Math.max(0, Number((next.cap - next.spent).toFixed(6)));
  }
  next.calls.push(payload);
  saveBudget(next);
  return next;
}

function resolveAnthropicModel(model) {
  const raw = String(model || "").trim().toLowerCase();
  if (!raw) return JUDGE_MODELS.haiku;
  if (JUDGE_MODELS[raw]) return JUDGE_MODELS[raw];
  if (raw.includes("sonnet")) return JUDGE_MODELS.sonnet;
  if (raw.includes("haiku")) return JUDGE_MODELS.haiku;
  return model;
}

function modelRateCard(model, costs = COSTS) {
  const normalized = resolveAnthropicModel(model);
  const map = {
    ...MODEL_PRICING,
    ...(costs && costs.model_pricing ? costs.model_pricing : {}),
  };
  const card = map[normalized];
  if (card) return card;
  return {
    input_per_mtok_usd: Number(costs.claude_in_per_mtok_usd || COSTS.claude_in_per_mtok_usd),
    output_per_mtok_usd: Number(costs.claude_out_per_mtok_usd || COSTS.claude_out_per_mtok_usd),
    judge_estimate_usd: Number(costs.claude_judge_estimate_usd || COSTS.claude_judge_estimate_usd),
  };
}

function estimateClaudeCost(usage, costs = COSTS, model = JUDGE_MODELS.haiku) {
  const inTokens = Number(usage?.input_tokens || 0);
  const outTokens = Number(usage?.output_tokens || 0);
  const card = modelRateCard(model, costs);
  const inCost = (inTokens / 1_000_000) * Number(card.input_per_mtok_usd || COSTS.claude_in_per_mtok_usd);
  const outCost = (outTokens / 1_000_000) * Number(card.output_per_mtok_usd || COSTS.claude_out_per_mtok_usd);
  return Number((inCost + outCost).toFixed(6));
}

module.exports = {
  normalizeBudget,
  loadBudget,
  saveBudget,
  ensureBudget,
  recordBudgetCall,
  resolveAnthropicModel,
  modelRateCard,
  estimateClaudeCost,
};
