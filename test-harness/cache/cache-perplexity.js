const path = require("path");

const { CACHE_PERPLEXITY_DIR, COSTS, sanitizeCacheKey, writeJson } = require("../config");
const { httpsPostWithRetry } = require("./cache-common");
const { ensureBudget, recordBudgetCall } = require("./cache-budget");
const { parsePerplexityItems, buildPerplexityPayload } = require("./cache-perplexity-parser");
const {
  findLatestTopicCacheFile,
  tryPerplexityCacheFallback,
} = require("./cache-perplexity-io");

function buildTopicCacheFile(topicTag, dateKey) {
  return path.join(
    CACHE_PERPLEXITY_DIR,
    `${sanitizeCacheKey(topicTag)}_${sanitizeCacheKey(dateKey || "run")}.json`
  );
}

function readCachedPerplexity(file, latestFallback, topicTag, refreshCache) {
  if (refreshCache) return null;
  return tryPerplexityCacheFallback(file, latestFallback, topicTag, false);
}

function ensureLiveApiAllowed(allowLiveApi, topicTag) {
  if (!allowLiveApi) {
    throw new Error(
      `Perplexity cache miss for topic "${topicTag}". Rerun with --live to warm cache or use --offline.`
    );
  }
}

function getPerplexityApiKey(appConfig) {
  const apiKey = appConfig?.keys?.perplexity;
  if (!apiKey) throw new Error("Missing config.keys.perplexity for live Perplexity calls.");
  return apiKey;
}

function estimatePerplexityCallCost(costs = COSTS) {
  return Number(costs.perplexity_per_call_usd || COSTS.perplexity_per_call_usd);
}

async function fetchPerplexityResponse({ apiKey, payload }) {
  return httpsPostWithRetry(
    "api.perplexity.ai",
    "/chat/completions",
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    payload,
    {
      retries: 1,
      retryDelayMs: 900,
      timeoutMs: 20000,
    }
  );
}

function getPerplexityFallback(file, latestFallback, topicTag) {
  return tryPerplexityCacheFallback(file, latestFallback, topicTag, true);
}

function persistPerplexityCache({
  file,
  topicTag,
  dateKey,
  query,
  payload,
  responseBody,
  parsedItems,
  estimated,
}) {
  writeJson(file, {
    timestamp: new Date().toISOString(),
    api: "perplexity.chat.completions",
    endpoint: "/chat/completions",
    model: "sonar",
    topic_tag: topicTag,
    input: {
      date_key: dateKey,
      query,
      payload,
    },
    raw_response: responseBody,
    parsed_items: parsedItems,
    cost_usd: Number(estimated.toFixed(6)),
  });
}

async function fetchTopicNewsCached({
  topicTag,
  query,
  dateKey,
  appConfig,
  budget,
  allowLiveApi,
  refreshCache,
  costs = COSTS,
}) {
  const file = buildTopicCacheFile(topicTag, dateKey);
  const latestFallback = findLatestTopicCacheFile(topicTag);

  const cached = readCachedPerplexity(file, latestFallback, topicTag, refreshCache);
  if (cached) return cached;

  ensureLiveApiAllowed(allowLiveApi, topicTag);
  const apiKey = getPerplexityApiKey(appConfig);
  const estimated = estimatePerplexityCallCost(costs);
  ensureBudget(budget, estimated, `Perplexity fetch (${topicTag})`);

  const payload = buildPerplexityPayload(topicTag, query);
  let res;
  try {
    res = await fetchPerplexityResponse({ apiKey, payload });
  } catch (err) {
    const fallback = getPerplexityFallback(file, latestFallback, topicTag);
    if (fallback) return fallback;
    throw err;
  }

  if (res.status < 200 || res.status >= 300) {
    const fallback = getPerplexityFallback(file, latestFallback, topicTag);
    if (fallback) return fallback;
    throw new Error(`Perplexity fetch failed for ${topicTag}: status ${res.status}`);
  }

  const parsedItems = parsePerplexityItems(res.body, topicTag);
  persistPerplexityCache({
    file,
    topicTag,
    dateKey,
    query,
    payload,
    responseBody: res.body,
    parsedItems,
    estimated,
  });

  const nextBudget = recordBudgetCall(budget, {
    provider: "perplexity",
    purpose: "fetch",
    cache_key: path.basename(file),
    model: "sonar",
    endpoint: "/chat/completions",
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: estimated,
    from_cache: false,
  });

  return {
    items: parsedItems,
    from_cache: false,
    cache_file: file,
    cost_usd: estimated,
    raw_response: res.body,
    topic_tag: topicTag,
    budget: nextBudget,
  };
}

module.exports = {
  fetchTopicNewsCached,
};
