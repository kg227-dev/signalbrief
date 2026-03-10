/**
 * SignalBrief — Digest Sandbox Pipeline
 * Orchestrates the digest pipeline for the sandbox tool.
 * Composes exported functions from digest.js — no delivery, no user persistence.
 */

const crypto = require("crypto");
const {
  fetchTopicNews,
  enrichItems,
  selectItems,
  dedupAgainstRecentArchives,
  formatTelegram,
  buildEmail,
  escapeHtml,
  topicVisual,
  stripInlineHtml,
  parseSourceDomain,
  CONFIG,
  MODEL_COSTS,
  SEARCH_COSTS,
} = require("./digest/application/digest-service-runtime");

const {
  buildCustomTopicQueries,
  filterItemsByTopics,
  applyTopicRelevanceScores,
  applyDigestDepth,
  reserveCustomKeywordSlot,
  normalizeTopicToken,
} = require("./digest/domain/topic-domain-runtime");

// ── In-memory cache for sandbox sessions ─────────────────────────────────────
const SANDBOX_CACHE = new Map();
const SANDBOX_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function pruneCache() {
  const now = Date.now();
  for (const [id, entry] of SANDBOX_CACHE) {
    if (now - entry.fetchedAt > SANDBOX_CACHE_TTL) SANDBOX_CACHE.delete(id);
  }
}

// ── Cost estimation (no API calls) ───────────────────────────────────────────

function estimateCost(params) {
  const {
    topics = [],
    customKeywords = [],
    itemCount = 5,
    searchModel = "sonar",
    enrichmentModel = "claude-haiku-4-5",
  } = params;

  // Perplexity calls: 1 per standard topic, up to 3 per custom keyword
  const standardCalls = topics.length;
  let customCalls = 0;
  for (const kw of customKeywords) {
    const queries = buildCustomTopicQueries(kw);
    customCalls += Math.min(3, Math.max(1, queries.length));
  }
  const totalCalls = standardCalls + customCalls;
  const searchCostPerCall = SEARCH_COSTS[searchModel] || 0.005;
  const perplexityCost = totalCalls * searchCostPerCall;

  // Claude tokens: estimate based on typical enrichment batch
  // ~2500 input tokens + ~300 per item, ~250 output tokens per item
  const estInputTokens = 2500 + (itemCount * 300);
  const estOutputTokens = itemCount * 250;
  const modelCost = MODEL_COSTS[enrichmentModel] || MODEL_COSTS["claude-haiku-4-5"];
  const claudeCost = (estInputTokens / 1_000_000 * modelCost.input)
                   + (estOutputTokens / 1_000_000 * modelCost.output);

  return {
    perplexity: {
      calls: totalCalls,
      standardCalls,
      customCalls,
      costPerCall: searchCostPerCall,
      costUsd: parseFloat(perplexityCost.toFixed(5)),
    },
    claude: {
      estInputTokens,
      estOutputTokens,
      model: enrichmentModel,
      costUsd: parseFloat(claudeCost.toFixed(5)),
    },
    totalUsd: parseFloat((perplexityCost + claudeCost).toFixed(5)),
  };
}

function buildFetchTargets(topics, customKeywords) {
  const fetchTargets = [];
  for (const topicTag of topics) {
    const configTopic = CONFIG.topics.find((topic) => topic.tag === topicTag);
    if (configTopic) fetchTargets.push(configTopic);
  }

  for (const keyword of customKeywords) {
    const queries = buildCustomTopicQueries(keyword);
    fetchTargets.push({
      tag: keyword.toUpperCase(),
      queries: queries.length ? queries : [`${keyword} business strategy developments last 48 hours`],
      isCustom: true,
    });
  }
  return fetchTargets;
}

async function getRawItemsForSession({ cachedSessionId, topics, customKeywords, searchModel }) {
  if (cachedSessionId && SANDBOX_CACHE.has(cachedSessionId)) {
    return {
      sessionId: cachedSessionId,
      rawItems: SANDBOX_CACHE.get(cachedSessionId).rawItems,
      fetchApiCalls: 0,
      fetchSkipped: true,
    };
  }

  pruneCache();
  const sessionId = crypto.randomBytes(16).toString("hex");
  const fetchTargets = buildFetchTargets(topics, customKeywords);
  const results = await Promise.all(fetchTargets.map((target) => fetchTopicNews(target, { searchModel })));
  const fetchApiCalls = results.reduce((sum, result) => sum + Number(result?.apiCalls || 0), 0);
  const rawItems = results.flatMap((result) => (Array.isArray(result?.items) ? result.items : []));
  SANDBOX_CACHE.set(sessionId, { rawItems, fetchedAt: Date.now() });

  return {
    sessionId,
    rawItems,
    fetchApiCalls,
    fetchSkipped: false,
  };
}

function buildVirtualUserTopics(topics, customKeywords) {
  return [
    ...topics,
    ...customKeywords.map((keyword) => `custom_${normalizeTopicToken(keyword).replace(/\s+/g, "_")}`),
  ];
}

function buildQuickScanRows(items) {
  return items.map((item, idx) => {
    const short = stripInlineHtml(item.headline).split(":")[0].split("—")[0].trim();
    const topic = topicVisual(item.tag);
    const safeTag = escapeHtml(String(item.tag || "News"));
    const safeShort = escapeHtml(short);
    return `<tr>
      <td style="font-size:14px;color:#111827;font-weight:700;padding:6px 10px 6px 0;vertical-align:top;line-height:1.5;white-space:nowrap;">${idx + 1}</td>
      <td style="padding:6px 0;vertical-align:top;line-height:1.5;">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};margin-bottom:2px;">${topic.icon} ${safeTag}</div>
        <div style="font-size:14px;color:#374151;line-height:1.5;">${safeShort}</div>
      </td>
    </tr>`;
  }).join("\n");
}

function computeRunCostBreakdown({
  fetchApiCalls,
  searchModel,
  enrichmentModel,
  claudeUsage,
}) {
  const searchCostPerCall = SEARCH_COSTS[searchModel] || 0.005;
  const perplexityCostUsd = fetchApiCalls * searchCostPerCall;
  const modelCost = MODEL_COSTS[enrichmentModel] || MODEL_COSTS["claude-haiku-4-5"];
  const claudeCostUsd = (claudeUsage.input_tokens / 1_000_000 * modelCost.input)
                      + (claudeUsage.output_tokens / 1_000_000 * modelCost.output);

  return {
    perplexity: {
      calls: fetchApiCalls,
      costPerCall: searchCostPerCall,
      costUsd: parseFloat(perplexityCostUsd.toFixed(5)),
    },
    claude: {
      model: enrichmentModel,
      inputTokens: claudeUsage.input_tokens,
      outputTokens: claudeUsage.output_tokens,
      costUsd: parseFloat(claudeCostUsd.toFixed(5)),
    },
    totalUsd: parseFloat((perplexityCostUsd + claudeCostUsd).toFixed(5)),
  };
}

function pickSerializableItems(items) {
  return items.map((item) => ({
    tag: item.tag,
    headline: item.headline,
    summary: item.summary,
    wim: item.wim,
    wim_brief: item.wim_brief || null,
    implications: item.implications || null,
    watch_next: item.watch_next || null,
    url: item.url,
    source: item.source,
    baseScore: item.baseScore,
    topicMatch: item.topicMatch,
    relevanceScore: item.relevanceScore,
    why_shown: item.why_shown || [],
  }));
}

async function runSelectionStage(rawItems, { itemCount, customKeywords, enrichmentModel }) {
  const stageTiming = {};

  const tDedup0 = Date.now();
  const dedupRes = dedupAgainstRecentArchives(rawItems, {
    days: 3,
    targetCount: itemCount,
    minBackfillItems: 3,
  });
  let items = dedupRes.items;
  stageTiming.dedupMs = Date.now() - tDedup0;

  const tSelect0 = Date.now();
  const customTags = customKeywords.map((keyword) => keyword.toUpperCase());
  items = selectItems(items, {
    maxItems: itemCount,
    customTags,
  });
  stageTiming.selectMs = Date.now() - tSelect0;

  const tEnrich0 = Date.now();
  const enrichment = await enrichItems(items, { model: enrichmentModel });
  items = enrichment.items;
  const claudeUsage = {
    input_tokens: Number(enrichment?.usage?.input_tokens || 0),
    output_tokens: Number(enrichment?.usage?.output_tokens || 0),
  };
  stageTiming.enrichMs = Date.now() - tEnrich0;

  return {
    dedupRes,
    items,
    claudeUsage,
    stageTiming,
  };
}

function rankAndTrimItems(items, { topics, customKeywords, topicWeights, itemCount, depth }) {
  const tScore0 = Date.now();
  const allUserTopics = buildVirtualUserTopics(topics, customKeywords);
  const filteredResult = filterItemsByTopics(items, allUserTopics, { minItems: 3 });
  let userItems = filteredResult.items;

  userItems = applyTopicRelevanceScores(userItems, allUserTopics, topicWeights, {
    specialistMode: false,
    repeatPenalty: 0,
    isRecentRepeat: () => false,
    sourceDomainForItem: parseSourceDomain,
  });
  userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const normalizedKeywords = customKeywords.map(normalizeTopicToken).filter(Boolean);
  userItems = reserveCustomKeywordSlot(userItems, itemCount, normalizedKeywords);
  userItems = applyDigestDepth(userItems, depth);

  return {
    userItems,
    scoreMs: Date.now() - tScore0,
  };
}

function formatPipelineOutputs(userItems, depth) {
  const tFormat0 = Date.now();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  const telegramText = formatTelegram(userItems, shortDate, { digests_received: 10 }, {});
  const quickScan = buildQuickScanRows(userItems);
  const emailHtml = buildEmail(
    userItems,
    dateStr,
    quickScan,
    "",
    false,
    true,
    depth,
    null,
    "",
    "",
    {}
  );

  return {
    emailHtml,
    telegramText,
    formatMs: Date.now() - tFormat0,
  };
}

// ── Sandbox pipeline (full run, no delivery) ─────────────────────────────────

async function runPipeline(params) {
  const {
    topics = [],
    customKeywords = [],
    depth = "headline_plus_why",
    itemCount = 5,
    topicWeights = {},
    searchModel = "sonar",
    enrichmentModel = "claude-haiku-4-5",
    cachedSessionId = null,
  } = params;

  const timing = {};
  const t0 = Date.now();
  let sessionId = cachedSessionId;
  let rawItems = [];
  let fetchApiCalls = 0;
  let fetchSkipped = false;

  // ── 1. Fetch (or use cache) ──────────────────────────────────────────────
  const tFetch0 = Date.now();
  const fetchStage = await getRawItemsForSession({ cachedSessionId, topics, customKeywords, searchModel });
  sessionId = fetchStage.sessionId;
  rawItems = fetchStage.rawItems;
  fetchApiCalls = fetchStage.fetchApiCalls;
  fetchSkipped = fetchStage.fetchSkipped;

  timing.fetchMs = Date.now() - tFetch0;

  const selectionStage = await runSelectionStage(rawItems, {
    itemCount,
    customKeywords,
    enrichmentModel,
  });
  timing.dedupMs = selectionStage.stageTiming.dedupMs;
  timing.selectMs = selectionStage.stageTiming.selectMs;
  timing.enrichMs = selectionStage.stageTiming.enrichMs;

  const rankingStage = rankAndTrimItems(selectionStage.items, {
    topics,
    customKeywords,
    topicWeights,
    itemCount,
    depth,
  });
  timing.scoreMs = rankingStage.scoreMs;

  const formatStage = formatPipelineOutputs(rankingStage.userItems, depth);
  timing.formatMs = formatStage.formatMs;

  // ── Cost breakdown ──────────────────────────────────────────────────────
  const cost = computeRunCostBreakdown({
    fetchApiCalls,
    searchModel,
    enrichmentModel,
    claudeUsage: selectionStage.claudeUsage,
  });

  timing.totalMs = Date.now() - t0;

  return {
    sessionId,
    fetchSkipped,
    items: pickSerializableItems(rankingStage.userItems),
    emailHtml: formatStage.emailHtml,
    telegramText: formatStage.telegramText,
    cost,
    timing,
    dedup: {
      removed: selectionStage.dedupRes.removed,
      backfilled: selectionStage.dedupRes.backfilled,
    },
  };
}

module.exports = { estimateCost, runPipeline };
