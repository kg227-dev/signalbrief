const {
  normalizeMatchText,
  normalizeTopicToken,
  CUSTOM_TOPIC_ALIASES,
} = require("./topic-utils");

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

  const aliases = CUSTOM_TOPIC_ALIASES[topic] || [];
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

const RELATED_TOPIC_GROUPS = [
  ["healthcare", "life sciences"],
  ["ai tech", "technology", "digital"],
  ["pe m a", "m a advisory", "financial services"],
  ["public sector", "policy regulatory"],
  ["energy", "sustainability"],
];

function topicsRelated(a, b) {
  const left = normalizeTopicToken(a);
  const right = normalizeTopicToken(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return RELATED_TOPIC_GROUPS.some((group) => group.includes(left) && group.includes(right));
}

function parseItemDomain(item) {
  const urlRaw = String(item?.url || "").trim();
  if (urlRaw) {
    try {
      const parsed = new URL(urlRaw);
      return parsed.hostname.replace(/^www\./i, "").toLowerCase();
    } catch (err) {
      if (process.env.QA_DEBUG === "1") {
        console.warn(`[qa-pipeline] falling back to source domain: ${err.message}`);
      }
    }
  }

  const sourceRaw = String(item?.source || "").trim().toLowerCase();
  if (!sourceRaw) return "unknown";
  const noProto = sourceRaw.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return noProto.split(/[\s/]/)[0] || "unknown";
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function selectItems(allItems, itemCount, maxItemsPerTag, opts = {}) {
  const maxItems = Math.max(1, Number(itemCount || 7));
  const perTagCap = Math.max(1, Number(maxItemsPerTag || 2));
  const perSourceCap = Math.max(1, Number(opts.maxItemsPerSourceDomain || Infinity));

  const customTagOrder = [...new Set((opts.customTags || []).map((t) => String(t || "").toLowerCase()).filter(Boolean))];
  const customTags = new Set(customTagOrder);
  const tagPriority = opts.tagPriority && typeof opts.tagPriority === "object" ? opts.tagPriority : {};
  const explicitCustomCap = Number(opts.maxCustomItems);
  const maxCustomItems = Number.isFinite(explicitCustomCap)
    ? Math.max(0, explicitCustomCap)
    : (customTags.size > 0 ? Math.max(1, Math.floor(maxItems * 0.4)) : Infinity);

  const seenHeadline = new Set();
  const seenUrl = new Set();
  const deduped = (allItems || []).filter((item) => {
    const headline = String(item?.headline || "").toLowerCase().trim();
    const urlKey = normalizeUrl(item?.url || "");
    if (!headline && !urlKey) return false;
    const headlineKey = headline.slice(0, 40);
    if (headlineKey && seenHeadline.has(headlineKey)) return false;
    if (urlKey && seenUrl.has(urlKey)) return false;
    if (headlineKey) seenHeadline.add(headlineKey);
    if (urlKey) seenUrl.add(urlKey);
    return true;
  });

  const tagCounts = {};
  const domainCounts = {};
  let customCount = 0;
  const selected = [];
  const pool = [...deduped];

  const underCaps = (item) => {
    const tag = String(item?.tag || "");
    if (!tag) return false;
    if ((tagCounts[tag] || 0) >= perTagCap) return false;
    if (customTags.size > 0 && customTags.has(tag.toLowerCase()) && customCount >= maxCustomItems) {
      return false;
    }
    const domain = parseItemDomain(item);
    if (Number.isFinite(perSourceCap) && (domainCounts[domain] || 0) >= perSourceCap) return false;
    return true;
  };

  const pickIndex = (lastTag, allowAdjacentTag = false) => {
    let bestIdx = -1;
    let bestCount = Infinity;
    let bestPriority = -Infinity;
    let bestDomainCount = Infinity;

    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      if (!underCaps(item)) continue;
      const tag = String(item?.tag || "");
      if (!allowAdjacentTag && lastTag && tag === lastTag) continue;
      const count = tagCounts[tag] || 0;
      const priority = Number(tagPriority[normalizeTopicToken(tag)] || 0);
      const domainCount = domainCounts[parseItemDomain(item)] || 0;

      if (
        count < bestCount
        || (count === bestCount && domainCount < bestDomainCount)
        || (count === bestCount && domainCount === bestDomainCount && priority > bestPriority)
      ) {
        bestCount = count;
        bestDomainCount = domainCount;
        bestPriority = priority;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  if (customTagOrder.length > 0 && maxCustomItems > 0) {
    for (const customTag of customTagOrder) {
      if (selected.length >= maxItems || customCount >= maxCustomItems) break;
      const idx = pool.findIndex((item) => {
        const tag = String(item?.tag || "").toLowerCase();
        return tag === customTag && underCaps(item);
      });
      if (idx === -1) continue;
      const item = pool.splice(idx, 1)[0];
      const domain = parseItemDomain(item);
      tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      customCount += 1;
      selected.push({ ...item, source_domain: item.source_domain || domain });
    }
  }

  while (selected.length < maxItems && pool.length > 0) {
    const lastTag = selected.length > 0 ? selected[selected.length - 1].tag : null;
    const idx = pickIndex(lastTag, false);
    const fallback = idx === -1 ? pickIndex(lastTag, true) : idx;
    if (fallback === -1) break;
    const item = pool.splice(fallback, 1)[0];
    const domain = parseItemDomain(item);
    tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    if (customTags.has(String(item?.tag || "").toLowerCase())) customCount += 1;
    selected.push({ ...item, source_domain: item.source_domain || domain });
  }

  return selected;
}

function isRecentRepeatItem(item, repeatIndex) {
  if (!repeatIndex || typeof repeatIndex !== "object") return false;
  const urlKeys = repeatIndex.urlKeys instanceof Set ? repeatIndex.urlKeys : new Set(repeatIndex.urlKeys || []);
  const headlineKeys = repeatIndex.headlineKeys instanceof Set ? repeatIndex.headlineKeys : new Set(repeatIndex.headlineKeys || []);
  const urlKey = normalizeUrl(item?.url || "");
  const headKey = normalizeMatchText(item?.headline || "").slice(0, 60);
  return (urlKey && urlKeys.has(urlKey)) || (headKey && headlineKeys.has(headKey));
}

function computeTopicSignals(item, userTopics) {
  const tagToken = normalizeTopicToken(item?.tag || "");
  const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);

  let best = 3;
  let exact = false;
  let partial = false;
  let customKeywordMatch = false;

  for (const topic of (userTopics || [])) {
    const rawTopic = String(topic || "");
    const topicToken = normalizeTopicToken(rawTopic);
    if (!topicToken) continue;

    const isExact = tagToken && topicToken === tagToken;
    const isPartial = tagToken && !isExact && topicsRelated(tagToken, topicToken);

    if (isExact) {
      exact = true;
      best = Math.max(best, 10);
    } else if (isPartial) {
      partial = true;
      best = Math.max(best, 7);
    }

    if (rawTopic.toLowerCase().startsWith("custom_") && customKeywordMatches(topicToken, bodyText, tagToken)) {
      customKeywordMatch = true;
      best = Math.max(best, 10);
    }
  }

  return {
    topicMatch: best,
    exactMatch: exact,
    partialMatch: partial,
    customKeywordMatch,
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
    if (
      topicsRelated(tagToken, keyToken)
    ) {
      total += w;
    }
  }
  return total;
}

function applyRelevanceScores(items, userTopics, topicWeights = {}, opts = {}) {
  const specialistMode = !!opts.specialist_mode;
  const repeatIndex = opts.repeat_index || null;
  const repeatPenalty = Math.max(0, Number(opts.repeat_penalty || 0));

  return (items || []).map((item) => {
    const signals = computeTopicSignals(item, userTopics);
    const base = typeof item?.baseScore === "number" ? item.baseScore : 5.0;
    const weight = matchWeightToTag(item?.tag, topicWeights);
    const weightBonus = weight * 0.6;

    let specialistBonus = 0;
    if (specialistMode) {
      if (signals.topicMatch >= 10) specialistBonus = 1.1;
      else if (signals.topicMatch >= 7) specialistBonus = 0.45;
      else specialistBonus = -0.6;
    }

    const freshnessPenalty = isRecentRepeatItem(item, repeatIndex) ? -repeatPenalty : 0;
    const raw = base * 0.6 + signals.topicMatch * 0.4 + weightBonus + specialistBonus + freshnessPenalty;

    const whyShown = [];
    if (signals.topicMatch >= 7) whyShown.push("topic_match");
    if (signals.customKeywordMatch) whyShown.push("custom_keyword");
    if (weightBonus > 0.25) whyShown.push("weight_boost");
    if (base >= 8.0) whyShown.push("high_base_score");

    return {
      ...item,
      source_domain: item?.source_domain || parseItemDomain(item),
      topicMatch: signals.topicMatch,
      weightBonus,
      specialistBonus,
      freshnessPenalty,
      relevanceScore: Math.min(10, Math.max(0, Math.round(raw * 10) / 10)),
      why_shown: whyShown,
    };
  });
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

function filterItemsForPersona(enrichedItems, userTopics, minItems = 3, opts = {}) {
  const items = Array.isArray(enrichedItems) ? enrichedItems : [];
  const topics = Array.isArray(userTopics) ? userTopics : [];
  const strictZeroFallback = !!opts.strictZeroFallback;

  if (topics.length < 1) {
    return {
      items,
      wasFiltered: false,
      filteredCount: 0,
      mode: "no-filter-topics-lt1",
    };
  }

  const { standardTopicsLower, customKeywords } = splitUserTopics(topics);
  const filtered = items.filter((item) => itemMatchesPersonaTopic(item, standardTopicsLower, customKeywords).matched);

  if (filtered.length >= minItems) {
    return {
      items: filtered,
      wasFiltered: true,
      filteredCount: filtered.length,
      mode: "filtered",
    };
  }

  if (filtered.length >= 1) {
    return {
      items: filtered,
      wasFiltered: true,
      filteredCount: filtered.length,
      mode: "filtered-below-min-no-topup",
    };
  }

  return {
    items: strictZeroFallback ? [] : items,
    wasFiltered: strictZeroFallback,
    filteredCount: 0,
    mode: strictZeroFallback ? "zero-match-strict" : "zero-match-fallback",
  };
}

function applyDepth(items, depth) {
  const d = String(depth || "").toLowerCase();
  if (d === "headline_only" || d === "headlines" || d === "scan") {
    return (items || []).map((i) => ({ ...i, wim: null }));
  }
  if (d === "oneliner" || d === "headline_plus_oneliner") {
    return (items || []).map((i) => {
      const base = i?.wim_brief
        ? String(i.wim_brief).trim()
        : (i?.wim
          ? String(i.wim).replace(/<strong>(.*?)<\/strong>/s, "$1").split(".")[0] + "."
          : null);
      return { ...i, wim: base };
    });
  }
  return (items || []).map((i) => ({ ...i }));
}

function itemMatchesAnyCustomKeyword(item, customKeywords = []) {
  if (!Array.isArray(customKeywords) || customKeywords.length === 0) return false;
  const tag = normalizeTopicToken(item?.tag || "");
  const text = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  return customKeywords.some((kw) => customKeywordMatches(kw, text, tag));
}

function reserveCustomKeywordSlot(items, requestedCount, customKeywords = []) {
  const scored = Array.isArray(items) ? items : [];
  const count = Math.max(1, Number(requestedCount || 5));
  const base = scored.slice(0, count);
  if (!base.length) return base;
  if (!Array.isArray(customKeywords) || customKeywords.length === 0) return base;
  if (base.some((item) => itemMatchesAnyCustomKeyword(item, customKeywords))) return base;

  const fallback = scored.find((item) => itemMatchesAnyCustomKeyword(item, customKeywords));
  if (!fallback) return base;

  const replaced = base.slice(0, Math.max(0, count - 1));
  const exists = replaced.some((item) =>
    String(item?.headline || "") === String(fallback?.headline || "")
    && String(item?.url || "") === String(fallback?.url || "")
  );
  if (!exists) replaced.push(fallback);
  return replaced
    .sort((a, b) => Number(b?.relevanceScore || 0) - Number(a?.relevanceScore || 0))
    .slice(0, count);
}

function buildDigestForPersona(enrichedItems, persona, runtime = {}) {
  const prefs = persona?.preferences || {};
  const { standardTopicsLower, customKeywords } = splitUserTopics(persona?.topics || []);
  const specialistMode = standardTopicsLower.length > 0 && standardTopicsLower.length <= 2;
  const filterRes = filterItemsForPersona(
    enrichedItems,
    persona?.topics || [],
    runtime.minFilteredItems || 3,
    { strictZeroFallback: specialistMode }
  );

  let scored = applyRelevanceScores(filterRes.items, persona?.topics || [], persona?.topic_weights || {}, {
    specialist_mode: specialistMode,
    standard_topic_count: standardTopicsLower.length,
    repeat_index: runtime.recent_repeat_index || null,
    repeat_penalty: runtime.repeat_penalty || 0,
  });
  scored = scored.sort((a, b) => Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0));

  const requested = Number(prefs.items_per_digest) || Number(runtime.defaultItemCount) || 5;
  const minBaseScoreForFinal = Number(runtime.minBaseScoreForFinal || 6.5);
  const minStrongItems = Math.max(2, Math.min(requested, 4));
  const stronger = scored.filter((item) =>
    Number(item?.baseScore || 0) >= minBaseScoreForFinal
    || (Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword"))
  );
  if (stronger.length >= minStrongItems) scored = stronger;

  const preTrimCount = scored.length;
  const trimmed = reserveCustomKeywordSlot(scored, requested, customKeywords);
  const preDepthItems = trimmed.map((i) => ({ ...i }));
  const depth = prefs.depth || "headline_plus_why";
  const finalItems = applyDepth(trimmed, depth);

  return {
    persona_id: persona?.id,
    persona_name: persona?.name,
    requested_count: requested,
    pre_trim_count: preTrimCount,
    delivered_count: finalItems.length,
    depth,
    was_filtered: filterRes.wasFiltered,
    filter_mode: filterRes.mode,
    filtered_match_count: filterRes.filteredCount,
    specialist_mode: specialistMode,
    pre_depth_items: preDepthItems,
    items: finalItems,
    scored_items: scored,
    raw_filtered_items: filterRes.items,
  };
}

function countAdjacencyViolations(items) {
  const arr = Array.isArray(items) ? items : [];
  let violations = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1]?.tag && arr[i]?.tag && arr[i - 1].tag === arr[i].tag) violations++;
  }
  return violations;
}

function tagDistribution(items) {
  const counts = {};
  for (const item of items || []) {
    const tag = item?.tag || "UNKNOWN";
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function jaccardSimilarity(aValues, bValues) {
  const a = new Set(aValues || []);
  const b = new Set(bValues || []);
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const val of a) {
    if (b.has(val)) inter++;
  }
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function statusFromScore(score, pass = 80, warn = 60) {
  const n = Number(score) || 0;
  if (n >= pass) return "pass";
  if (n >= warn) return "warn";
  return "fail";
}

module.exports = {
  selectItems,
  parseItemDomain,
  computeTopicMatch,
  matchWeightToTag,
  applyRelevanceScores,
  splitUserTopics,
  itemMatchesPersonaTopic,
  filterItemsForPersona,
  normalizeCustomKeyword,
  applyDepth,
  buildDigestForPersona,
  countAdjacencyViolations,
  tagDistribution,
  jaccardSimilarity,
  statusFromScore,
  normalizeTopicToken,
  normalizeMatchText,
};
