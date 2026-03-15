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

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeTopicRelevance(topicMatch) {
  if (Number(topicMatch) >= 10) return 1;
  if (Number(topicMatch) >= 7) return 0.68;
  return 0.18;
}

function recencySignal(item, nowIso) {
  const nowTs = Date.parse(String(nowIso || new Date().toISOString()));
  const pubTs = Date.parse(String(item?.published_date || ""));
  const retrievedTs = Date.parse(String(item?.retrieved_at || ""));
  const bestTs = Number.isFinite(pubTs) ? pubTs : retrievedTs;
  if (!Number.isFinite(nowTs) || !Number.isFinite(bestTs)) return 1;
  const ageHours = Math.max(0, (nowTs - bestTs) / (60 * 60 * 1000));
  return clamp(1 - (ageHours / 72), 0.15, 1);
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
  const recentEntityCounts = opts.recentEntityCounts && typeof opts.recentEntityCounts === "object"
    ? opts.recentEntityCounts
    : {};
  const recentStorylineKeys = opts.recentStorylineKeys instanceof Set
    ? opts.recentStorylineKeys
    : new Set(Array.isArray(opts.recentStorylineKeys) ? opts.recentStorylineKeys : []);
  const nowIso = String(opts.nowIso || new Date().toISOString());

  return allItems.map((item) => {
    const signals = computeTopicSignals(item, userTopics);
    const topicMatch = signals.topicMatch;
    const base = typeof item?.baseScore === "number" ? item.baseScore : 5.0;
    const weight = matchWeightToTag(item?.tag, topicWeights);
    const positivePreferenceBoost = clamp(weight / 5, 0, 1);
    const negativePreferencePenalty = clamp(Math.abs(Math.min(weight, 0)) / 5, 0, 1);
    const topicalRelevance = normalizeTopicRelevance(topicMatch);
    const customRelevance = signals.customKeywordMatch ? 1 : 0;
    const strategicImportance = clamp(
      Number.isFinite(Number(item?.strategic_value))
        ? Number(item?.strategic_value)
        : (base / 10),
      0,
      1
    );
    const sourceAuthority = clamp(
      Number.isFinite(Number(item?.source_authority))
        ? Number(item?.source_authority)
        : 0.5,
      0,
      1
    );
    const multiSourceConfirmation = clamp((Math.max(1, Number(item?.cross_source_count || 1)) - 1) / 2, 0, 1);
    const recency = recencySignal(item, nowIso);
    const entityKeys = Array.isArray(item?.entity_keys) ? item.entity_keys : [];
    const storylineKey = String(item?.storyline_key || "").trim();
    const recentEntityCount = entityKeys.reduce((maxCount, entityKey) => Math.max(maxCount, Number(recentEntityCounts[entityKey] || 0)), 0);
    const storylineRepeated = storylineKey && recentStorylineKeys.has(storylineKey);
    const novelty = storylineRepeated
      ? 0.15
      : clamp(1 - (recentEntityCount * 0.22), 0.35, 1);
    const duplicationPenalty = isRecentRepeat(item) ? clamp(Math.max(0.2, repeatPenalty / 2), 0, 0.7) : 0;
    const entitySaturationPenalty = clamp(recentEntityCount * 0.25, 0, 0.75);

    let specialistBoost = 0;
    if (specialistMode) {
      if (topicMatch >= 10) specialistBoost = 0.05;
      else if (topicMatch >= 7) specialistBoost = 0.02;
      else specialistBoost = -0.03;
    }

    const rawScore = clamp(
      0.18 * topicalRelevance
      + 0.08 * customRelevance
      + 0.28 * strategicImportance
      + 0.15 * novelty
      + 0.16 * sourceAuthority
      + 0.06 * multiSourceConfirmation
      + 0.03 * recency
      + 0.06 * positivePreferenceBoost
      + specialistBoost
      - (0.06 * negativePreferencePenalty),
      0,
      1
    );
    const adjustedNorm = clamp(
      rawScore
      * (1 - (duplicationPenalty * 0.5))
      * (1 - (entitySaturationPenalty * 0.35)),
      0,
      1
    );
    const signalScore = 10 * Math.pow(adjustedNorm, 1.15);

    const whyShown = [];
    if (topicMatch >= 7) whyShown.push("topic_match");
    if (signals.customKeywordMatch) whyShown.push("custom_keyword");
    if (positivePreferenceBoost > 0.2) whyShown.push("weight_boost");
    if (base >= 8.0) whyShown.push("high_base_score");
    if (multiSourceConfirmation >= 0.5) whyShown.push("cross_source");
    if (recentEntityCount > 0) whyShown.push("novelty_penalized");

    const sourceDomain = item?.source_domain
      || (sourceDomainForItem ? sourceDomainForItem(item) : null)
      || null;

    return {
      ...item,
      source_domain: sourceDomain,
      topicMatch,
      weightBonus: Number((positivePreferenceBoost - negativePreferencePenalty).toFixed(3)),
      specialistBonus: Number(specialistBoost.toFixed(3)),
      freshnessPenalty: Number((-duplicationPenalty).toFixed(3)),
      duplication_penalty: Number(duplicationPenalty.toFixed(3)),
      entity_saturation_penalty: Number(entitySaturationPenalty.toFixed(3)),
      relevanceScore: Math.min(10, Math.max(0, Math.round(signalScore * 10) / 10)),
      score_breakdown: {
        topical_relevance: Number(topicalRelevance.toFixed(3)),
        custom_keyword_relevance: Number(customRelevance.toFixed(3)),
        strategic_importance: Number(strategicImportance.toFixed(3)),
        novelty: Number(novelty.toFixed(3)),
        source_authority: Number(sourceAuthority.toFixed(3)),
        multi_source_confirmation: Number(multiSourceConfirmation.toFixed(3)),
        recency: Number(recency.toFixed(3)),
        preference_boost: Number(positivePreferenceBoost.toFixed(3)),
        duplication_penalty: Number(duplicationPenalty.toFixed(3)),
        entity_saturation_penalty: Number(entitySaturationPenalty.toFixed(3)),
        raw_score: Number(rawScore.toFixed(3)),
        adjusted_score: Number(adjustedNorm.toFixed(3)),
      },
      why_shown: whyShown,
    };
  });
}

function applyDigestDepth(items, depth) {
  const d = String(depth || "").toLowerCase();
  if (d === "headline_only" || d === "headlines" || d === "scan") {
    return (items || []).map((i) => ({ ...i, wim: null }));
  }
  if (d === "oneliner" || d === "headline_plus_oneliner") {
    return (items || []).map((i) => {
      const brief = i?.wim_brief
        ? String(i.wim_brief).trim()
        : (i?.wim
          ? String(i.wim).replace(/<strong>(.*?)<\/strong>/s, "$1").split(".")[0] + "."
          : null);
      return { ...i, wim: brief };
    });
  }
  return (items || []).map((i) => ({ ...i }));
}

function itemMatchesAnyCustomKeyword(item, customKeywords = []) {
  if (!Array.isArray(customKeywords) || customKeywords.length === 0) return false;
  const tagNormalized = normalizeTopicToken(item?.tag || "");
  const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  return customKeywords.some((kw) => customKeywordMatches(kw, bodyText, tagNormalized));
}

function reserveCustomKeywordSlot(items, requestedCount, customKeywords = []) {
  const scored = Array.isArray(items) ? items : [];
  const count = Math.max(1, Number(requestedCount || 5));
  const base = scored.slice(0, count);
  if (!base.length) return base;
  if (!Array.isArray(customKeywords) || customKeywords.length === 0) return base;

  const alreadyCovered = base.some((item) => itemMatchesAnyCustomKeyword(item, customKeywords));
  if (alreadyCovered) return base;

  const fallbackCandidate = scored.find((item) => itemMatchesAnyCustomKeyword(item, customKeywords));
  if (!fallbackCandidate) return base;

  const replaced = base.slice(0, Math.max(0, count - 1));
  const exists = replaced.some((item) =>
    String(item?.headline || "") === String(fallbackCandidate?.headline || "")
    && String(item?.url || "") === String(fallbackCandidate?.url || "")
  );
  if (!exists) replaced.push(fallbackCandidate);
  return replaced
    .sort((a, b) => Number(b?.relevanceScore || 0) - Number(a?.relevanceScore || 0))
    .slice(0, count);
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
  applyDigestDepth,
  reserveCustomKeywordSlot,
  applyTopicRelevanceScores,
  matchWeightToTag,
  normalizeCustomKeyword,
  normalizeMatchText,
  normalizeTopicToken,
  splitUserTopics,
  topicsRelated,
  itemMatchesPersonaTopic,
};
