"use strict";

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTopicToken(value) {
  return normalizeMatchText(String(value || "").replace(/^custom_/i, "").replace(/×/g, " "));
}

const CUSTOM_TOPIC_ALIASES = {
  "rate cuts": [
    "federal reserve rate cut",
    "interest rate cuts",
    "fed rate decision",
    "fomc rate decision",
  ],
  "sec rulemaking": [
    "sec proposed rules",
    "securities and exchange commission rules",
    "sec disclosure rule",
    "sec rule proposal",
  ],
  semicap: [
    "semiconductor equipment",
    "chip equipment",
    "wafer fab equipment",
    "asml applied materials lam research",
  ],
  "agentic ai": [
    "ai agents",
    "enterprise ai agents",
    "autonomous ai agent",
    "openai anthropic microsoft agent",
  ],
  "quantum computing": ["quantum hardware", "quantum platform", "quantum commercial deployment"],
  "glp 1": ["obesity drugs", "weight loss drug", "novo nordisk eli lilly"],
  doge: ["dogecoin", "crypto regulation", "crypto market"],
  medtech: ["medical device", "diagnostics", "surgical systems", "hospital technology"],
};
const CUSTOM_KEYWORD_ALIASES = CUSTOM_TOPIC_ALIASES;

const CUSTOM_TOPIC_STOPWORDS = new Set(["the", "and", "for", "with", "from", "into", "over", "under", "news"]);
const CUSTOM_TOKEN_ALIASES = {
  rulemaking: ["rule", "rules", "proposed"],
  semicap: ["semiconductor", "chip"],
  agentic: ["agent", "agents"],
  cuts: ["cut", "reduce", "easing"],
  medtech: ["medical", "device", "diagnostic", "surgical"],
  sec: ["securities", "exchange", "commission"],
  rate: ["interest", "federal", "reserve", "fomc"],
};

const RELATED_TOPIC_GROUPS = [
  ["healthcare", "life sciences"],
  ["ai tech", "technology", "digital"],
  ["pe m a", "m a advisory", "financial services"],
  ["public sector", "policy regulatory"],
  ["energy", "sustainability"],
];

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWordBoundary(text, token) {
  const t = String(text || "");
  const w = String(token || "");
  if (!t || !w) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(w)}(?:\\s|$)`, "i");
  return pattern.test(t);
}

function tokenizeCustomTopic(topicNormalized) {
  return normalizeTopicToken(topicNormalized)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !CUSTOM_TOPIC_STOPWORDS.has(t))
    .filter((t) => t.length > 2 || ["ai", "pe", "sec", "fed"].includes(t));
}

function customKeywordMatches(topicNormalized, bodyText, tagNormalized = "") {
  const topic = normalizeTopicToken(topicNormalized);
  if (!topic) return false;

  const haystack = normalizeMatchText(`${bodyText || ""} ${tagNormalized || ""}`);
  if (!haystack) return false;

  if (haystack.includes(topic)) return true;

  const aliases = CUSTOM_KEYWORD_ALIASES[topic] || [];
  for (const alias of aliases) {
    const aliasToken = normalizeTopicToken(alias);
    if (aliasToken && haystack.includes(aliasToken)) return true;
  }

  const tokens = tokenizeCustomTopic(topic);
  if (!tokens.length) return false;

  const hitCount = tokens.reduce((sum, token) => {
    if (hasWordBoundary(haystack, token)) return sum + 1;
    const aliases = CUSTOM_TOKEN_ALIASES[token] || [];
    if (aliases.some((alias) => hasWordBoundary(haystack, alias))) return sum + 1;
    return sum;
  }, 0);
  const requiredHits = tokens.length >= 3 ? 2 : tokens.length;
  return hitCount >= Math.max(1, requiredHits);
}

function topicsRelated(a, b) {
  const left = normalizeTopicToken(a);
  const right = normalizeTopicToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return RELATED_TOPIC_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

function computeTopicSignals(item, userTopics) {
  const tagNormalized = normalizeTopicToken(item?.tag || "");
  const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  let best = 3;
  let customKeywordMatch = false;
  let exactMatch = false;
  let partialMatch = false;

  for (const topic of (userTopics || [])) {
    const rawTopic = String(topic || "");
    const topicNormalized = normalizeTopicToken(rawTopic);
    if (!topicNormalized) continue;

    const exact = tagNormalized && topicNormalized === tagNormalized;
    const partial = tagNormalized && !exact && topicsRelated(tagNormalized, topicNormalized);

    if (exact) {
      exactMatch = true;
      best = Math.max(best, 10);
    } else if (partial) {
      partialMatch = true;
      best = Math.max(best, 7);
    }

    if (rawTopic.toLowerCase().startsWith("custom_") && customKeywordMatches(topicNormalized, bodyText, tagNormalized)) {
      customKeywordMatch = true;
      best = Math.max(best, 10);
    }
  }

  return {
    topicMatch: best,
    customKeywordMatch,
    exactMatch,
    partialMatch,
  };
}

function computeTopicMatch(item, userTopics) {
  return computeTopicSignals(item, userTopics).topicMatch;
}

function matchWeightToTag(tag, topicWeights) {
  if (!topicWeights || typeof topicWeights !== "object") return 0;
  const tagToken = normalizeTopicToken(tag);
  let total = 0;
  for (const [key, weight] of Object.entries(topicWeights)) {
    const w = Number(weight);
    if (!w) continue;
    const keyToken = normalizeTopicToken(key);
    if (!keyToken) continue;
    if (topicsRelated(tagToken, keyToken)) total += w;
  }
  return total;
}

function normalizeCustomKeyword(topic) {
  return normalizeTopicToken(topic);
}

function splitUserTopics(userTopics) {
  const topics = Array.isArray(userTopics) ? userTopics : [];
  const standardTopicsLower = topics
    .filter((t) => !String(t).toLowerCase().startsWith("custom_"))
    .map((t) => normalizeTopicToken(t))
    .filter(Boolean);
  const standardSet = new Set(standardTopicsLower);

  const customKeywords = topics
    .filter((t) => {
      const raw = String(t || "");
      const normalized = normalizeTopicToken(raw);
      return raw.toLowerCase().startsWith("custom_") || !standardSet.has(normalized);
    })
    .map(normalizeCustomKeyword)
    .filter(Boolean);

  return { standardTopicsLower, customKeywords };
}

function itemMatchesPersonaTopic(item, standardTopicsLower, customKeywords) {
  const tag = normalizeTopicToken(item?.tag || "");
  const text = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  const tagMatch = (standardTopicsLower || []).some((t) => topicsRelated(tag, t));
  const customMatch = (customKeywords || []).some((kw) => customKeywordMatches(kw, text, tag));
  return { tagMatch, customMatch, matched: tagMatch || customMatch };
}

function filterItemsByTopics(items, userTopics, opts = {}) {
  const allItems = Array.isArray(items) ? items : [];
  const topics = Array.isArray(userTopics) ? userTopics : [];
  const minItems = Math.max(1, Number(opts.minItems || 3));
  const { standardTopicsLower, customKeywords } = splitUserTopics(topics);
  const specialistMode = standardTopicsLower.length > 0 && standardTopicsLower.length <= 2;
  const strictZeroFallback = opts.strictZeroFallback === "specialist"
    ? specialistMode
    : !!opts.strictZeroFallback;

  if (topics.length < 1) {
    return {
      items: allItems,
      wasFiltered: false,
      filteredCount: 0,
      mode: "no-filter-topics-lt1",
      standardTopicsLower,
      customKeywords,
      specialistMode,
    };
  }

  const filtered = allItems.filter((item) => itemMatchesPersonaTopic(item, standardTopicsLower, customKeywords).matched);
  if (filtered.length >= minItems) {
    return {
      items: filtered,
      wasFiltered: true,
      filteredCount: filtered.length,
      mode: "filtered",
      standardTopicsLower,
      customKeywords,
      specialistMode,
    };
  }
  if (filtered.length >= 1) {
    return {
      items: filtered,
      wasFiltered: true,
      filteredCount: filtered.length,
      mode: "filtered-below-min-no-topup",
      standardTopicsLower,
      customKeywords,
      specialistMode,
    };
  }
  if (strictZeroFallback) {
    return {
      items: [],
      wasFiltered: true,
      filteredCount: 0,
      mode: "zero-match-strict",
      standardTopicsLower,
      customKeywords,
      specialistMode,
    };
  }
  return {
    items: allItems,
    wasFiltered: false,
    filteredCount: 0,
    mode: "zero-match-fallback",
    standardTopicsLower,
    customKeywords,
    specialistMode,
  };
}

function applyTopicRelevanceScores(items, userTopics, topicWeights = {}, opts = {}) {
  const allItems = Array.isArray(items) ? items : [];
  const specialistMode = !!opts.specialistMode;
  const repeatPenalty = Math.max(0, Number(opts.repeatPenalty || 0));
  const isRecentRepeat = typeof opts.isRecentRepeat === "function"
    ? opts.isRecentRepeat
    : () => false;
  const sourceDomainForItem = typeof opts.sourceDomainForItem === "function"
    ? opts.sourceDomainForItem
    : null;

  return allItems.map((item) => {
    const signals = computeTopicSignals(item, userTopics);
    const topicMatch = signals.topicMatch;
    const base = typeof item?.baseScore === "number" ? item.baseScore : 5.0;
    const weight = matchWeightToTag(item?.tag, topicWeights);
    const weightBonus = weight * 0.6;

    let specialistBonus = 0;
    if (specialistMode) {
      if (topicMatch >= 10) specialistBonus = 1.1;
      else if (topicMatch >= 7) specialistBonus = 0.45;
      else specialistBonus = -0.6;
    }

    const freshnessPenalty = isRecentRepeat(item) ? -repeatPenalty : 0;
    const rawScore = base * 0.6 + topicMatch * 0.4 + weightBonus + specialistBonus + freshnessPenalty;
    const whyShown = [];
    if (topicMatch >= 7) whyShown.push("topic_match");
    if (signals.customKeywordMatch) whyShown.push("custom_keyword");
    if (weightBonus > 0.25) whyShown.push("weight_boost");
    if (base >= 8.0) whyShown.push("high_base_score");

    const sourceDomain = item?.source_domain
      || (sourceDomainForItem ? sourceDomainForItem(item) : null)
      || null;

    return {
      ...item,
      source_domain: sourceDomain,
      topicMatch,
      weightBonus,
      specialistBonus,
      freshnessPenalty,
      relevanceScore: Math.min(10, Math.max(0, Math.round(rawScore * 10) / 10)),
      why_shown: whyShown,
    };
  });
}

function buildCustomTopicQueries(keywordRaw) {
  const keyword = String(keywordRaw || "").trim().replace(/\s+/g, " ");
  if (!keyword) return [];
  const normalized = normalizeTopicToken(keyword);
  const aliases = CUSTOM_KEYWORD_ALIASES[normalized] || [];
  const base = [
    `${keyword} business strategy developments last 48 hours`,
    `${keyword} market impact regulation deals earnings last 72 hours`,
    `${keyword} strategy and investment implications last 72 hours`,
  ];
  if (keyword.split(" ").length <= 2) {
    base.unshift(`${keyword} company and sector news last 48 hours`);
  }
  const merged = [...base, ...aliases.map((a) => `${a} business and market developments last 72 hours`)];
  const seen = new Set();
  const queries = [];
  for (const query of merged) {
    const clean = String(query || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(clean);
    if (queries.length >= 4) break;
  }
  return queries;
}

module.exports = {
  CUSTOM_KEYWORD_ALIASES,
  CUSTOM_TOPIC_ALIASES,
  RELATED_TOPIC_GROUPS,
  buildCustomTopicQueries,
  computeTopicMatch,
  computeTopicSignals,
  customKeywordMatches,
  filterItemsByTopics,
  applyTopicRelevanceScores,
  matchWeightToTag,
  normalizeCustomKeyword,
  normalizeMatchText,
  normalizeTopicToken,
  splitUserTopics,
  topicsRelated,
  itemMatchesPersonaTopic,
};
