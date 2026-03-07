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
} = require("./entrypoints/digest");

const {
  filterDigestItemsByTopics,
  scoreDigestItemsForUser,
  applyDigestDepth,
  reserveCustomKeywordSlot,
} = require("../digest-pipeline-seam");

const {
  buildCustomTopicQueries,
  normalizeTopicToken,
} = require("../topic-domain");

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
  let rawItems;
  let fetchApiCalls = 0;
  let fetchSkipped = false;

  // ── 1. Fetch (or use cache) ──────────────────────────────────────────────
  const tFetch0 = Date.now();

  if (cachedSessionId && SANDBOX_CACHE.has(cachedSessionId)) {
    const cached = SANDBOX_CACHE.get(cachedSessionId);
    rawItems = cached.rawItems;
    fetchSkipped = true;
  } else {
    pruneCache();
    sessionId = crypto.randomBytes(16).toString("hex");

    // Build fetch targets from selected topics
    const fetchTargets = [];
    for (const topicTag of topics) {
      const configTopic = CONFIG.topics.find((t) => t.tag === topicTag);
      if (configTopic) {
        fetchTargets.push(configTopic);
      }
    }

    // Add custom keyword targets
    for (const kw of customKeywords) {
      const queries = buildCustomTopicQueries(kw);
      fetchTargets.push({
        tag: kw.toUpperCase(),
        queries: queries.length ? queries : [`${kw} business strategy developments last 48 hours`],
        isCustom: true,
      });
    }

    // Fetch all in parallel with model override
    const results = await Promise.all(
      fetchTargets.map((t) => fetchTopicNews(t, { searchModel }))
    );
    fetchApiCalls = results.reduce((sum, rows) => sum + Number(rows?.__apiCalls || 0), 0);
    rawItems = results.flat();

    // Cache raw items for re-runs
    SANDBOX_CACHE.set(sessionId, { rawItems, fetchedAt: Date.now() });
  }

  timing.fetchMs = Date.now() - tFetch0;

  // ── 2. Dedup against recent archives ─────────────────────────────────────
  const tDedup0 = Date.now();
  const dedupRes = dedupAgainstRecentArchives(rawItems, {
    days: 3,
    targetCount: itemCount,
    minBackfillItems: 3,
  });
  let items = dedupRes.items;
  timing.dedupMs = Date.now() - tDedup0;

  // ── 3. Select best N ─────────────────────────────────────────────────────
  const tSelect0 = Date.now();
  const customTags = customKeywords.map((kw) => kw.toUpperCase());
  items = selectItems(items, {
    maxItems: itemCount,
    customTags,
  });
  timing.selectMs = Date.now() - tSelect0;

  // ── 4. Enrich with Claude ────────────────────────────────────────────────
  const tEnrich0 = Date.now();
  const enrichment = await enrichItems(items, { model: enrichmentModel });
  items = enrichment.items;
  const claudeUsage = {
    input_tokens: Number(enrichment?.usage?.input_tokens || 0),
    output_tokens: Number(enrichment?.usage?.output_tokens || 0),
  };
  timing.enrichMs = Date.now() - tEnrich0;

  // ── 5. Score for virtual user ────────────────────────────────────────────
  const tScore0 = Date.now();
  const allUserTopics = [
    ...topics,
    ...customKeywords.map((kw) => `custom_${normalizeTopicToken(kw).replace(/\s+/g, "_")}`),
  ];
  const filteredResult = filterDigestItemsByTopics(items, allUserTopics, { minItems: 3 });
  let userItems = filteredResult.items;

  userItems = scoreDigestItemsForUser(userItems, allUserTopics, topicWeights, {
    specialistMode: false,
    repeatPenalty: 0,
    isRecentRepeat: () => false,
    sourceDomainForItem: parseSourceDomain,
  });
  userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Trim to requested count
  const kwNormalized = customKeywords.map(normalizeTopicToken).filter(Boolean);
  userItems = reserveCustomKeywordSlot(userItems, itemCount, kwNormalized);
  timing.scoreMs = Date.now() - tScore0;

  // ── 6. Apply depth ──────────────────────────────────────────────────────
  userItems = applyDigestDepth(userItems, depth);

  // ── 7. Format outputs ───────────────────────────────────────────────────
  const tFormat0 = Date.now();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "America/New_York",
  });
  const shortDate = now.toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "America/New_York",
  });

  // Telegram format
  const telegramText = formatTelegram(userItems, shortDate, { digests_received: 10 }, {});

  // Email format — build quick scan rows
  const quickScan = userItems.map((i, idx) => {
    const short = stripInlineHtml(i.headline).split(":")[0].split("—")[0].trim();
    const topic = topicVisual(i.tag);
    const safeTag = escapeHtml(String(i.tag || "News"));
    const safeShort = escapeHtml(short);
    return `<tr>
      <td style="font-size:14px;color:#111827;font-weight:700;padding:6px 10px 6px 0;vertical-align:top;line-height:1.5;white-space:nowrap;">${idx + 1}</td>
      <td style="padding:6px 0;vertical-align:top;line-height:1.5;">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};margin-bottom:2px;">${topic.icon} ${safeTag}</div>
        <div style="font-size:14px;color:#374151;line-height:1.5;">${safeShort}</div>
      </td>
    </tr>`;
  }).join("\n");

  const emailHtml = buildEmail(
    userItems,
    dateStr,
    quickScan,
    "",       // userToken
    false,    // isFirstDigest
    true,     // wasFiltered
    depth,
    null,     // user
    "",       // digestDateKey
    "",       // digestId
    {}
  );
  timing.formatMs = Date.now() - tFormat0;

  // ── Cost breakdown ──────────────────────────────────────────────────────
  const searchCostPerCall = SEARCH_COSTS[searchModel] || 0.005;
  const perplexityCostUsd = fetchApiCalls * searchCostPerCall;
  const modelCost = MODEL_COSTS[enrichmentModel] || MODEL_COSTS["claude-haiku-4-5"];
  const claudeCostUsd = (claudeUsage.input_tokens / 1_000_000 * modelCost.input)
                      + (claudeUsage.output_tokens / 1_000_000 * modelCost.output);

  timing.totalMs = Date.now() - t0;

  return {
    sessionId,
    fetchSkipped,
    items: userItems.map((item) => ({
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
    })),
    emailHtml,
    telegramText,
    cost: {
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
    },
    timing,
    dedup: {
      removed: dedupRes.removed,
      backfilled: dedupRes.backfilled,
    },
  };
}

module.exports = { estimateCost, runPipeline };
