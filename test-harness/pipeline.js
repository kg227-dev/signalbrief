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

function selectItems(allItems, itemCount, maxItemsPerTag, opts = {}) {
  const maxItems = Math.max(1, Number(itemCount || 7));
  const perTagCap = Math.max(1, Number(maxItemsPerTag || 2));
  const customTagOrder = [...new Set((opts.customTags || []).map((t) => String(t || "").toLowerCase()).filter(Boolean))];
  const customTags = new Set(customTagOrder);
  const tagPriority = opts.tagPriority && typeof opts.tagPriority === "object" ? opts.tagPriority : {};
  const explicitCustomCap = Number(opts.maxCustomItems);
  const maxCustomItems = Number.isFinite(explicitCustomCap)
    ? Math.max(0, explicitCustomCap)
    : (customTags.size > 0 ? Math.max(1, Math.floor(maxItems * 0.4)) : Infinity);

  const seen = new Set();
  const deduped = (allItems || []).filter((item) => {
    const key = String(item?.headline || "").toLowerCase().slice(0, 40);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const tagCounts = {};
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
    return true;
  };

  const pickIndex = (lastTag, allowAdjacentTag = false) => {
    let bestIdx = -1;
    let bestCount = Infinity;
    let bestPriority = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      if (!underCaps(item)) continue;
      const tag = String(item?.tag || "");
      if (!allowAdjacentTag && lastTag && tag === lastTag) continue;
      const count = tagCounts[tag] || 0;
      const priority = Number(tagPriority[normalizeTopicToken(tag)] || 0);
      if (count < bestCount || (count === bestCount && priority > bestPriority)) {
        bestCount = count;
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
      tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
      customCount += 1;
      selected.push(item);
    }
  }

  while (selected.length < maxItems && pool.length > 0) {
    const lastTag = selected.length > 0 ? selected[selected.length - 1].tag : null;
    const idx = pickIndex(lastTag, false);
    const fallback = idx === -1 ? pickIndex(lastTag, true) : idx;
    if (fallback === -1) break;
    const item = pool.splice(fallback, 1)[0];
    tagCounts[item.tag] = (tagCounts[item.tag] || 0) + 1;
    if (customTags.has(String(item?.tag || "").toLowerCase())) customCount += 1;
    selected.push(item);
  }

  return selected;
}

function computeTopicMatch(item, userTopics) {
  const tagToken = normalizeTopicToken(item?.tag || "");
  const bodyText = normalizeMatchText(`${String(item?.headline || "")} ${String(item?.summary || "")}`);
  let best = 3;

  for (const topic of (userTopics || [])) {
    const rawTopic = String(topic || "");
    const topicToken = normalizeTopicToken(rawTopic);
    if (!topicToken) continue;

    const exact = tagToken && topicToken === tagToken;
    const partial = tagToken && !exact && (tagToken.includes(topicToken) || topicToken.includes(tagToken));
    if (exact) best = Math.max(best, 10);
    else if (partial) best = Math.max(best, 7);

    if (rawTopic.toLowerCase().startsWith("custom_") && bodyText.includes(topicToken)) {
      best = Math.max(best, 10);
    }
  }

  return best;
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
      tagToken === keyToken ||
      tagToken.includes(keyToken) ||
      keyToken.includes(tagToken)
    ) {
      total += w;
    }
  }
  return total;
}

function applyRelevanceScores(items, userTopics, topicWeights = {}) {
  return (items || []).map((item) => {
    const topicMatch = computeTopicMatch(item, userTopics);
    const base = typeof item?.baseScore === "number" ? item.baseScore : 5.0;
    const weight = matchWeightToTag(item?.tag, topicWeights);
    const weightBonus = weight * 0.5;
    const raw = base * 0.6 + topicMatch * 0.4 + weightBonus;
    return {
      ...item,
      topicMatch,
      weightBonus,
      relevanceScore: Math.min(10, Math.max(0, Math.round(raw * 10) / 10)),
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
  const tagMatch = (standardTopicsLower || []).some((t) => tag.includes(t) || t.includes(tag));
  const customMatch = (customKeywords || []).some((kw) => text.includes(kw));
  return { tagMatch, customMatch, matched: tagMatch || customMatch };
}

function filterItemsForPersona(enrichedItems, userTopics, minItems = 3) {
  const items = Array.isArray(enrichedItems) ? enrichedItems : [];
  const topics = Array.isArray(userTopics) ? userTopics : [];

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
    items,
    wasFiltered: false,
    filteredCount: 0,
    mode: "zero-match-fallback",
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

function buildDigestForPersona(enrichedItems, persona, runtime = {}) {
  const prefs = persona?.preferences || {};
  const filterRes = filterItemsForPersona(enrichedItems, persona?.topics || [], runtime.minFilteredItems || 3);
  let scored = applyRelevanceScores(filterRes.items, persona?.topics || [], persona?.topic_weights || {});
  scored = scored.sort((a, b) => Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0));

  const requested = Number(prefs.items_per_digest) || Number(runtime.defaultItemCount) || 5;
  const preTrimCount = scored.length;
  const trimmed = scored.slice(0, requested);
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
  computeTopicMatch,
  matchWeightToTag,
  applyRelevanceScores,
  splitUserTopics,
  itemMatchesPersonaTopic,
  filterItemsForPersona,
  applyDepth,
  buildDigestForPersona,
  countAdjacencyViolations,
  tagDistribution,
  jaccardSimilarity,
  statusFromScore,
  normalizeCustomKeyword,
};
