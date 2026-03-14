"use strict";

const crypto = require("crypto");
const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("./topic-domain-runtime");

const STANDARD_TOPIC_TOKENS = new Set([
  "healthcare",
  "financial services",
  "pe m a",
  "energy",
  "consumer",
  "life sciences",
  "technology",
  "industrials",
  "real estate",
  "public sector",
  "ai tech",
  "strategy",
  "policy regulatory",
  "sustainability",
  "digital",
  "m a advisory",
  "talent",
]);

const GENERIC_ENTITY_STOPWORDS = new Set([
  "friday",
  "thursday",
  "wednesday",
  "tuesday",
  "monday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "business",
  "boardroom",
  "strategy",
  "inside",
  "reality",
  "signals",
  "daily",
  "enterprise",
  "world",
  "conference",
  "report",
  "guidance",
  "ceos",
  "ceo",
]);

const SOURCE_TIER_RULES = Object.freeze({
  premium: {
    score: 0.95,
    domains: ["reuters.com", "bloomberg.com", "ft.com", "wsj.com", "sec.gov", "fda.gov", "cms.gov"],
  },
  strong: {
    score: 0.8,
    domains: [
      "spglobal.com",
      "gartner.com",
      "nasdaq.com",
      "esgtoday.com",
      "esgdive.com",
      "pharmexec.com",
      "biospace.com",
      "fiercebiotech.com",
      "fiercehealthcare.com",
      "modernhealthcare.com",
    ],
  },
  standard: {
    score: 0.6,
    domains: [
      "xtalks.com",
      "pestakeholder.org",
      "lawrenceevans.com",
      "cpapracticeadvisor.com",
      "bottomline.com",
      "conference-board.org",
      "fintechfutures.com",
      "crowdfundinsider.com",
      "reinsurancene.ws",
      "apmdigest.com",
      "deloitte.com",
      "forvismazars.us",
    ],
  },
  corporate: {
    score: 0.42,
    domains: ["pfizer.com", "businesswire.com", "prnewswire.com"],
  },
  weak: {
    score: 0.22,
    domains: [
      "investing.com",
      "ng.investing.com",
      "barchart.com",
      "financialcontent.com",
      "markets.financialcontent.com",
      "mexc.com",
      "promptinjection.net",
      "stockstotrade.com",
      "youtube.com",
    ],
  },
});

const FLAG_RULES = [
  { flag: "routine_dividend", pattern: /\b(dividend|shareholders? of record|quarterly payout|consecutive quarterly dividend|payable march)\b/i },
  { flag: "investor_relations", pattern: /\b(j\.?\s?p\.?\s?morgan|td cowen|investor day|conference|shareholder meeting|fireside chat)\b/i },
  { flag: "conference_recap", pattern: /\b(showcased|shines at|world 2026|conference recap|summit)\b/i },
  { flag: "stock_promo", pattern: /\b(stock|shares?)\b.*\b(up|jumped|surged|optimism|bitcoin ventures)\b/i },
  { flag: "generic_commentary", pattern: /\b(challenges ceos can't ignore|must prioritize|business reality|inside the boardroom|customer centric|innovation velocity)\b/i },
  { flag: "guidance", pattern: /\b(guidance|outlook|forecast|projects? .* revenue|revenue of \$|\brevenue\b.*\b2026\b)\b/i },
  { flag: "trial_readout", pattern: /\b(phase ii|phase iii|pivotal study|trial|readout|clinical data)\b/i },
  { flag: "m_and_a", pattern: /\b(acquires?|acquisition|buyout|merger|deal|sale of|sells?)\b/i },
  { flag: "regulatory", pattern: /\b(rule|rules|regulation|regulatory|deadline|bill|approval|approved)\b/i },
  { flag: "earnings", pattern: /\b(earnings|results|quarter|q1|q2|q3|q4)\b/i },
  { flag: "product_launch", pattern: /\b(launch|approval|approved|rollout)\b/i },
];

const HINT_RULES = [
  { hint: "obesity_pipeline", pattern: /\b(obesity|glp[- ]?1|weight loss)\b/i },
  { hint: "oncology_pipeline", pattern: /\b(oncology|cancer)\b/i },
  { hint: "patent_cliff", pattern: /\b(patent cliff|loe|loss of exclusivity)\b/i },
  { hint: "pipeline_execution", pattern: /\b(pipeline|r&d|phase iii|pivotal study)\b/i },
  { hint: "capital_return", pattern: /\b(dividend|buyback|capital return)\b/i },
  { hint: "guidance", pattern: /\b(guidance|outlook|forecast|revenue)\b/i },
  { hint: "investor_day", pattern: /\b(j\.?\s?p\.?\s?morgan|td cowen|conference|investor day)\b/i },
  { hint: "regulatory_shift", pattern: /\b(rule|regulation|deadline|bill|approval)\b/i },
  { hint: "deal_activity", pattern: /\b(acquire|acquisition|buyout|merger|sale)\b/i },
  { hint: "executive_commentary", pattern: /\b(ceo|boardroom|must prioritize|business reality)\b/i },
];

const HARD_EXCLUDE_FLAGS = new Set(["routine_dividend", "stock_promo"]);

function clamp(value, min = 0, max = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function stripHtml(value) {
  return String(value || "").replace(/<\/?[^>]+>/g, " ");
}

function uniqSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort();
}

function tokenSet(value) {
  return new Set(
    normalizeMatchText(value)
      .split(" ")
      .filter((token) => token.length >= 4)
  );
}

function jaccard(aValues, bValues) {
  const a = new Set(Array.isArray(aValues) ? aValues : aValues instanceof Set ? Array.from(aValues) : []);
  const b = new Set(Array.isArray(bValues) ? bValues : bValues instanceof Set ? Array.from(bValues) : []);
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size || 1;
  return intersection / union;
}

function classifySourceTier(sourceDomainRaw) {
  const sourceDomain = String(sourceDomainRaw || "").trim().toLowerCase().replace(/^www\./, "");
  if (!sourceDomain) return { source_tier: "unknown", source_authority: 0.45 };

  for (const [sourceTier, rule] of Object.entries(SOURCE_TIER_RULES)) {
    if (rule.domains.some((domain) => sourceDomain === domain || sourceDomain.endsWith(`.${domain}`))) {
      return { source_tier: sourceTier, source_authority: rule.score };
    }
  }
  return { source_tier: "unknown", source_authority: 0.5 };
}

function normalizePromptFlags(flags) {
  return uniqSorted((Array.isArray(flags) ? flags : []).map((flag) => normalizeTopicToken(flag)).filter(Boolean));
}

function normalizePromptHints(hints) {
  return uniqSorted((Array.isArray(hints) ? hints : []).map((hint) => normalizeTopicToken(hint)).filter(Boolean));
}

function detectLocalContentFlags(item) {
  const text = `${item?.headline || ""} ${item?.summary || ""} ${stripHtml(item?.wim || "")}`;
  const flags = [];
  for (const rule of FLAG_RULES) {
    if (rule.pattern.test(text)) flags.push(rule.flag);
  }
  return uniqSorted(flags);
}

function buildStorylineHints(item, contentFlags, promptHints = []) {
  const text = `${item?.headline || ""} ${item?.summary || ""} ${stripHtml(item?.wim || "")}`;
  const hints = Array.isArray(promptHints) ? promptHints.slice() : [];
  for (const rule of HINT_RULES) {
    if (rule.pattern.test(text)) hints.push(rule.hint);
  }
  if (Array.isArray(contentFlags)) {
    if (contentFlags.includes("trial_readout")) hints.push("trial_progress");
    if (contentFlags.includes("m_and_a")) hints.push("deal_activity");
    if (contentFlags.includes("regulatory")) hints.push("regulatory_shift");
    if (contentFlags.includes("generic_commentary")) hints.push("executive_commentary");
  }
  return uniqSorted(hints.map((hint) => normalizeTopicToken(hint)).filter(Boolean));
}

function extractEntityKeys(item) {
  const entities = new Set();
  const tagToken = normalizeTopicToken(item?.tag || "");
  const hasSpecificTag = tagToken && !STANDARD_TOPIC_TOKENS.has(tagToken);
  if (hasSpecificTag) entities.add(tagToken);

  const headline = String(item?.headline || "");
  if (hasSpecificTag) {
    const acronyms = headline.match(/\b[A-Z]{2,6}\b/g) || [];
    for (const raw of acronyms) {
      const normalized = normalizeTopicToken(raw);
      if (!normalized || normalized === tagToken || STANDARD_TOPIC_TOKENS.has(normalized) || GENERIC_ENTITY_STOPWORDS.has(normalized)) continue;
      entities.add(normalized);
      if (entities.size >= 5) break;
    }
    return uniqSorted([...entities]);
  }

  const matches = headline.match(/\b(?:[A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){0,2}|[A-Z]{2,6})\b/g) || [];
  for (const raw of matches) {
    const normalized = normalizeTopicToken(raw);
    if (!normalized || STANDARD_TOPIC_TOKENS.has(normalized) || GENERIC_ENTITY_STOPWORDS.has(normalized)) continue;
    if (normalized.length < 3) continue;
    entities.add(normalized);
    if (entities.size >= 5) break;
  }

  return uniqSorted([...entities]);
}

function computeRoutineItemScore(contentFlags, sourceInfo) {
  const flags = new Set(Array.isArray(contentFlags) ? contentFlags : []);
  let score = 0;
  if (flags.has("routine_dividend")) score += 0.82;
  if (flags.has("stock_promo")) score += 0.88;
  if (flags.has("generic_commentary")) score += 0.58;
  if (flags.has("conference_recap")) score += 0.46;
  if (flags.has("investor_relations")) score += 0.34;
  if (sourceInfo.source_tier === "weak") score += 0.16;
  if (sourceInfo.source_tier === "corporate") score += 0.08;
  return clamp(score, 0, 1);
}

function computeStrategicValue(item, sourceInfo, routineItemScore, contentFlags) {
  const baseNorm = clamp(Number(item?.baseScore || 0) / 10, 0, 1);
  const promptStrategic = Number.isFinite(Number(item?.strategic_value))
    ? clamp(Number(item.strategic_value), 0, 1)
    : baseNorm;
  const flags = new Set(Array.isArray(contentFlags) ? contentFlags : []);

  let bonus = 0;
  if (flags.has("trial_readout")) bonus += 0.08;
  if (flags.has("regulatory")) bonus += 0.08;
  if (flags.has("m_and_a")) bonus += 0.08;
  if (flags.has("guidance")) bonus += 0.04;
  if (flags.has("earnings")) bonus += 0.03;
  if (flags.has("product_launch")) bonus += 0.03;
  if (flags.has("generic_commentary")) bonus -= 0.08;
  if (flags.has("conference_recap")) bonus -= 0.06;
  if (flags.has("routine_dividend")) bonus -= 0.28;
  if (flags.has("stock_promo")) bonus -= 0.34;

  const score = (
    0.6 * promptStrategic
    + 0.25 * baseNorm
    + 0.15 * sourceInfo.source_authority
    + bonus
    - (routineItemScore * 0.42)
  );
  return clamp(score, 0, 1);
}

function buildStorylineFingerprint(item) {
  const entity = Array.isArray(item?.entity_keys) && item.entity_keys.length ? item.entity_keys[0] : normalizeTopicToken(item?.tag || "");
  const hints = Array.isArray(item?.storyline_hints) ? item.storyline_hints.slice(0, 3) : [];
  return uniqSorted([entity, ...hints]).join("|");
}

function annotateEditorialSignals(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const promptFlags = normalizePromptFlags(item?.content_flags);
    const promptHints = normalizePromptHints(item?.storyline_hints);
    const localFlags = detectLocalContentFlags(item);
    const contentFlags = uniqSorted([...promptFlags, ...localFlags]);
    const sourceInfo = classifySourceTier(item?.source_domain || item?.source);
    const storylineHints = buildStorylineHints(item, contentFlags, promptHints);
    const entityKeys = extractEntityKeys(item);
    const routineItemScore = computeRoutineItemScore(contentFlags, sourceInfo);
    const strategicValue = computeStrategicValue(item, sourceInfo, routineItemScore, contentFlags);
    const hardExclude = contentFlags.some((flag) => HARD_EXCLUDE_FLAGS.has(flag));

    return {
      ...item,
      content_flags: contentFlags,
      entity_keys: entityKeys,
      storyline_hints: storylineHints,
      source_tier: sourceInfo.source_tier,
      source_authority: Number(sourceInfo.source_authority.toFixed(3)),
      routine_item_score: Number(routineItemScore.toFixed(3)),
      strategic_value: Number(strategicValue.toFixed(3)),
      hard_exclude: hardExclude,
      storyline_key: buildStorylineFingerprint({
        ...item,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
      }),
    };
  });
}

function headlineTokenOverlap(leftItem, rightItem) {
  const leftTokens = tokenSet(`${leftItem?.headline || ""} ${leftItem?.summary || ""}`);
  const rightTokens = tokenSet(`${rightItem?.headline || ""} ${rightItem?.summary || ""}`);
  return jaccard(leftTokens, rightTokens);
}

function storylineSimilarity(leftItem, rightItem) {
  if (!leftItem || !rightItem) return 0;

  const sameUrl = String(leftItem?.url || "").trim() && String(leftItem?.url || "").trim() === String(rightItem?.url || "").trim();
  const sameHeadline = normalizeMatchText(leftItem?.headline || "") === normalizeMatchText(rightItem?.headline || "");
  if (sameUrl || sameHeadline) return 1;

  const entityOverlap = jaccard(leftItem?.entity_keys || [], rightItem?.entity_keys || []);
  const hintOverlap = jaccard(leftItem?.storyline_hints || [], rightItem?.storyline_hints || []);
  const textOverlap = headlineTokenOverlap(leftItem, rightItem);
  const tagRelated = topicsRelated(leftItem?.tag || "", rightItem?.tag || "") ? 1 : 0;

  if (
    entityOverlap > 0
    && hintOverlap === 0
    && textOverlap < 0.18
    && ((leftItem?.storyline_hints || []).length > 0 || (rightItem?.storyline_hints || []).length > 0)
  ) {
    return 0;
  }

  if (entityOverlap >= 0.5 && hintOverlap >= 0.34) return 0.86;
  if (entityOverlap >= 0.5 && textOverlap >= 0.34) return 0.8;
  if (textOverlap >= 0.52 && (tagRelated > 0 || entityOverlap >= 0.2)) return 0.78;

  return (
    0.38 * entityOverlap
    + 0.28 * hintOverlap
    + 0.24 * textOverlap
    + 0.1 * tagRelated
  );
}

function chooseRepresentative(items) {
  const ranked = (Array.isArray(items) ? items : []).slice().sort((left, right) => {
    const leftScore = (
      Number(left?.strategic_value || 0) * 0.46
      + Number(left?.source_authority || 0) * 0.18
      + clamp(Number(left?.baseScore || 0) / 10, 0, 1) * 0.2
      + (1 - Number(left?.routine_item_score || 0)) * 0.16
    );
    const rightScore = (
      Number(right?.strategic_value || 0) * 0.46
      + Number(right?.source_authority || 0) * 0.18
      + clamp(Number(right?.baseScore || 0) / 10, 0, 1) * 0.2
      + (1 - Number(right?.routine_item_score || 0)) * 0.16
    );
    return rightScore - leftScore;
  });
  return ranked[0] || null;
}

function clusterStorylines(items = []) {
  const annotated = annotateEditorialSignals(items);
  const clusters = [];

  for (const item of annotated) {
    let bestCluster = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const comparisonItems = cluster.items.slice(0, 4);
      const scores = comparisonItems.map((candidate) => storylineSimilarity(candidate, item));
      const similarity = scores.length
        ? scores.reduce((sum, value) => sum + value, 0) / scores.length
        : 0;
      if (similarity >= 0.58 && similarity > bestScore) {
        bestScore = similarity;
        bestCluster = cluster;
      }
    }

    if (!bestCluster) {
      clusters.push({ items: [item], similarities: [] });
      continue;
    }

    bestCluster.items.push(item);
    bestCluster.similarities.push(bestScore);
  }

  return clusters.map((cluster, index) => {
    const representative = chooseRepresentative(cluster.items);
    const sources = uniqSorted(cluster.items.map((item) => String(item?.source_domain || item?.source || "").trim()).filter(Boolean));
    const confidence = cluster.similarities.length
      ? cluster.similarities.reduce((sum, value) => sum + value, 0) / cluster.similarities.length
      : 1;
    const storylineId = crypto
      .createHash("sha1")
      .update(`${buildStorylineFingerprint(representative || {})}:${index}`)
      .digest("hex")
      .slice(0, 12);

    return {
      storyline_id: `story-${storylineId}`,
      canonical_headline: representative?.headline || cluster.items[0]?.headline || "",
      representative: representative || cluster.items[0] || null,
      supporting_sources: sources,
      supporting_headlines: cluster.items.map((item) => String(item?.headline || "")).filter(Boolean),
      cross_source_count: sources.length,
      storyline_size: cluster.items.length,
      entity_keys: uniqSorted(cluster.items.flatMap((item) => item?.entity_keys || [])),
      storyline_hints: uniqSorted(cluster.items.flatMap((item) => item?.storyline_hints || [])),
      cluster_confidence: Number(clamp(confidence, 0, 1).toFixed(3)),
      strategic_value: Number(clamp(Math.max(...cluster.items.map((item) => Number(item?.strategic_value || 0))), 0, 1).toFixed(3)),
      items: cluster.items,
    };
  });
}

function buildStorylineCandidates(items = []) {
  return clusterStorylines(items).map((cluster) => ({
    ...(cluster.representative || {}),
    storyline_id: cluster.storyline_id,
    storyline_size: cluster.storyline_size,
    supporting_sources: cluster.supporting_sources,
    supporting_headlines: cluster.supporting_headlines,
    cross_source_count: cluster.cross_source_count,
    entity_keys: cluster.entity_keys,
    storyline_hints: cluster.storyline_hints,
    cluster_confidence: cluster.cluster_confidence,
    storyline_strategic_value: cluster.strategic_value,
    storyline_key: buildStorylineFingerprint({
      entity_keys: cluster.entity_keys,
      storyline_hints: cluster.storyline_hints,
    }),
  }));
}

function applyStrategicQualityGate(items = [], opts = {}) {
  const candidates = Array.isArray(items) ? items : [];
  if (!candidates.length) return [];

  const minStrategicValue = clamp(opts.minStrategicValue != null ? opts.minStrategicValue : 0.34, 0, 1);
  const maxRoutineScore = clamp(opts.maxRoutineScore != null ? opts.maxRoutineScore : 0.74, 0, 1);
  const minKeep = Math.max(1, Number(opts.minKeep || 3));

  const kept = candidates.filter((item) => (
    !item?.hard_exclude
    && Number(item?.strategic_value || 0) >= minStrategicValue
    && Number(item?.routine_item_score || 0) <= maxRoutineScore
  ));
  if (kept.length >= minKeep) return kept;

  const fallback = candidates
    .filter((item) => !item?.hard_exclude)
    .sort((left, right) => {
      const leftScore = Number(left?.strategic_value || 0) - Number(left?.routine_item_score || 0) * 0.35;
      const rightScore = Number(right?.strategic_value || 0) - Number(right?.routine_item_score || 0) * 0.35;
      return rightScore - leftScore;
    });
  if (fallback.length > 0) return fallback.slice(0, Math.max(minKeep, kept.length));

  return candidates
    .slice()
    .sort((left, right) => Number(right?.strategic_value || 0) - Number(left?.strategic_value || 0))
    .slice(0, 1);
}

function buildRecentEntityHistory(records = [], maxDigests = 3) {
  const history = Array.isArray(records) ? records.slice(0, Math.max(0, Number(maxDigests || 3))) : [];
  const entityCounts = {};
  const storylineKeys = new Set();

  for (const record of history) {
    const items = Array.isArray(record?.items) ? record.items : [];
    for (const item of items) {
      const entityKeys = Array.isArray(item?.entity_keys) ? item.entity_keys : [];
      for (const entityKey of entityKeys) {
        entityCounts[entityKey] = (entityCounts[entityKey] || 0) + 1;
      }
      const storylineKey = String(item?.storyline_key || "").trim();
      if (storylineKey) storylineKeys.add(storylineKey);
    }
  }

  return {
    entityCounts,
    storylineKeys,
  };
}

function applyEntityCoverageCap(items = [], maxPerEntity = 1) {
  const limit = Math.max(1, Number(maxPerEntity || 1));
  const counts = {};
  const kept = [];
  for (const item of (Array.isArray(items) ? items : [])) {
    const entityKeys = Array.isArray(item?.entity_keys) ? item.entity_keys : [];
    if (entityKeys.length === 0) {
      kept.push(item);
      continue;
    }
    const blocked = entityKeys.some((entityKey) => (counts[entityKey] || 0) >= limit);
    if (blocked) continue;
    kept.push(item);
    for (const entityKey of entityKeys) {
      counts[entityKey] = (counts[entityKey] || 0) + 1;
    }
  }
  return kept;
}

module.exports = {
  HARD_EXCLUDE_FLAGS,
  annotateEditorialSignals,
  applyEntityCoverageCap,
  applyStrategicQualityGate,
  buildRecentEntityHistory,
  buildStorylineCandidates,
  buildStorylineFingerprint,
  classifySourceTier,
  clusterStorylines,
  computeStrategicValue,
  detectLocalContentFlags,
  extractEntityKeys,
  storylineSimilarity,
};
