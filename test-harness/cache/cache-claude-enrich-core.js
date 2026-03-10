const path = require("path");

const { COSTS, JUDGE_MODELS } = require("../config");
const {
  qaDebug,
  httpsPostWithRetry,
  parseJsonArrayLenient,
} = require("./cache-common");
const {
  ensureBudget,
  recordBudgetCall,
  estimateClaudeCost,
} = require("./cache-budget");
const {
  buildEnrichmentPrompt,
  mapEnrichedItems,
} = require("./cache-claude-enrichment");
const {
  buildEnrichmentCacheFile,
  readEnrichmentCache,
  writeEnrichmentCache,
} = require("./cache-claude-enrich-io");

async function enrichItemsCached({
  items,
  appConfig,
  budget,
  allowLiveApi,
  refreshCache,
  costs = COSTS,
}) {
  const enrichModel = JUDGE_MODELS.haiku;
  const prompt = buildEnrichmentPrompt(items || []);
  const { hash, file } = buildEnrichmentCacheFile({ items, enrichModel, prompt });

  if (!refreshCache) {
    const cachedResult = readEnrichmentCache(file);
    if (cachedResult) return cachedResult;
  }

  if (!allowLiveApi) {
    throw new Error("Claude enrichment cache miss. Rerun with --live to warm cache or use --offline.");
  }

  const apiKey = appConfig?.keys?.anthropic;
  if (!apiKey) throw new Error("Missing config.keys.anthropic for live Claude calls.");

  ensureBudget(
    budget,
    Number(costs.claude_enrichment_estimate_usd || COSTS.claude_enrichment_estimate_usd),
    "Claude enrichment"
  );

  const res = await httpsPostWithRetry(
    "api.anthropic.com",
    "/v1/messages",
    {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    {
      model: enrichModel,
      max_tokens: 4500,
      messages: [{ role: "user", content: prompt }],
    },
    {
      retries: 1,
      retryDelayMs: 1200,
      timeoutMs: 45000,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Claude enrichment failed: status ${res.status}`);
  }

  const usage = {
    input_tokens: Number(res.body?.usage?.input_tokens || 0),
    output_tokens: Number(res.body?.usage?.output_tokens || 0),
  };

  let parsed;
  try {
    parsed = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
  } catch (err) {
    qaDebug(`Claude enrichment parse fallback to []: ${err.message}`);
    parsed = [];
  }

  const enrichedItems = mapEnrichedItems(items, parsed);
  const costUsd = estimateClaudeCost(usage, costs, enrichModel);

  writeEnrichmentCache({
    file,
    hash,
    prompt,
    enrichModel,
    items,
    responseBody: res.body,
    usage,
    costUsd,
    enrichedItems,
  });

  const nextBudget = recordBudgetCall(budget, {
    provider: "anthropic",
    purpose: "enrich",
    cache_key: path.basename(file),
    model: enrichModel,
    endpoint: "/v1/messages",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: costUsd,
    from_cache: false,
  });

  return {
    items: enrichedItems,
    usage,
    from_cache: false,
    cache_file: file,
    cost_usd: costUsd,
    cache_key: path.basename(file),
    budget: nextBudget,
  };
}

module.exports = {
  enrichItemsCached,
};
