const path = require("path");

const { COSTS, JUDGE_MODELS } = require("../config");
const {
  httpsPostWithRetry,
  parseJsonObjectLenient,
} = require("./cache-common");
const {
  ensureBudget,
  recordBudgetCall,
  estimateClaudeCost,
  resolveAnthropicModel,
  modelRateCard,
} = require("./cache-budget");
const {
  buildJudgeCacheFile,
  readJudgeCache,
  writeJudgeCache,
} = require("./cache-claude-judge-io");

async function judgeWithClaudeCached({
  kind,
  payload,
  prompt,
  maxTokens = 700,
  model = JUDGE_MODELS.haiku,
  appConfig,
  budget,
  allowLiveApi,
  refreshCache,
  costs = COSTS,
}) {
  const judgeModel = resolveAnthropicModel(model);
  const { file } = buildJudgeCacheFile({ kind, payload, prompt, maxTokens, judgeModel });

  if (!refreshCache) {
    const cachedResult = readJudgeCache(file);
    if (cachedResult) return cachedResult;
  }

  if (!allowLiveApi) {
    throw new Error(`Claude judge cache miss (${kind}). Rerun with --live or use --no-judge.`);
  }

  const apiKey = appConfig?.keys?.anthropic;
  if (!apiKey) throw new Error("Missing config.keys.anthropic for live Claude judge calls.");

  ensureBudget(
    budget,
    Number(modelRateCard(judgeModel, costs).judge_estimate_usd || COSTS.claude_judge_estimate_usd),
    `Claude judge (${kind}) [${judgeModel}]`
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
      model: judgeModel,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    },
    {
      retries: 1,
      retryDelayMs: 1000,
      timeoutMs: 35000,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Claude judge failed (${kind}): status ${res.status}`);
  }

  const usage = {
    input_tokens: Number(res.body?.usage?.input_tokens || 0),
    output_tokens: Number(res.body?.usage?.output_tokens || 0),
  };

  const rawText = res.body?.content?.[0]?.text || "";
  const parsed = parseJsonObjectLenient(rawText);
  const costUsd = estimateClaudeCost(usage, costs, judgeModel);

  writeJudgeCache({
    file,
    kind,
    judgeModel,
    payload,
    prompt,
    maxTokens,
    rawResponseBody: res.body,
    rawText,
    usage,
    costUsd,
    parsed,
  });

  const nextBudget = recordBudgetCall(budget, {
    provider: "anthropic",
    purpose: `judge:${kind}`,
    cache_key: path.basename(file),
    model: judgeModel,
    endpoint: "/v1/messages",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: costUsd,
    from_cache: false,
  });

  return {
    result: parsed,
    usage,
    from_cache: false,
    cache_file: file,
    cost_usd: costUsd,
    cache_key: path.basename(file),
    budget: nextBudget,
  };
}

module.exports = {
  judgeWithClaudeCached,
};
