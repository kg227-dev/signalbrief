const fs = require("fs");
const path = require("path");

const { CACHE_PERPLEXITY_DIR, COSTS, sanitizeCacheKey, writeJson, readJson } = require("../config");
const { httpsPostWithRetry, qaDebug } = require("./cache-common");
const { ensureBudget, recordBudgetCall } = require("./cache-budget");

function parseUrlOrNull(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch (err) {
    return null;
  }
}

function selectCitationForHostname(citations, hostname) {
  for (const citation of citations) {
    const parsed = parseUrlOrNull(citation);
    if (parsed && parsed.hostname === hostname) return citation;
  }
  return null;
}

function parsePerplexityItems(responseBody, topicTag) {
  const citations = Array.isArray(responseBody?.citations) ? responseBody.citations : [];
  const content = String(responseBody?.choices?.[0]?.message?.content || "[]")
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let items = [];
  try {
    items = JSON.parse(content);
  } catch (err) {
    qaDebug(`Perplexity JSON parsing failed for ${topicTag}: ${err.message}`);
    items = [];
  }

  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const base = {
      headline: item?.headline || "",
      summary: item?.summary || "",
      source: item?.source || "unknown",
      url: item?.url || "#",
      tag: topicTag,
    };

    const parsedUrl = parseUrlOrNull(base.url);
    if (!parsedUrl) return base;

    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
      const citationUrl = selectCitationForHostname(citations, parsedUrl.hostname);
      if (citationUrl) base.url = citationUrl;
    }
    return base;
  });
}

function buildPerplexityPayload(topicTag, query) {
  return {
    model: "sonar",
    messages: [
      {
        role: "system",
        content: `You are a business and strategy news researcher covering AI, technology, healthcare, financial services, private equity, M&A, energy, consumer, policy, and consulting.\nReturn ONLY a JSON array of up to 3 distinct news items from the last 48 hours.\nEach item MUST include the direct article URL from your citations — not the homepage.\nFormat: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. wsj.com), "url": string (full direct article URL from your citations), "tag": "${topicTag}"}]\nNo markdown. No explanation. JSON array only.`,
      },
      {
        role: "user",
        content: `Find the 3 most important news items from the last 48 hours about: ${query}\nIMPORTANT: Use the direct article URLs from your search citations. Do not use homepage URLs.`,
      },
    ],
    max_tokens: 1000,
  };
}

function findLatestTopicCacheFile(topicTag) {
  const prefix = `${sanitizeCacheKey(topicTag)}_`;
  if (!fs.existsSync(CACHE_PERPLEXITY_DIR)) return null;
  const candidates = fs
    .readdirSync(CACHE_PERPLEXITY_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  if (!candidates.length) return null;
  return path.join(CACHE_PERPLEXITY_DIR, candidates[candidates.length - 1]);
}

function readPerplexityCacheFile(file, topicTag, stale = false) {
  const cached = readJson(file, {});
  return {
    items: Array.isArray(cached.parsed_items) ? cached.parsed_items : [],
    from_cache: true,
    cache_file: file,
    stale_fallback: stale,
    cost_usd: 0,
    raw_response: cached.raw_response || null,
    topic_tag: topicTag,
  };
}

function tryPerplexityCacheFallback(file, latestFallback, topicTag, stale = true) {
  if (file && fs.existsSync(file)) return readPerplexityCacheFile(file, topicTag, stale);
  if (latestFallback) return readPerplexityCacheFile(latestFallback, topicTag, true);
  return null;
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
  const file = path.join(
    CACHE_PERPLEXITY_DIR,
    `${sanitizeCacheKey(topicTag)}_${sanitizeCacheKey(dateKey || "run")}.json`
  );
  const latestFallback = findLatestTopicCacheFile(topicTag);

  if (!refreshCache) {
    const cached = tryPerplexityCacheFallback(file, latestFallback, topicTag, false);
    if (cached) return cached;
  }

  if (!allowLiveApi) {
    throw new Error(
      `Perplexity cache miss for topic "${topicTag}". Rerun with --live to warm cache or use --offline.`
    );
  }

  const apiKey = appConfig?.keys?.perplexity;
  if (!apiKey) throw new Error("Missing config.keys.perplexity for live Perplexity calls.");

  const estimated = Number(costs.perplexity_per_call_usd || COSTS.perplexity_per_call_usd);
  ensureBudget(budget, estimated, `Perplexity fetch (${topicTag})`);

  let res;
  try {
    res = await httpsPostWithRetry(
      "api.perplexity.ai",
      "/chat/completions",
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      buildPerplexityPayload(topicTag, query),
      {
        retries: 1,
        retryDelayMs: 900,
        timeoutMs: 20000,
      }
    );
  } catch (err) {
    const fallback = tryPerplexityCacheFallback(file, latestFallback, topicTag, true);
    if (fallback) return fallback;
    throw err;
  }

  if (res.status < 200 || res.status >= 300) {
    const fallback = tryPerplexityCacheFallback(file, latestFallback, topicTag, true);
    if (fallback) return fallback;
    throw new Error(`Perplexity fetch failed for ${topicTag}: status ${res.status}`);
  }

  const parsedItems = parsePerplexityItems(res.body, topicTag);
  writeJson(file, {
    timestamp: new Date().toISOString(),
    api: "perplexity.chat.completions",
    endpoint: "/chat/completions",
    model: "sonar",
    topic_tag: topicTag,
    input: {
      date_key: dateKey,
      query,
      payload: buildPerplexityPayload(topicTag, query),
    },
    raw_response: res.body,
    parsed_items: parsedItems,
    cost_usd: Number(estimated.toFixed(6)),
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
