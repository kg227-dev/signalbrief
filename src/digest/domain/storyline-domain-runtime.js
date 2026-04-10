"use strict";

const crypto = require("crypto");
const {
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("../../runtime/topic-normalization-runtime");
const {
  parseSourceIdentity,
} = require("./source-domain-runtime");
const { buildFreshnessKey } = require("../runtime/repeat-freshness-runtime");
const {
  normalizeSourceIdentityKey,
  SOURCE_POLICY_RANKING_EFFECTS,
  normalizeSourcePolicyDomain,
  normalizeSourceTopicToken,
  TIER_OVERRIDE_SCORES,
  TOPIC_FIT_BAND_SCORES,
} = require("../../runtime/source-policy-registry-runtime");
const {
  appendUniqueCode,
  clamp,
  headlineTrigramOverlap,
  jaccard,
  stripHtml,
  tokenSet,
  uniqPreserveOrder,
  uniqSorted,
} = require("./storyline-domain-helpers-runtime");
const {
  HARD_EXCLUDE_FLAGS,
  buildPolicyEffects,
  classifySourceTierBaseline,
  classifySourceTier,
  classifySourceType,
  computeOriginalitySignal,
  computeTopicDomainFit,
  explainSourcePolicy,
  isWeakSourceItem,
  normalizeSourceDomain,
  resolvePreferredSourceMatch,
  setAdminSourceRegistry,
  setPreferredSourceMatcher,
  setPreferredSourceRegistry,
} = require("./storyline-domain-source-quality-runtime");

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
  { flag: "evergreen_trend", pattern: /\b(trends?\s+(every|ceos?|leaders?|executives?|companies)|must.{0,20}(watch|know|prepare)|can't ignore|game.?chang|transform(?:ing|ation)\s+(?:every|your|the)|future of .{3,20}(?:is|looks)|(?:revolution|disruption)\s+(?:is|in)\s+(?:here|coming))\b/i },
  { flag: "thin_listicle", pattern: /\b\d+\s+(?:ways?|things?|tips?|strategies?|reasons?|steps?)\s+(?:to|for|why|every|that)\b/i },
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

const EVENT_MARKER_CONTENT_FLAGS = Object.freeze({
  trial_readout: "evt:trial",
  m_and_a: "evt:deal",
  regulatory: "evt:regulatory",
  earnings: "evt:earnings",
  product_launch: "evt:launch",
  guidance: "evt:guidance",
  investor_relations: "evt:investor",
  conference_recap: "evt:conference",
});

const EVENT_ACTION_RULES = [
  { marker: "evt:deal", pattern: /\b(acquire|acquisition|buyout|merger|sell|sale|takeover|deal)\b/i },
  { marker: "evt:regulatory", pattern: /\b(rule|rules|regulation|regulatory|guidance|proposal|proposed|filing|disclosure|enforcement|deadline)\b/i },
  { marker: "evt:approval", pattern: /\b(approves?|approval|approved|clearance|cleared|authorization)\b/i },
  { marker: "evt:trial", pattern: /\b(phase ii|phase iii|trial|study|readout|clinical data|clinical)\b/i },
  { marker: "evt:earnings", pattern: /\b(earnings|results|quarter|q1|q2|q3|q4)\b/i },
  { marker: "evt:launch", pattern: /\b(launch|rollout|release|introduces?|debut)\b/i },
  { marker: "evt:funding", pattern: /\b(capex|capital expenditure|investment|investing|invests|raises?|funding)\b/i },
  { marker: "evt:partnership", pattern: /\b(partnership|partner(?:s|ed)?|collaboration|alliance)\b/i },
  { marker: "evt:leadership", pattern: /\b(appoint(?:s|ed)?|names?|hire(?:s|d)?|resigns?|steps down|chief financial officer|cfo|chief executive officer|ceo)\b/i },
];

const EVENT_MARKER_STOPWORDS = new Set([
  "about", "across", "after", "amid", "among", "around", "before", "below", "between",
  "beyond", "fresh", "from", "into", "latest", "more", "less", "much", "near", "news",
  "over", "their", "these", "those", "this", "through", "under", "very", "with", "without",
  "would", "could", "should", "report", "reports", "reporting", "says", "said", "faces",
  "face", "proposes", "proposal", "announces", "announced", "company", "companies", "market",
  "markets", "business", "industry", "industries", "giants", "firms", "shareholders", "record",
  "quarterly", "payout", "executives", "leaders", "strategy", "technology", "healthcare",
]);

const EVENT_BIGRAM_BLOCK_TOKENS = new Set([
  "approval", "approves", "approved", "deal", "deals", "disclosure", "earnings", "launch",
  "launches", "guidance", "regulatory", "rule", "rules", "study", "trial", "results", "proposal",
]);

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

function extractAmountMarkers(text) {
  const markers = [];
  const regex = /\b(?:\$|usd\s*)?(\d+(?:\.\d+)?)\s*(trillion|billion|million|bn|mn|b|m|t)\b/gi;
  let match;
  while ((match = regex.exec(String(text || ""))) !== null) {
    const amount = String(match[1] || "").trim();
    const unitRaw = String(match[2] || "").trim().toLowerCase();
    if (!amount || !unitRaw) continue;
    const unit = unitRaw === "trillion" || unitRaw === "t" ? "t"
      : (unitRaw === "billion" || unitRaw === "bn" || unitRaw === "b" ? "b" : "m");
    markers.push(`amt:${amount}${unit}`);
    if (markers.length >= 2) break;
  }
  return uniqPreserveOrder(markers);
}

function extractTimeMarkers(text) {
  const markers = [];
  const years = String(text || "").match(/\b20\d{2}\b/g) || [];
  for (const year of years) {
    markers.push(`year:${year}`);
    if (markers.length >= 2) break;
  }
  const quarters = String(text || "").match(/\bq[1-4]\b/gi) || [];
  for (const quarter of quarters) {
    markers.push(`quarter:${String(quarter).toLowerCase()}`);
    if (markers.length >= 4) break;
  }
  return uniqPreserveOrder(markers);
}

function buildIgnoredEventTokens(entityKeys, storylineHints) {
  const ignored = new Set();
  const primaryEntityKeys = Array.isArray(entityKeys) && entityKeys.length ? [entityKeys[0]] : [];
  for (const rawValue of uniqPreserveOrder([...primaryEntityKeys, ...(storylineHints || [])])) {
    for (const token of normalizeMatchText(rawValue).split(" ").filter(Boolean)) {
      ignored.add(token);
    }
  }
  return ignored;
}

function extractHeadlineBigramMarkers(text, entityKeys = [], storylineHints = []) {
  const ignoredTokens = buildIgnoredEventTokens(entityKeys, storylineHints);
  const tokens = normalizeMatchText(text)
    .split(" ")
    .filter((token) => token.length >= 4)
    .filter((token) => !EVENT_MARKER_STOPWORDS.has(token))
    .filter((token) => !ignoredTokens.has(token));
  const markers = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];
    if (!left || !right || left === right) continue;
    if (EVENT_BIGRAM_BLOCK_TOKENS.has(left) && EVENT_BIGRAM_BLOCK_TOKENS.has(right)) continue;
    markers.push(`lex:${left}_${right}`);
    if (markers.length >= 4) break;
  }
  return uniqPreserveOrder(markers);
}

function buildEventMarkers(item, contentFlags = [], storylineHints = [], entityKeys = []) {
  const text = `${item?.headline || ""} ${item?.summary || ""} ${stripHtml(item?.wim || "")}`;
  const markers = [];
  for (const flag of (Array.isArray(contentFlags) ? contentFlags : [])) {
    const marker = EVENT_MARKER_CONTENT_FLAGS[String(flag || "").trim()];
    if (marker) markers.push(marker);
  }
  for (const hint of (Array.isArray(storylineHints) ? storylineHints : []).slice(0, 3)) {
    if (!hint) continue;
    markers.push(`hint:${hint}`);
  }
  for (const rule of EVENT_ACTION_RULES) {
    if (rule.pattern.test(text)) markers.push(rule.marker);
  }
  markers.push(...extractAmountMarkers(text));
  markers.push(...extractTimeMarkers(text));
  markers.push(...extractHeadlineBigramMarkers(item?.headline || "", entityKeys, storylineHints));
  return uniqPreserveOrder(markers).slice(0, 8);
}

function eventMarkerPriority(marker) {
  const value = String(marker || "").trim();
  if (!value) return 99;
  if (value.startsWith("amt:")) return 0;
  if (value.startsWith("year:") || value.startsWith("quarter:")) return 1;
  if (value.startsWith("hint:")) return 2;
  if (value.startsWith("lex:")) return 3;
  if (value.startsWith("evt:")) return 4;
  return 9;
}

function buildEventFingerprint(item) {
  const entityKeys = uniqPreserveOrder(Array.isArray(item?.entity_keys) ? item.entity_keys : []);
  const tagToken = normalizeTopicToken(item?.tag || "");
  const eventMarkers = uniqPreserveOrder(Array.isArray(item?.event_markers) ? item.event_markers : []);
  const baseKeys = entityKeys.length > 0
    ? entityKeys.slice(0, 1)
    : ((tagToken && !STANDARD_TOPIC_TOKENS.has(tagToken)) ? [tagToken] : []);
  const prioritizedMarkers = eventMarkers
    .slice()
    .sort((left, right) => eventMarkerPriority(left) - eventMarkerPriority(right) || String(left).localeCompare(String(right)))
    .slice(0, 4);
  const components = uniqPreserveOrder([...baseKeys, ...prioritizedMarkers]);
  if (components.length < 3) return "";
  if (baseKeys.length === 0 && prioritizedMarkers.length < 3) return "";
  return components.join("|");
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
  if (flags.has("evergreen_trend")) score += 0.42;
  if (flags.has("thin_listicle")) score += 0.38;
  if (flags.has("conference_recap")) score += 0.46;
  if (flags.has("investor_relations")) score += 0.34;
  if (sourceInfo.source_tier === "suspect") score += 0.24;
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
  if (flags.has("guidance")) bonus -= 0.02;
  if (flags.has("earnings")) bonus -= 0.02;
  if (flags.has("product_launch")) bonus += 0.03;
  if (flags.has("generic_commentary")) bonus -= 0.20;
  if (flags.has("evergreen_trend")) bonus -= 0.12;
  if (flags.has("thin_listicle")) bonus -= 0.10;
  if (flags.has("conference_recap")) bonus -= 0.06;
  if (flags.has("routine_dividend")) bonus -= 0.28;
  if (flags.has("stock_promo")) bonus -= 0.34;

  const text = `${item?.headline || ""} ${item?.summary || ""}`;
  if (/\b(deadline|effective date|enforcement|compliance date|due by|expires?)\b/i.test(text)) bonus += 0.06;
  if (/\b(capex|capital expenditure|\$\d+[BMT]|\d+\s*billion|\d+\s*million\s+investment)\b/i.test(text)) bonus += 0.04;

  const topicFit = Number(sourceInfo?.topic_fit || 0);
  const score = (
    0.59 * promptStrategic
    + 0.24 * baseNorm
    + 0.15 * sourceInfo.source_authority
    + 0.02 * topicFit
    + bonus
    - (routineItemScore * 0.42)
  );
  return clamp(score, 0, 1);
}

function buildStorylineFingerprint(item) {
  const eventFingerprint = buildEventFingerprint(item);
  if (eventFingerprint) return eventFingerprint;
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
    const sourceIdentity = parseSourceIdentity({
      ...item,
    });
    const sourceInfo = classifySourceTier(
      sourceIdentity.source_domain || item?.source_domain || item?.source,
      item?.tag,
      { sourceIdentityKey: sourceIdentity.source_identity_key }
    );
    const preferredSourceMatch = resolvePreferredSourceMatch(
      sourceInfo.source_domain || item?.source_domain || item?.source,
      item?.tag,
      sourceIdentity.source_identity_key
    );
    const originalitySignal = computeOriginalitySignal(item, sourceInfo);
    const storylineHints = buildStorylineHints(item, contentFlags, promptHints);
    const entityKeys = extractEntityKeys(item);
    const eventMarkers = buildEventMarkers(item, contentFlags, storylineHints, entityKeys);
    const eventFingerprint = buildEventFingerprint({
      ...item,
      tag: item?.tag,
      entity_keys: entityKeys,
      event_markers: eventMarkers,
    });
    const routineItemScore = computeRoutineItemScore(contentFlags, sourceInfo);
    const strategicValue = computeStrategicValue(item, sourceInfo, routineItemScore, contentFlags);
    const hardExclude = contentFlags.some((flag) => HARD_EXCLUDE_FLAGS.has(flag));

    return {
      ...item,
      content_flags: contentFlags,
      entity_keys: entityKeys,
      storyline_hints: storylineHints,
      event_markers: eventMarkers,
      event_fingerprint: eventFingerprint || null,
      source_tier: sourceInfo.source_tier,
      source_authority: Number(sourceInfo.source_authority.toFixed(3)),
      baseline_source_tier: sourceInfo.baseline_source_tier || sourceInfo.source_tier,
      baseline_source_authority: Number(
        Number(sourceInfo.baseline_source_authority != null ? sourceInfo.baseline_source_authority : sourceInfo.source_authority).toFixed(3)
      ),
      source_type: sourceInfo.source_type,
      source_policy: sourceInfo.source_policy,
      source_review_status: sourceInfo.review_status,
      originality_profile: sourceInfo.originality_profile,
      source_policy_source: sourceInfo.policy_source || "baseline",
      source_policy_effects: sourceInfo.policy_effects || buildPolicyEffects(sourceInfo.source_policy, sourceInfo.source_type),
      source_hard_block: sourceInfo.hard_block === true,
      source_policy_note: String(sourceInfo?.admin_override?.note || "").trim() || null,
      source_platform: sourceIdentity.source_platform || null,
      source_identity_key: sourceIdentity.source_identity_key || sourceInfo.source_domain || item?.source_domain || "unknown",
      source_identity_scope: sourceIdentity.source_identity_scope || "domain",
      source_identity_label: sourceIdentity.source_identity_label || sourceInfo.source_domain || item?.source_domain || "unknown",
      source_identity_ambiguous: sourceIdentity.source_identity_ambiguous === true,
      topic_fit: Number((sourceInfo.topic_fit || 0).toFixed(3)),
      topic_fit_band: sourceInfo.topic_fit_band || null,
      topic_fit_map: sourceInfo.topic_fit_map || {},
      source_family_domain: sourceInfo.source_family_domain || item?.source_domain || item?.source || null,
      source_inherits_from_domain: sourceInfo.inherits_from_domain || null,
      source_inherits_from_identity: sourceInfo.inherits_from_identity || null,
      preferred_source_match: preferredSourceMatch.match || "none",
      preferred_source_kind: preferredSourceMatch.kind || null,
      preferred_source_match_scope: preferredSourceMatch.scope || "none",
      preferred_source_topics: Array.isArray(preferredSourceMatch.topics) ? preferredSourceMatch.topics : [],
      preferred_source_strength: Number(Number(preferredSourceMatch.strength || 0).toFixed(3)),
      preferred_source_domain: preferredSourceMatch.matched_domain || null,
      preferred_source_identity_key: preferredSourceMatch.matched_identity || null,
      retrieval_search_result_domains: Array.isArray(item?.retrieval_search_result_domains)
        ? item.retrieval_search_result_domains.slice(0, 10)
        : [],
      retrieval_preferred_search_domains: Array.isArray(item?.retrieval_preferred_search_domains)
        ? item.retrieval_preferred_search_domains.slice(0, 10)
        : [],
      preferred_source_available_in_search: item?.preferred_source_available_in_search === true
        && String(preferredSourceMatch.match || "none") === "none",
      originality_signal: Number(originalitySignal.toFixed(3)),
      routine_item_score: Number(routineItemScore.toFixed(3)),
      strategic_value: Number(strategicValue.toFixed(3)),
      hard_exclude: hardExclude || sourceInfo.hard_block === true,
      retrieval_pass: String(item?.retrieval_pass || "").trim() || null,
      suppressed_by_preferred_source: false,
      suppressed_by_derivative_source: false,
      preferred_close_substitute_penalty: 0,
      derivative_competitive_penalty: 0,
      derivative_confidence: 0,
      derivative_reason_codes: [],
      derivative_parent_domain: null,
      derivative_parent_identity_key: null,
      derivative_of_primary: false,
      suppression_reason_codes: [],
      selection_reason_codes: [],
      winner_selection_reason: null,
      specialist_trade_outperformed_preferred: false,
      coverage_gap_status: "no_preferred_signal",
      won_by_preferred_substitute: false,
      storyline_key: buildStorylineFingerprint({
        ...item,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
        event_markers: eventMarkers,
      }),
      freshness_key: buildFreshnessKey({
        ...item,
        tag: item?.tag,
        entity_keys: entityKeys,
        storyline_hints: storylineHints,
        content_flags: contentFlags,
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
  const eventOverlap = jaccard(leftItem?.event_markers || [], rightItem?.event_markers || []);
  const textOverlap = headlineTokenOverlap(leftItem, rightItem);
  const tagRelated = topicsRelated(leftItem?.tag || "", rightItem?.tag || "") ? 1 : 0;
  const exactEventFingerprint = String(leftItem?.event_fingerprint || "").trim()
    && String(leftItem?.event_fingerprint || "").trim() === String(rightItem?.event_fingerprint || "").trim();

  if (exactEventFingerprint && (entityOverlap > 0 || eventOverlap >= 0.34 || tagRelated > 0)) return 0.92;

  if (
    entityOverlap > 0
    && eventOverlap === 0
    && hintOverlap === 0
    && textOverlap < 0.18
  ) {
    return 0;
  }

  if (entityOverlap >= 0.5 && eventOverlap >= 0.34) return 0.88;
  if (entityOverlap >= 0.5 && hintOverlap >= 0.34) return 0.86;
  if (eventOverlap >= 0.45 && (entityOverlap >= 0.25 || tagRelated > 0)) return 0.82;
  if (entityOverlap >= 0.5 && textOverlap >= 0.34) return 0.8;
  if (textOverlap >= 0.52 && (tagRelated > 0 || entityOverlap >= 0.2)) return 0.78;

  const weightedScore = (
    0.3 * entityOverlap
    + 0.22 * eventOverlap
    + 0.2 * hintOverlap
    + 0.18 * textOverlap
    + 0.1 * tagRelated
  );
  const trigramSim = headlineTrigramOverlap(leftItem, rightItem);
  if (trigramSim >= 0.35 && (tagRelated > 0 || eventOverlap >= 0.2)) {
    return Math.min(1, weightedScore + 0.12);
  }
  return weightedScore;
}

function hasPreferredSourceMatch(item) {
  return String(item?.preferred_source_match || "").trim().toLowerCase() !== "none";
}

function isOriginClusterCandidate(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  if (!isGovernanceEligiblePreferredItem(item)) return false;
  return sourceType === "primary_official"
    || sourceType === "reported_media"
    || sourceType === "trade_specialist";
}

function isDerivativeProneCandidate(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceTier = String(item?.source_tier || "").trim().toLowerCase();
  return sourceType === "analysis_blog"
    || sourceType === "aggregator_republisher"
    || sourceType === "corporate_pr"
    || sourceType === "platform_user_generated"
    || sourcePolicy === "limited"
    || sourcePolicy === "review"
    || sourceTier === "weak"
    || sourceTier === "suspect"
    || originalityProfile === "derived_synthesis"
    || originalityProfile === "press_release_repost"
    || originalityProfile === "rewrite_aggregator";
}

function computePreferredRepresentativeBoost(item) {
  if (!isGovernanceEligiblePreferredItem(item)) return 0;
  let boost = Number(item?.preferred_source_strength || 0);
  if (String(item?.preferred_source_match_scope || "").trim().toLowerCase() === "publisher") boost += 0.08;
  else if (String(item?.preferred_source_match_scope || "").trim().toLowerCase() === "domain") boost += 0.03;
  return clamp(boost, 0, 1);
}

function computeRepresentativeScore(item, opts = {}) {
  const ignoreCompetitivePenalties = opts.ignoreCompetitivePenalties === true;
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const preferredBoost = computePreferredRepresentativeBoost(item);
  const primaryBonus = sourceType === "primary_official" ? 0.08 : 0;
  const originBonus = isOriginClusterCandidate(item) ? 0.04 : 0;
  const specialistFitBonus = sourceType === "trade_specialist"
    ? clamp(Number(item?.topic_fit || 0), 0, 1) * 0.07
    : 0;
  const platformAmbiguityPenalty = item?.source_identity_ambiguous === true ? 0.05 : 0;
  const availablePreferredPenalty = item?.preferred_source_available_in_search === true && isWeakClusterCandidate(item)
    ? 0.08
    : 0;
  const competitivePenalty = ignoreCompetitivePenalties
    ? 0
    : (
      Number(item?.preferred_close_substitute_penalty || 0) * 0.4
      + Number(item?.derivative_competitive_penalty || 0) * 0.45
    );

  return (
    Number(item?.strategic_value || 0) * 0.34
    + Number(item?.source_authority || 0) * 0.22
    + clamp(Number(item?.baseScore || 0) / 10, 0, 1) * 0.12
    + (1 - Number(item?.routine_item_score || 0)) * 0.08
    + Number(item?.originality_signal || 0.5) * 0.14
    + Number(item?.topic_fit || 0) * 0.08
    + preferredBoost * 0.09
    + primaryBonus
    + originBonus
    + specialistFitBonus
    - availablePreferredPenalty
    - platformAmbiguityPenalty
    - competitivePenalty
  );
}

function chooseRepresentative(items, opts = {}) {
  const ignoreCompetitivePenalties = opts.ignorePreferredSuppression === true || opts.ignoreCompetitivePenalties === true;
  const ranked = (Array.isArray(items) ? items : []).slice().map((item) => ({
    item,
    score: computeRepresentativeScore(item, { ignoreCompetitivePenalties }),
  })).sort((left, right) => right.score - left.score);
  const winner = ranked[0]?.item || null;
  if (!winner) return null;
  const winnerOfficial = String(winner?.content_kind || "").trim().toLowerCase() !== "article"
    || String(winner?.source_type || "").trim().toLowerCase() === "primary_official";
  if (!winnerOfficial) return winner;
  const reportedAlternative = ranked.find((entry) => {
    if (!entry?.item || entry.item === winner) return false;
    const sourceType = String(entry.item?.source_type || "").trim().toLowerCase();
    const contentKind = String(entry.item?.content_kind || "article").trim().toLowerCase();
    if (contentKind !== "article") return false;
    if (sourceType !== "reported_media" && sourceType !== "trade_specialist") return false;
    if (!isGovernanceEligiblePreferredItem(entry.item)) return false;
    return entry.score >= (ranked[0].score - 0.06);
  });
  return reportedAlternative?.item || winner;
}

function isGovernanceEligiblePreferredItem(item) {
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  return sourcePolicy === "allowed" || sourcePolicy === "preferred";
}

function isWeakClusterCandidate(item) {
  const sourcePolicy = String(item?.source_policy || "").trim().toLowerCase();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const sourceTier = String(item?.source_tier || "").trim().toLowerCase();
  return sourcePolicy === "limited"
    || sourcePolicy === "review"
    || sourceType === "aggregator_republisher"
    || sourceType === "corporate_pr"
    || sourceType === "platform_user_generated"
    || sourceTier === "weak"
    || sourceTier === "suspect";
}

function isStrongPreferredClusterCandidate(item) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const preferredStrength = Number(item?.preferred_source_strength || 0);
  return isGovernanceEligiblePreferredItem(item) && (
    preferredStrength >= 0.38
    || sourceType === "primary_official"
    || (sourceType === "reported_media" && String(item?.source_policy || "").trim().toLowerCase() === "preferred")
  );
}

function canTradeSpecialistOutperformPreferred(candidate, preferredCandidate) {
  if (String(candidate?.source_type || "").trim().toLowerCase() !== "trade_specialist") return false;
  if (!isGovernanceEligiblePreferredItem(candidate)) return false;
  const candidateTopicFit = Number(candidate?.topic_fit || 0);
  const preferredTopicFit = Number(preferredCandidate?.topic_fit || 0);
  const candidateAuthority = Number(candidate?.source_authority || 0);
  const preferredAuthority = Number(preferredCandidate?.source_authority || 0);
  return candidateTopicFit >= (preferredTopicFit + 0.18)
    && candidateAuthority >= (preferredAuthority - 0.08);
}

function findBestComparableOriginCandidate(item, originCandidates = []) {
  let bestOrigin = null;
  let bestSimilarity = 0;
  for (const candidate of (Array.isArray(originCandidates) ? originCandidates : [])) {
    if (!candidate || candidate === item) continue;
    const similarity = storylineSimilarity(item, candidate);
    if (similarity < 0.58) continue;
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestOrigin = candidate;
    }
  }
  return {
    bestOrigin,
    similarity: bestSimilarity,
  };
}

function estimateDerivativeCompetition(item, originCandidate, similarity) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const reasonCodes = [];
  let confidence = 0;

  if (!originCandidate || !isDerivativeProneCandidate(item)) {
    return {
      confidence: 0,
      penalty: 0,
      reasonCodes,
    };
  }

  if (sourceType === "aggregator_republisher" || sourceType === "corporate_pr" || sourceType === "platform_user_generated") {
    confidence += 0.34;
    reasonCodes.push("derivative_source_type");
  } else if (sourceType === "analysis_blog") {
    confidence += 0.18;
    reasonCodes.push("derived_analysis");
  }

  if (originalityProfile === "rewrite_aggregator" || originalityProfile === "press_release_repost") {
    confidence += 0.24;
    reasonCodes.push("low_originality_profile");
  } else if (originalityProfile === "derived_synthesis") {
    confidence += 0.12;
    reasonCodes.push("derived_synthesis_profile");
  }

  if (similarity >= 0.72) {
    confidence += 0.22;
    reasonCodes.push("close_story_overlap");
  } else if (similarity >= 0.58) {
    confidence += 0.12;
    reasonCodes.push("story_overlap");
  }

  const exactEventFingerprint = String(item?.event_fingerprint || "").trim()
    && String(item?.event_fingerprint || "").trim() === String(originCandidate?.event_fingerprint || "").trim();
  const eventOverlap = jaccard(item?.event_markers || [], originCandidate?.event_markers || []);
  if (exactEventFingerprint) {
    confidence += 0.18;
    reasonCodes.push("exact_event_fingerprint");
  } else if (eventOverlap >= 0.42) {
    confidence += 0.1;
    reasonCodes.push("event_marker_overlap");
  }

  if (Number(originCandidate?.originality_signal || 0) >= Number(item?.originality_signal || 0) + 0.12) {
    confidence += 0.12;
    reasonCodes.push("weaker_than_original");
  }

  if (item?.preferred_source_available_in_search === true && !hasPreferredSourceMatch(item)) {
    confidence += 0.08;
    reasonCodes.push("preferred_search_evidence");
  }

  let penalty = 0;
  if (confidence >= 0.62) penalty = 0.22;
  else if (confidence >= 0.45) penalty = 0.15;
  else if (confidence >= 0.32 && isWeakClusterCandidate(item)) penalty = 0.08;

  return {
    confidence: Number(clamp(confidence, 0, 1).toFixed(3)),
    penalty: Number(clamp(penalty, 0, 0.4).toFixed(3)),
    reasonCodes,
  };
}

function applyPreferredCloseSubstituteSuppression(cluster) {
  if (!cluster || !Array.isArray(cluster.items) || cluster.items.length < 2) {
    return {
      derivative_suppressed_count: 0,
      preferred_suppressed_count: 0,
      platform_identity_ambiguity_count: 0,
      preferred_candidate_count: 0,
      preferred_signal_present: false,
    };
  }
  const preferredCandidates = cluster.items.filter((item) => isStrongPreferredClusterCandidate(item));
  const originCandidates = cluster.items.filter((item) => isOriginClusterCandidate(item));
  const preferredSignalPresent = preferredCandidates.length > 0
    || cluster.items.some((item) => item?.preferred_source_available_in_search === true);

  for (const item of cluster.items) {
    item.preferred_close_substitute_penalty = 0;
    item.suppressed_by_preferred_source = false;
    item.preferred_substitute_domain = null;
    item.derivative_competitive_penalty = 0;
    item.derivative_confidence = 0;
    item.suppressed_by_derivative_source = false;
    item.derivative_reason_codes = [];
    item.derivative_parent_domain = null;
    item.derivative_parent_identity_key = null;
    item.derivative_of_primary = false;
    item.suppression_reason_codes = [];
    item.selection_reason_codes = Array.isArray(item.selection_reason_codes) ? item.selection_reason_codes : [];
  }

  const derivativeSuppressedItems = new Set();
  const preferredSuppressedItems = new Set();

  for (const item of cluster.items) {
    const { bestOrigin, similarity } = findBestComparableOriginCandidate(item, originCandidates);
    if (!bestOrigin || bestOrigin === item) continue;
    const derivative = estimateDerivativeCompetition(item, bestOrigin, similarity);
    if (derivative.penalty <= 0) continue;
    item.derivative_competitive_penalty = derivative.penalty;
    item.derivative_confidence = derivative.confidence;
    item.derivative_reason_codes = derivative.reasonCodes.slice();
    item.derivative_parent_domain = String(bestOrigin?.source_domain || bestOrigin?.source || "").trim() || null;
    item.derivative_parent_identity_key = String(bestOrigin?.source_identity_key || "").trim() || item.derivative_parent_domain;
    item.suppressed_by_derivative_source = true;
    item.derivative_of_primary = true;
    item.suppression_reason_codes = appendUniqueCode(item.suppression_reason_codes, "derivative_source_suppressed");
    for (const reasonCode of derivative.reasonCodes) {
      item.suppression_reason_codes = appendUniqueCode(item.suppression_reason_codes, reasonCode);
    }
    derivativeSuppressedItems.add(item);
  }

  for (const weakItem of cluster.items) {
    if (!isWeakClusterCandidate(weakItem)) continue;
    let bestPreferred = null;
    let bestSimilarity = 0;
    for (const preferredCandidate of preferredCandidates) {
      if (preferredCandidate === weakItem) continue;
      const similarity = storylineSimilarity(weakItem, preferredCandidate);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestPreferred = preferredCandidate;
      }
    }
    if (!bestPreferred || bestSimilarity < 0.62) continue;
    if (canTradeSpecialistOutperformPreferred(weakItem, bestPreferred)) continue;
    weakItem.preferred_close_substitute_penalty = Number(Math.max(
      weakItem.preferred_close_substitute_penalty || 0,
      bestSimilarity >= 0.75 ? 0.24 : 0.18
    ).toFixed(3));
    weakItem.suppressed_by_preferred_source = true;
    weakItem.preferred_substitute_domain = String(bestPreferred?.source_domain || bestPreferred?.source || "").trim() || null;
    weakItem.suppression_reason_codes = appendUniqueCode(weakItem.suppression_reason_codes, "preferred_close_substitute");
    weakItem.suppression_reason_codes = appendUniqueCode(
      weakItem.suppression_reason_codes,
      String(bestPreferred?.preferred_source_match_scope || "").trim().toLowerCase() === "publisher"
        ? "preferred_publisher_available"
        : "preferred_domain_available"
    );
    preferredSuppressedItems.add(weakItem);
  }

  return {
    derivative_suppressed_count: derivativeSuppressedItems.size,
    preferred_suppressed_count: preferredSuppressedItems.size,
    platform_identity_ambiguity_count: cluster.items.filter((item) => item?.source_identity_ambiguous === true).length,
    preferred_candidate_count: preferredCandidates.length,
    preferred_signal_present: preferredSignalPresent,
  };
}

function annotateClusterOutcome(cluster, baselineRepresentative, representative, competitionStats = {}) {
  if (!cluster || !representative) return {
    coverage_gap_status: "no_preferred_signal",
    specialist_trade_beat_preferred: false,
    broader_retrieval_found_better: false,
  };

  const strongPreferredAlternatives = cluster.items.filter((item) => item !== representative && isStrongPreferredClusterCandidate(item));
  const sharedEventFingerprint = cluster.items.some((item) => {
    if (!item || item === representative) return false;
    const exactFingerprint = String(representative?.event_fingerprint || "").trim()
      && String(item?.event_fingerprint || "").trim() === String(representative?.event_fingerprint || "").trim();
    if (exactFingerprint) return true;
    const eventOverlap = jaccard(representative?.event_markers || [], item?.event_markers || []);
    const entityOverlap = jaccard(representative?.entity_keys || [], item?.entity_keys || []);
    const tagRelated = topicsRelated(representative?.tag || "", item?.tag || "");
    return eventOverlap >= 0.42 && (entityOverlap > 0 || tagRelated);
  });
  const specialistTradeBeatPreferred = String(representative?.source_type || "").trim().toLowerCase() === "trade_specialist"
    && strongPreferredAlternatives.some((candidate) => canTradeSpecialistOutperformPreferred(representative, candidate));
  const hasPreferredSignal = competitionStats.preferred_signal_present === true;
  const preferredWinner = isStrongPreferredClusterCandidate(representative) || String(representative?.source_type || "").trim().toLowerCase() === "primary_official";
  const broaderRetrievalFoundBetter = String(representative?.retrieval_pass || "").trim().toLowerCase() === "broad"
    && hasPreferredSignal
    && !preferredWinner;

  let coverageGapStatus = "no_preferred_signal";
  if (preferredWinner) coverageGapStatus = "preferred_exists_and_should_win";
  else if (specialistTradeBeatPreferred) coverageGapStatus = "preferred_exists_but_weaker";
  else if (broaderRetrievalFoundBetter) coverageGapStatus = "preferred_missing";
  else if (hasPreferredSignal) coverageGapStatus = "preferred_exists_but_weaker";

  representative.coverage_gap_status = coverageGapStatus;
  representative.specialist_trade_outperformed_preferred = specialistTradeBeatPreferred;

  if (String(representative?.source_type || "").trim().toLowerCase() === "primary_official") {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "official_primary");
  }
  if (String(representative?.preferred_source_match_scope || "").trim().toLowerCase() === "publisher") {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "preferred_publisher_match");
  } else if (hasPreferredSourceMatch(representative)) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "preferred_domain_match");
  }
  if (specialistTradeBeatPreferred) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "specialist_trade_best_fit");
  }
  if (competitionStats.derivative_suppressed_count > 0) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "best_source_representation");
  }
  if (sharedEventFingerprint) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "canonical_event_match");
  }
  if (baselineRepresentative && baselineRepresentative !== representative) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "displaced_weaker_substitute");
  }
  if (broaderRetrievalFoundBetter) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "broad_fallback_better_source");
  }
  if (Number(representative?.derivative_confidence || 0) >= 0.35) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "best_available_derivative");
  } else if (Number(representative?.originality_signal || 0) >= 0.82) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "high_originality");
  }
  if (representative?.source_identity_ambiguous === true) {
    representative.selection_reason_codes = appendUniqueCode(representative.selection_reason_codes, "platform_identity_ambiguous");
  }

  representative.winner_selection_reason = representative.selection_reason_codes[0] || "best_source_representation";
  return {
    coverage_gap_status: coverageGapStatus,
    specialist_trade_beat_preferred: specialistTradeBeatPreferred,
    broader_retrieval_found_better: broaderRetrievalFoundBetter,
  };
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
      if (similarity >= 0.46 && similarity > bestScore) {
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
    const competitionStats = applyPreferredCloseSubstituteSuppression(cluster);
    const baselineRepresentative = chooseRepresentative(cluster.items, { ignoreCompetitivePenalties: true });
    const representative = chooseRepresentative(cluster.items);
    const outcome = annotateClusterOutcome(cluster, baselineRepresentative, representative, competitionStats);
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
      preferred_displaced_weak: baselineRepresentative
        && representative
        && baselineRepresentative !== representative
        && isWeakClusterCandidate(baselineRepresentative)
        && isStrongPreferredClusterCandidate(representative),
      derivative_suppressed_count: Number(competitionStats.derivative_suppressed_count || 0),
      preferred_suppressed_count: Number(competitionStats.preferred_suppressed_count || 0),
      preferred_candidate_count: Number(competitionStats.preferred_candidate_count || 0),
      platform_identity_ambiguity_count: Number(competitionStats.platform_identity_ambiguity_count || 0),
      coverage_gap_status: outcome.coverage_gap_status,
      specialist_trade_beat_preferred: outcome.specialist_trade_beat_preferred === true,
      broader_retrieval_found_better: outcome.broader_retrieval_found_better === true,
      items: cluster.items,
    };
  });
}

function computeSupportingSourcesAvgAuthority(supportingSources) {
  const sources = Array.isArray(supportingSources) ? supportingSources.filter(Boolean) : [];
  if (sources.length === 0) return 0.5;
  const total = sources.reduce((sum, domain) => {
    const info = classifySourceTier(domain);
    return sum + info.source_authority;
  }, 0);
  return total / sources.length;
}

function buildStorylineCandidates(items = []) {
  return clusterStorylines(items).map((cluster) => {
    const avgAuthority = computeSupportingSourcesAvgAuthority(cluster.supporting_sources);
    return {
      ...(cluster.representative || {}),
      storyline_id: cluster.storyline_id,
      storyline_size: cluster.storyline_size,
      supporting_sources: cluster.supporting_sources,
      supporting_headlines: cluster.supporting_headlines,
      cross_source_count: cluster.cross_source_count,
      supporting_sources_avg_authority: Number(avgAuthority.toFixed(3)),
      entity_keys: cluster.entity_keys,
      storyline_hints: cluster.storyline_hints,
      cluster_confidence: cluster.cluster_confidence,
      storyline_strategic_value: cluster.strategic_value,
      won_by_preferred_substitute: cluster.preferred_displaced_weak === true,
      cluster_derivative_suppressed_count: Number(cluster.derivative_suppressed_count || 0),
      cluster_preferred_suppressed_count: Number(cluster.preferred_suppressed_count || 0),
      cluster_preferred_candidate_count: Number(cluster.preferred_candidate_count || 0),
      cluster_platform_identity_ambiguity_count: Number(cluster.platform_identity_ambiguity_count || 0),
      coverage_gap_status: cluster.coverage_gap_status || cluster.representative?.coverage_gap_status || "no_preferred_signal",
      specialist_trade_outperformed_preferred: cluster.specialist_trade_beat_preferred === true
        || (cluster.representative?.specialist_trade_outperformed_preferred === true),
      broader_retrieval_found_better: cluster.broader_retrieval_found_better === true,
      storyline_key: buildStorylineFingerprint({
        ...(cluster.representative || {}),
        entity_keys: cluster.entity_keys,
        storyline_hints: cluster.storyline_hints,
      }),
      freshness_key: buildFreshnessKey({
        ...(cluster.representative || {}),
        entity_keys: cluster.entity_keys,
        storyline_hints: cluster.storyline_hints,
        content_flags: Array.isArray(cluster.representative?.content_flags) ? cluster.representative.content_flags : [],
      }),
    };
  });
}

function applyStrategicQualityGate(items = [], opts = {}) {
  const candidates = Array.isArray(items) ? items : [];
  if (!candidates.length) return [];

  const minStrategicValue = clamp(opts.minStrategicValue != null ? opts.minStrategicValue : 0.34, 0, 1);
  const maxRoutineScore = clamp(opts.maxRoutineScore != null ? opts.maxRoutineScore : 0.65, 0, 1);
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
  classifySourceTierBaseline,
  classifySourceTier,
  classifySourceType,
  clusterStorylines,
  computeOriginalitySignal,
  computeStrategicValue,
  computeTopicDomainFit,
  detectLocalContentFlags,
  explainSourcePolicy,
  extractEntityKeys,
  isWeakSourceItem,
  normalizeSourceDomain,
  setAdminSourceRegistry,
  setPreferredSourceMatcher,
  setPreferredSourceRegistry,
  storylineSimilarity,
};
