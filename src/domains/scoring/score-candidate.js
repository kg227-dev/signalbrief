"use strict";

/**
 * SignalBrief MVP — Per-item candidate scoring formula.
 *
 * Formula (spec §2.4):
 *   score = (freshness × 0.35) + (source_tier × 0.35) + (lane_bonus × 0.15) + (novelty × 0.15)
 *
 * Every component is [0,1]. Final score is [0,1].
 * All components are preserved on the candidate so the operator can inspect
 * exactly why any item scored what it did.
 *
 * Weights and per-tier/lane values are configurable via scoringConfig.
 * Defaults match the spec exactly.
 */

const DEFAULT_WEIGHTS = Object.freeze({
  freshness: 0.35,
  source_tier: 0.35,
  lane_bonus: 0.15,
  novelty: 0.15,
});

// Tier scores: 1=gold, 2=good, 3=supplemental, unknown=0.2
const DEFAULT_TIER_SCORES = Object.freeze({
  1: 1.0,
  2: 0.7,
  3: 0.4,
  unknown: 0.2,
});

// Lane bonuses per retrieval origin
const DEFAULT_LANE_BONUSES = Object.freeze({
  // RSS / direct publisher feeds
  publisher_feed: 0.8,
  broker_publisher_feed: 0.8,
  rss: 0.8,
  // Official / regulatory sources
  official: 1.0,
  broker_official: 1.0,
  // AI discovery / Perplexity
  discovery: 0.3,
  perplexity_discovery: 0.3,
  preferred: 0.6,
  broad: 0.3,
});

const DEFAULT_SELECTOR_PENALTIES = Object.freeze({
  proceduralGovDomainPenalty: -0.08,
  topicDomainPenalties: Object.freeze({
    INDUSTRIALS: Object.freeze({
      "freightwaves.com": -0.18,
      "areadevelopment.com": -0.18,
    }),
  }),
});

const DEFAULT_FINAL_RANK_WEIGHTS = Object.freeze({
  strategic_value: 0.35,
  story_quality: 0.30,
  source_authority: 0.15,
  freshness: 0.10,
  novelty: 0.10,
});

// Freshness: how many hours to treat as max age.
// Items at 0h score 1.0; items at maxAgeHours score 0.05 (not 0 — they're still eligible).
const DEFAULT_MAX_AGE_HOURS = 48;
const FRESHNESS_FLOOR = 0.05;
const OFFICIAL_FILLER_PATTERN = /\b(frequently requested|what'?s new|drug safety communication|recall|warns consumers|alerts customers|consumer update|fact sheet|guidance for industry|companies that have not submitted|drug amount reports|shortage mitigation efforts|proactively posted|final rule|proposed rule|podcast(?:s)?|things? to know|how you can find|user fee amendments?|labeling resources?|facilities?, sites? and organization|drug safety and availability|notice of (?:public )?meeting|advisory committee meeting|meeting goals summary|information collection activit(?:y|ies)|order establishing|operating limitations|scheduling limits|fda-track)\b/i;
const COMMENTARY_PATTERN = /(^|[\s"“])opinion:|\b(commentary|analysis|feature)\b|\b(watch now|best noise-canceling|readers are buying|spring sale|get ready with me|music video|excerpt from|reporter goes up against)\b/i;
const TECH_NOISE_PATTERN = /\b(earbuds?|shopping|sale|coupon|music video|camera test|review roundup|best .{0,30}\b|vision pro|steam link|offline dictation|dictation app|continuous glucose|glucose monitor|vibe coding|rooting for|blaming everything|users are mastering|social app|creator culture|meme)\b/i;
const TECH_STRATEGIC_PATTERN = /\b(ai security|cybersecurity|ransomware|data breach|platform policy|antitrust|supreme court|scotus|isp|piracy|chip|semiconductor|compute|data centers?|capital allocation|funding round|venture fund|ai infrastructure|open[- ]source model|enterprise ai|procurement|model safety|frontier model|regulator|regulation)\b/i;
const TECH_FALSE_POSITIVE_PATTERN = /\b(surgeon|liver|spleen|patient|medical examiner|charged with killing|hospital worker|autopsy)\b/i;
const ENERGY_FALSE_POSITIVE_PATTERN = /\b(dark energy|3d map of universe|universe|cosmolog(?:y|ists?)|astronom(?:y|ers?)|galax(?:y|ies)|cosmic)\b/i;
const INDUSTRIALS_FALSE_POSITIVE_PATTERN = /\b(drug supply chain security act|pharma|pharmaceutical|biotech|peptide|drug compounding|advisory committee)\b/i;
const PROCEDURAL_NOTICE_PATTERN = /\b(notice of|combined notice|notice announcing|informal settlement conference|guidance documents published|federal register|notice of filing|notice of conference|meeting notice|availability of guidance|guidance for industry|filing(?:s)? received|order establishing|information collection activit(?:y|ies)|meeting goals summary|operating limitations)\b/i;
const STRATEGIC_SHIFT_PATTERN = /\b(enforcement|penalt(?:y|ies)|deadline|effective date|timeline|within \d+ (?:days|weeks|months)|cost|costs|margin|margins|capex|pricing|price|rate increase|fee|fees|competition|competitive|market share|buyer leverage|seller leverage|capacity|throughput|supply|demand|tariff|capital|procurement)\b/i;
const GOV_NOTICE_DOMAIN_PATTERN = /\b(federalregister\.gov|ferc\.gov|fda\.gov|sec\.gov|cms\.gov|justice\.gov)\b/i;
const GENERIC_FORMAL_HEADLINE_PATTERN = /^(notice|agency|office|board|commission|department|order establishing|information collection activities|operating limitations|city of|scout v)\b/i;
const STRATEGIC_ACTION_PATTERN = /\b(acquires?|acquisition|merger|buyout|launch(?:es|ed)?|approval|approved|wins?|won|signs?|signed|invest(?:s|ed|ment)|funding|raises?|cuts?|layoffs?|contracts?|partnership|partners?|pricing|repric(?:e|es|ed|ing)|shut(?:s|ting)? down|expand(?:s|ed|ing)|restart(?:s|ed)?|settlement|enforcement action|penalt(?:y|ies)|tariff|block(?:s|ed)?|ban(?:s|ned)?|orders?|mandates?)\b/i;
const NON_STRATEGIC_OFFICIAL_ACTION_PATTERN = /\b(notice|request|meeting|filing|summary|agenda|hearing|comment(?:s)?|collection|information collection|order establishing|soliciting|intervention deadline|conference)\b/i;
const TECHNOLOGY_DEAL_NOISE_PATTERN = /\b(airpods?|best-ever price|sale|discount|deal\b|shopping|coupon|doorbell|earbuds?|tinder)\b/i;
const ENERGY_TOPIC_ANCHOR_PATTERN = /\b(utility|grid|power|electricity|gas|oil|solar|wind|nuclear|ppa|interconnection|transmission|pipeline|lng|rate hike|permitting|reactor|battery storage|renewable)\b/i;
const ENERGY_OFF_TOPIC_PATTERN = /\b(immigration|dhs|palantir|surveillance|dating|tinder|airpods?|smartphone|headset|tax holiday)\b/i;
const ACTION_FLAG_ALLOWLIST = new Set([
  "m_and_a",
  "trial_readout",
  "earnings",
  "product_launch",
  "guidance",
]);

function clamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function resolveScoringConfig(config = {}) {
  const weights = config.weights && typeof config.weights === "object" ? config.weights : {};
  const tierScores = config.tierScores && typeof config.tierScores === "object" ? config.tierScores : {};
  const laneBonuses = config.laneBonuses && typeof config.laneBonuses === "object" ? config.laneBonuses : {};
  return {
    weights: {
      freshness: Number(weights.freshness ?? DEFAULT_WEIGHTS.freshness),
      source_tier: Number(weights.source_tier ?? DEFAULT_WEIGHTS.source_tier),
      lane_bonus: Number(weights.lane_bonus ?? DEFAULT_WEIGHTS.lane_bonus),
      novelty: Number(weights.novelty ?? DEFAULT_WEIGHTS.novelty),
    },
    tierScores: { ...DEFAULT_TIER_SCORES, ...tierScores },
    laneBonuses: { ...DEFAULT_LANE_BONUSES, ...laneBonuses },
    maxAgeHours: Number(config.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS),
    officialLaneBonusCap: config.officialLaneBonusCap === true,
    corporatePrPenalty: config.corporatePrPenalty === true,
    selectorPenalties: {
      proceduralGovDomainPenalty: Number(
        config?.selectorPenalties?.proceduralGovDomainPenalty
          ?? DEFAULT_SELECTOR_PENALTIES.proceduralGovDomainPenalty
      ),
      topicDomainPenalties: {
        ...DEFAULT_SELECTOR_PENALTIES.topicDomainPenalties,
        ...(config?.selectorPenalties?.topicDomainPenalties && typeof config.selectorPenalties.topicDomainPenalties === "object"
          ? config.selectorPenalties.topicDomainPenalties
          : {}),
      },
    },
  };
}

/**
 * Compute freshness score [0,1].
 * Items published within the last hour get 1.0.
 * Linear decay to FRESHNESS_FLOOR at maxAgeHours.
 * Items older than maxAgeHours get 0.
 * Items with no parseable published_date get 0.
 */
function computeFreshnessScore(item, nowMs, maxAgeHours) {
  const pubRaw = String(item?.published_date || item?.publishedDate || "").trim();
  if (!pubRaw) return 0;
  const pubMs = Date.parse(pubRaw);
  if (!Number.isFinite(pubMs)) return 0;
  const ageHours = (nowMs - pubMs) / (60 * 60 * 1000);
  if (ageHours > maxAgeHours) return 0;
  if (ageHours <= 0) return 1.0;
  // Linear decay from 1.0 at 0h to FRESHNESS_FLOOR at maxAgeHours
  const raw = 1.0 - ((1.0 - FRESHNESS_FLOOR) * ageHours) / maxAgeHours;
  return clamp(raw, 0, 1);
}

/**
 * Compute source tier score [0,1].
 * Uses the numeric tier field from the source registry (1/2/3).
 * Falls back to source_authority float if tier is missing.
 */
function computeSourceTierScore(item, tierScores) {
  const tierRaw = item?.source_tier;
  const tierNum = Number(tierRaw);
  if (tierNum === 1 || tierNum === 2 || tierNum === 3) {
    return Number(tierScores[tierNum] ?? DEFAULT_TIER_SCORES[tierNum] ?? 0.4);
  }
  // Legacy: source_authority is a float [0,1] — use directly if present
  const authority = Number(item?.source_authority);
  if (Number.isFinite(authority) && authority > 0) {
    return clamp(authority, 0, 1);
  }
  return Number(tierScores.unknown ?? DEFAULT_TIER_SCORES.unknown);
}

/**
 * Compute lane bonus [0,1].
 * Uses retrieval_origin or retrieval_lane to identify the lane.
 * RSS/direct feeds > official > discovery.
 */
function computeLaneBonusScore(item, laneBonuses, opts = {}) {
  const origin = String(item?.retrieval_origin || "").trim().toLowerCase();
  const lane = String(item?.retrieval_lane || item?.retrieval_pass || "").trim().toLowerCase();
  const isPrimaryOfficial = opts.officialLaneBonusCap === true
    && String(item?.source_type || "").trim().toLowerCase() === "primary_official";

  const resolveOfficialBonus = () => isPrimaryOfficial
    ? Number(laneBonuses.preferred ?? DEFAULT_LANE_BONUSES.preferred)
    : Number(laneBonuses.official ?? DEFAULT_LANE_BONUSES.official);

  // Try exact match on origin first
  if (origin && origin in laneBonuses) {
    if (origin === "official" || origin === "broker_official") return resolveOfficialBonus();
    return Number(laneBonuses[origin]);
  }

  // Normalize: any broker publisher feed
  if (origin.includes("broker_publisher") || lane.includes("publisher_feed")) {
    return Number(laneBonuses.publisher_feed ?? DEFAULT_LANE_BONUSES.publisher_feed);
  }
  if (origin.includes("broker_official") || lane.includes("official")) return resolveOfficialBonus();
  if (origin.includes("discovery") || lane.includes("discovery") || lane.includes("perplexity")) {
    return Number(laneBonuses.discovery ?? DEFAULT_LANE_BONUSES.discovery);
  }
  if (lane.includes("preferred")) {
    return Number(laneBonuses.preferred ?? DEFAULT_LANE_BONUSES.preferred);
  }

  // Try lane key directly
  if (lane && lane in laneBonuses) return Number(laneBonuses[lane]);

  // Unknown lane — treat as discovery
  return Number(laneBonuses.discovery ?? DEFAULT_LANE_BONUSES.discovery);
}

/**
 * Compute novelty score [0,1].
 * A candidate's novelty reflects how distinct it is from recently seen storylines.
 *
 * noveltyScore is provided externally by the repeat/history system as a pre-computed
 * value [0,1] on the candidate (item.novelty_score). If not present, falls back to
 * heuristics:
 *   - Item previously seen in cross-day dedup → 0.1
 *   - Item flagged as repeat storyline → 0.2
 *   - Item with no cross-day history signals → 0.8 (assume novel)
 *
 * The novelty component intentionally does NOT exclude items — it just deprioritizes
 * near-repeats. Exclusion happens upstream in dedup/history filters.
 */
function computeNoveltyScore(item) {
  // If the repeat/scoring pipeline has already attached a novelty_score, use it.
  const precomputed = Number(item?.novelty_score);
  if (Number.isFinite(precomputed) && precomputed >= 0 && precomputed <= 1) {
    return precomputed;
  }

  // Heuristic fallback based on repeat flags
  if (item?.is_cross_day_repeat === true) return 0.1;
  if (item?.is_storyline_repeat === true) return 0.2;
  if (item?.repeat_penalty && Number(item.repeat_penalty) < 0.5) return 0.3;

  // No repeat signal — assume novel
  return 0.8;
}

function normalizeTopicFitScore(item) {
  const raw = Number(item?.topic_fit);
  if (!Number.isFinite(raw)) return 0.5;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return clamp(raw / 100, 0, 1);
  return clamp(raw, 0, 1);
}

function normalizeCrossSourceSupport(item) {
  const crossSourceCount = Number(item?.cross_source_count || item?.storyline_size || 0);
  if (!Number.isFinite(crossSourceCount) || crossSourceCount <= 1) return 0;
  return clamp((crossSourceCount - 1) / 3, 0, 1);
}

function normalizeSourceAuthorityScore(item, tierScores = DEFAULT_TIER_SCORES) {
  const authority = Number(item?.source_authority);
  if (Number.isFinite(authority) && authority >= 0) return clamp(authority, 0, 1);
  return computeSourceTierScore(item, tierScores);
}

function classifyActorActionSignals(item) {
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const combined = `${headline} ${summary}`.trim();
  const entityKeys = Array.isArray(item?.entity_keys) ? item.entity_keys.filter(Boolean) : [];
  const contentFlags = Array.isArray(item?.content_flags)
    ? item.content_flags.map((flag) => String(flag || "").trim().toLowerCase())
    : [];
  const eventMarkers = Array.isArray(item?.event_markers)
    ? item.event_markers.map((marker) => String(marker || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const actorClarity = entityKeys.length > 0
    ? 1
    : (!GENERIC_FORMAL_HEADLINE_PATTERN.test(headline)
        && /\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3}|FDA|SEC|FTC|DOJ|CMS|EPA|FERC|OCC|CFPB|Fed|Federal Reserve)\b/.test(headline))
      ? 0.7
      : 0;
  const actionSignal = contentFlags.some((flag) => ACTION_FLAG_ALLOWLIST.has(flag))
    || eventMarkers.length > 0
    || (STRATEGIC_ACTION_PATTERN.test(combined) && !NON_STRATEGIC_OFFICIAL_ACTION_PATTERN.test(combined));
  const mechanismSignal = STRATEGIC_SHIFT_PATTERN.test(combined)
    || /\b(unit economics|reprice|repricing|margin|pricing|throughput|capacity|capital allocation|buyer leverage|seller leverage|procurement|reimbursement|interest margin|compliance cost|cost of capital)\b/i.test(combined);
  return {
    actorClarity: actorClarity > 0 ? 1 : 0,
    actionClarity: actionSignal ? 1 : 0,
    mechanismPresence: mechanismSignal ? 1 : 0,
  };
}

function computeStoryQualityScore(item, context = {}) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const contentFlags = Array.isArray(item?.content_flags)
    ? item.content_flags.map((flag) => String(flag || "").trim().toLowerCase())
    : [];
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const combined = `${headline} ${summary}`.trim();
  const originalitySignal = Number.isFinite(Number(item?.originality_signal))
    ? clamp(Number(item.originality_signal), 0, 1)
    : (originalityProfile === "rewrite_aggregator" || originalityProfile === "press_release_repost")
      ? 0.15
      : (originalityProfile === "derived_synthesis" ? 0.35 : 0.6);
  const corroboration = normalizeCrossSourceSupport(item);
  const routineItemScore = Number.isFinite(Number(item?.routine_item_score))
    ? clamp(Number(item.routine_item_score), 0, 1)
    : 0;
  const proceduralNoticeAssessment = context.proceduralNoticeAssessment || classifyProceduralNotice(item);
  const actorActionSignals = classifyActorActionSignals(item);
  const commentaryLike = sourceType === "analysis_blog"
    || originalityProfile === "derived_synthesis"
    || contentFlags.includes("generic_commentary")
    || COMMENTARY_PATTERN.test(combined);

  const actorClarity = actorActionSignals.actorClarity ? 0.20 : 0;
  const actionClarity = actorActionSignals.actionClarity ? 0.20 : 0;
  const mechanism = actorActionSignals.mechanismPresence ? 0.20 : 0;
  let specificity = 0.20;
  if (commentaryLike) specificity -= 0.10;
  if (contentFlags.includes("generic_commentary")) specificity -= 0.06;
  if (proceduralNoticeAssessment.proceduralNotice) specificity -= proceduralNoticeAssessment.hasStrategicShift ? 0.04 : 0.12;
  specificity -= routineItemScore * 0.12;
  if (OFFICIAL_FILLER_PATTERN.test(combined)) specificity -= 0.08;
  specificity = clamp(specificity, 0, 0.20);

  let originalityAndCorroboration = clamp(
    (originalitySignal * 0.14) + (corroboration * 0.06),
    0,
    0.20
  );
  if (sourceType === "trade_specialist") {
    originalityAndCorroboration = clamp(
      originalityAndCorroboration + (normalizeTopicFitScore(item) * 0.04),
      0,
      0.20
    );
  }
  if (sourceType === "aggregator_republisher" || sourceType === "platform_user_generated") {
    originalityAndCorroboration = clamp(originalityAndCorroboration - 0.06, 0, 0.20);
  }

  const isNonStrategicProceduralOfficial = sourceType === "primary_official"
    && proceduralNoticeAssessment.proceduralNotice === true
    && proceduralNoticeAssessment.hasStrategicShift !== true;
  let adjustedActionClarity = actionClarity;
  let adjustedMechanism = mechanism;
  let adjustedSpecificity = specificity;
  let adjustedOriginalityAndCorroboration = originalityAndCorroboration;

  if (isNonStrategicProceduralOfficial) {
    adjustedActionClarity = 0;
    adjustedMechanism = 0;
    adjustedSpecificity = Math.min(adjustedSpecificity, 0.08);
    adjustedOriginalityAndCorroboration = Math.min(adjustedOriginalityAndCorroboration, 0.06);
  }

  let total = clamp(
    actorClarity + adjustedActionClarity + adjustedMechanism + adjustedSpecificity + adjustedOriginalityAndCorroboration,
    0,
    1
  );
  if (isNonStrategicProceduralOfficial) total = Math.min(total, 0.35);
  if (isNonStrategicProceduralOfficial && OFFICIAL_FILLER_PATTERN.test(combined)) total = Math.min(total, 0.25);

  return {
    total: Number(total.toFixed(4)),
    components: {
      actor_clarity: Number(actorClarity.toFixed(4)),
      action_clarity: Number(adjustedActionClarity.toFixed(4)),
      mechanism: Number(adjustedMechanism.toFixed(4)),
      specificity: Number(adjustedSpecificity.toFixed(4)),
      originality_corroboration: Number(adjustedOriginalityAndCorroboration.toFixed(4)),
    },
  };
}

function computeSoftPenalties(item, context = {}) {
  const sourceDomain = String(item?.source_domain || item?.source || "").trim().toLowerCase();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const combined = `${headline} ${summary}`.trim();
  const contentFlags = Array.isArray(item?.content_flags)
    ? item.content_flags.map((flag) => String(flag || "").trim().toLowerCase())
    : [];
  const proceduralNoticeAssessment = context.proceduralNoticeAssessment || classifyProceduralNotice(item);
  const topicTag = String(item?.tag || "").trim().toUpperCase();
  const selectorPenalties = context?.selectorPenalties && typeof context.selectorPenalties === "object"
    ? context.selectorPenalties
    : DEFAULT_SELECTOR_PENALTIES;
  const topicPenaltyMap = selectorPenalties.topicDomainPenalties
    && typeof selectorPenalties.topicDomainPenalties[topicTag] === "object"
    ? selectorPenalties.topicDomainPenalties[topicTag]
    : null;
  const penalties = Object.create(null);
  if (contentFlags.includes("generic_commentary")) penalties.generic_commentary = 0.04;
  if (proceduralNoticeAssessment.proceduralNotice) {
    penalties.procedural_notice = proceduralNoticeAssessment.hasStrategicShift ? 0.03 : 0.10;
  }
  if (sourceType === "primary_official"
      && proceduralNoticeAssessment.proceduralNotice
      && proceduralNoticeAssessment.hasStrategicShift !== true) {
    penalties.primary_official_procedural_no_shift = 0.18;
  }
  if (sourceType === "primary_official" && OFFICIAL_FILLER_PATTERN.test(combined)) {
    penalties.official_filler = 0.12;
  }
  if (sourceType === "aggregator_republisher") penalties.aggregator = 0.08;
  if (sourceType === "corporate_pr") penalties.corporate_pr = 0.05;
  if (topicTag === "TECHNOLOGY"
      && TECHNOLOGY_DEAL_NOISE_PATTERN.test(combined)
      && !TECH_STRATEGIC_PATTERN.test(combined)) {
    penalties.consumer_deal_noise_in_technology = 0.10;
  }
  if (topicTag === "ENERGY"
      && !ENERGY_TOPIC_ANCHOR_PATTERN.test(combined)
      && (ENERGY_FALSE_POSITIVE_PATTERN.test(combined) || ENERGY_OFF_TOPIC_PATTERN.test(combined))) {
    penalties.off_topic_non_energy_story_in_energy = 0.18;
  }
  if (context.ignoreCompetitivePenalties !== true && Number(item?.preferred_close_substitute_penalty || 0) > 0) {
    penalties.preferred_close_substitute = Number(item.preferred_close_substitute_penalty || 0) * 0.4;
  }
  if (context.ignoreCompetitivePenalties !== true && Number(item?.derivative_competitive_penalty || 0) > 0) {
    penalties.derivative_competitive = Number(item.derivative_competitive_penalty || 0) * 0.45;
  }
  if (topicPenaltyMap && topicPenaltyMap[sourceDomain] != null) {
    penalties.topic_domain = Math.abs(Number(topicPenaltyMap[sourceDomain] || 0));
  }
  if (
    selectorPenalties.proceduralGovDomainPenalty != null
    && proceduralNoticeAssessment.proceduralNotice
    && GOV_NOTICE_DOMAIN_PATTERN.test(sourceDomain)
  ) {
    penalties.procedural_gov_domain = Math.abs(Number(selectorPenalties.proceduralGovDomainPenalty || 0));
  }
  const total = Object.values(penalties).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    total: Number(clamp(total, 0, 1).toFixed(4)),
    components: Object.fromEntries(
      Object.entries(penalties).map(([key, value]) => [key, Number(Number(value || 0).toFixed(4))])
    ),
  };
}

function computeFinalRankScore(item, context = {}) {
  const nowMs = typeof context.nowMs === "number" && Number.isFinite(context.nowMs)
    ? context.nowMs
    : Date.now();
  const maxAgeHours = Number.isFinite(Number(context.maxAgeHours))
    ? Number(context.maxAgeHours)
    : DEFAULT_MAX_AGE_HOURS;
  const tierScores = context.tierScores && typeof context.tierScores === "object"
    ? { ...DEFAULT_TIER_SCORES, ...context.tierScores }
    : DEFAULT_TIER_SCORES;
  const weights = context.weights && typeof context.weights === "object"
    ? {
        strategic_value: Number(context.weights.strategic_value ?? DEFAULT_FINAL_RANK_WEIGHTS.strategic_value),
        story_quality: Number(context.weights.story_quality ?? DEFAULT_FINAL_RANK_WEIGHTS.story_quality),
        source_authority: Number(context.weights.source_authority ?? DEFAULT_FINAL_RANK_WEIGHTS.source_authority),
        freshness: Number(context.weights.freshness ?? DEFAULT_FINAL_RANK_WEIGHTS.freshness),
        novelty: Number(context.weights.novelty ?? DEFAULT_FINAL_RANK_WEIGHTS.novelty),
      }
    : DEFAULT_FINAL_RANK_WEIGHTS;
  const strategicValue = clamp(
    Number.isFinite(Number(item?.strategic_value))
      ? Number(item.strategic_value)
      : Number(item?.storyline_strategic_value || 0),
    0,
    1
  );
  const proceduralNoticeAssessment = context.proceduralNoticeAssessment || classifyProceduralNotice(item);
  const storyQuality = computeStoryQualityScore(item, { proceduralNoticeAssessment });
  const sourceAuthority = normalizeSourceAuthorityScore(item, tierScores);
  const freshness = computeFreshnessScore(item, nowMs, maxAgeHours);
  const novelty = computeNoveltyScore(item);
  const softPenalties = computeSoftPenalties(item, {
    proceduralNoticeAssessment,
    selectorPenalties: context.selectorPenalties,
  });
  const rawScore =
    (strategicValue * weights.strategic_value)
    + (storyQuality.total * weights.story_quality)
    + (sourceAuthority * weights.source_authority)
    + (freshness * weights.freshness)
    + (novelty * weights.novelty);
  const total = clamp(rawScore - softPenalties.total, 0, 1);
  return {
    total: Number(total.toFixed(4)),
    components: {
      strategic_value: Number(strategicValue.toFixed(4)),
      story_quality_score: Number(storyQuality.total.toFixed(4)),
      source_authority_score: Number(sourceAuthority.toFixed(4)),
      freshness_score: Number(freshness.toFixed(4)),
      novelty_score: Number(novelty.toFixed(4)),
      soft_penalties: Number(softPenalties.total.toFixed(4)),
      raw_score: Number(rawScore.toFixed(4)),
    },
    storyQualityComponents: storyQuality.components,
    softPenaltyComponents: softPenalties.components,
  };
}

function compareByFinalRank(left, right, context = {}) {
  const leftEffective = Number.isFinite(Number(context?.effectiveScoreResolver?.(left)))
    ? Number(context.effectiveScoreResolver(left))
    : Number(left?.effective_final_rank_score ?? left?.final_rank_score ?? 0);
  const rightEffective = Number.isFinite(Number(context?.effectiveScoreResolver?.(right)))
    ? Number(context.effectiveScoreResolver(right))
    : Number(right?.effective_final_rank_score ?? right?.final_rank_score ?? 0);
  const effectiveDelta = rightEffective - leftEffective;
  if (effectiveDelta !== 0) return effectiveDelta;

  const tieBreakers = [
    ["strategic_value", Number(right?.strategic_value || 0) - Number(left?.strategic_value || 0)],
    ["story_quality_score", Number(right?.story_quality_score || 0) - Number(left?.story_quality_score || 0)],
    ["source_authority_score", Number(right?.source_authority_score || 0) - Number(left?.source_authority_score || 0)],
    ["freshness_score", Number(right?.freshness_score || 0) - Number(left?.freshness_score || 0)],
    ["same_domain_concentration", Number(left?._same_domain_count || 0) - Number(right?._same_domain_count || 0)],
  ];
  for (const [, delta] of tieBreakers) {
    if (delta !== 0) return delta;
  }
  return String(left?.url || left?.candidate_id || left?.headline || "").localeCompare(
    String(right?.url || right?.candidate_id || right?.headline || "")
  );
}

function classifyProceduralNotice(item) {
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const sourceDomain = String(item?.source_domain || item?.source || "").trim().toLowerCase();
  const combined = `${headline} ${summary}`.trim();
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const looksProcedural = PROCEDURAL_NOTICE_PATTERN.test(combined)
    || (sourceType === "primary_official" && OFFICIAL_FILLER_PATTERN.test(combined))
    || GOV_NOTICE_DOMAIN_PATTERN.test(sourceDomain) && /\b(notice|guidance|filing|conference)\b/i.test(combined);
  const hasStrategicShift = STRATEGIC_SHIFT_PATTERN.test(combined);
  return {
    proceduralNotice: looksProcedural,
    hasStrategicShift,
  };
}

function computeQualityAdjustment(item, opts = {}) {
  let adjustment = 0;
  let storyShapePenalty = 0;
  let domainPenalty = 0;
  const headline = String(item?.headline || "");
  const summary = String(item?.summary || "");
  const combined = `${headline} ${summary}`;
  const topicTag = String(item?.tag || "").trim().toUpperCase();
  const sourceDomain = String(item?.source_domain || item?.source || "").trim().toLowerCase();
  const topicFit = normalizeTopicFitScore(item);
  const sourceType = String(item?.source_type || "").trim().toLowerCase();
  const sourceFamily = String(item?.source_family || item?.retrieval_source_family || "").trim().toLowerCase();
  const contentKind = String(item?.content_kind || "").trim().toLowerCase();
  const originalityProfile = String(item?.originality_profile || "").trim().toLowerCase();
  const contentFlags = Array.isArray(item?.content_flags)
    ? item.content_flags.map((flag) => String(flag || "").trim().toLowerCase())
    : [];
  const proceduralNoticeAssessment = opts.proceduralNoticeAssessment || classifyProceduralNotice(item);

  if (topicFit < 0.2) adjustment -= 0.2;
  else if (topicFit < 0.4) adjustment -= 0.12;
  else if (topicFit >= 0.85) adjustment += 0.05;

  if (sourceType === "primary_official" || sourceFamily === "official" || contentKind === "official_document") {
    storyShapePenalty -= 0.05;
    if (OFFICIAL_FILLER_PATTERN.test(combined)) storyShapePenalty -= 0.22;
  }

  if (opts.corporatePrPenalty === true
      && (sourceType === "corporate_pr" || originalityProfile === "press_release_repost")) {
    storyShapePenalty -= 0.12;
  }

  const commentaryLike = sourceType === "analysis_blog"
    || originalityProfile === "derived_synthesis"
    || contentFlags.includes("generic_commentary")
    || COMMENTARY_PATTERN.test(combined);
  if (commentaryLike) storyShapePenalty -= 0.18;

  if (topicTag === "TECHNOLOGY") {
    if (TECH_NOISE_PATTERN.test(combined)) storyShapePenalty -= 0.24;
    if (TECH_STRATEGIC_PATTERN.test(combined)) adjustment += 0.06;
    if (TECH_FALSE_POSITIVE_PATTERN.test(combined) && !TECH_STRATEGIC_PATTERN.test(combined)) {
      storyShapePenalty -= 0.34;
    }
  }

  if (topicTag === "ENERGY" && ENERGY_FALSE_POSITIVE_PATTERN.test(combined)) {
    storyShapePenalty -= 0.42;
  }

  if (topicTag === "INDUSTRIALS"
      && sourceDomain === "fda.gov"
      && INDUSTRIALS_FALSE_POSITIVE_PATTERN.test(combined)) {
    storyShapePenalty -= 0.34;
  }

  if ((sourceType === "reported_media" || sourceType === "trade_specialist")
    && topicFit >= 0.75
    && !commentaryLike) {
    adjustment += 0.04;
  }

  if (proceduralNoticeAssessment.proceduralNotice) {
    storyShapePenalty -= proceduralNoticeAssessment.hasStrategicShift ? 0.12 : 0.32;
    if (GOV_NOTICE_DOMAIN_PATTERN.test(sourceDomain)) {
      domainPenalty += Number(opts?.selectorPenalties?.proceduralGovDomainPenalty || 0);
    }
  }

  const topicDomainPenalties = opts?.selectorPenalties?.topicDomainPenalties
    && typeof opts.selectorPenalties.topicDomainPenalties === "object"
    ? opts.selectorPenalties.topicDomainPenalties
    : {};
  const topicPenaltyMap = topicDomainPenalties[topicTag]
    && typeof topicDomainPenalties[topicTag] === "object"
    ? topicDomainPenalties[topicTag]
    : null;
  if (topicPenaltyMap && topicPenaltyMap[sourceDomain] != null) {
    domainPenalty += Number(topicPenaltyMap[sourceDomain] || 0);
  }

  adjustment += storyShapePenalty + domainPenalty;
  return {
    total: clamp(adjustment, -0.5, 0.12),
    story_shape_penalty: Number(storyShapePenalty.toFixed(4)),
    domain_penalty: Number(domainPenalty.toFixed(4)),
  };
}

/**
 * Score a single candidate item.
 *
 * Returns the item with score fields attached:
 *   item._score        — final weighted score [0,1]
 *   item._score_components — { freshness, source_tier, lane_bonus, novelty }
 *   item._score_reasons    — human-readable explanation strings
 *
 * Attach rather than replace so the caller can inspect or override.
 */
function scoreCandidate(item, opts = {}) {
  const nowMs = typeof opts.nowMs === "number" && Number.isFinite(opts.nowMs)
    ? opts.nowMs
    : Date.now();
  const cfg = resolveScoringConfig(opts.scoringConfig || {});
  const w = cfg.weights;

  const freshness = computeFreshnessScore(item, nowMs, cfg.maxAgeHours);
  const sourceTier = computeSourceTierScore(item, cfg.tierScores);
  const laneBonus = computeLaneBonusScore(item, cfg.laneBonuses, { officialLaneBonusCap: cfg.officialLaneBonusCap });
  const novelty = computeNoveltyScore(item);
  const topicFit = normalizeTopicFitScore(item);
  const proceduralNoticeAssessment = classifyProceduralNotice(item);
  const qualityAdjustment = computeQualityAdjustment(item, {
    corporatePrPenalty: cfg.corporatePrPenalty,
    proceduralNoticeAssessment,
    selectorPenalties: cfg.selectorPenalties,
  });

  const baseScore = clamp(
    freshness * w.freshness
    + sourceTier * w.source_tier
    + laneBonus * w.lane_bonus
    + novelty * w.novelty,
    0, 1
  );
  const score = clamp(baseScore + qualityAdjustment.total, 0, 1);
  const finalRank = computeFinalRankScore(item, {
    nowMs,
    maxAgeHours: cfg.maxAgeHours,
    tierScores: cfg.tierScores,
    selectorPenalties: cfg.selectorPenalties,
  });

  // Build human-readable explanation for the admin audit log
  const reasons = [
    `freshness=${freshness.toFixed(3)} (weight ${w.freshness})`,
    `source_tier=${sourceTier.toFixed(3)} (weight ${w.source_tier}, tier=${item?.source_tier ?? "unknown"})`,
    `lane_bonus=${laneBonus.toFixed(3)} (weight ${w.lane_bonus}, lane=${item?.retrieval_origin || item?.retrieval_lane || "unknown"})`,
    `novelty=${novelty.toFixed(3)} (weight ${w.novelty})`,
    `topic_fit=${topicFit.toFixed(3)}`,
    `quality_adjustment=${qualityAdjustment.total.toFixed(3)}`,
  ];
  if (proceduralNoticeAssessment.proceduralNotice) {
    reasons.push(`procedural_notice=yes strategic_shift=${proceduralNoticeAssessment.hasStrategicShift ? "yes" : "no"}`);
  }

  return {
    ...item,
    procedural_notice: proceduralNoticeAssessment.proceduralNotice,
    procedural_notice_has_strategic_shift: proceduralNoticeAssessment.hasStrategicShift,
    _score: Number(score.toFixed(4)),
    _score_components: {
      freshness: Number(freshness.toFixed(4)),
      source_tier: Number(sourceTier.toFixed(4)),
      lane_bonus: Number(laneBonus.toFixed(4)),
      novelty: Number(novelty.toFixed(4)),
      topic_fit: Number(topicFit.toFixed(4)),
      quality_adjustment: Number(qualityAdjustment.total.toFixed(4)),
      story_shape_penalty: qualityAdjustment.story_shape_penalty,
      domain_penalty: qualityAdjustment.domain_penalty,
      base_score: Number(baseScore.toFixed(4)),
      procedural_notice_penalty_applied: proceduralNoticeAssessment.proceduralNotice,
    },
    _score_reasons: reasons,
    _selector_penalties: {
      story_shape_penalty: qualityAdjustment.story_shape_penalty,
      domain_penalty: qualityAdjustment.domain_penalty,
    },
    ranking_version: item?.ranking_version || "v1",
    final_rank_score: finalRank.total,
    final_rank_components: finalRank.components,
    story_quality_score: finalRank.components.story_quality_score,
    story_quality_components: finalRank.storyQualityComponents,
    source_authority_score: finalRank.components.source_authority_score,
    freshness_score: finalRank.components.freshness_score,
    novelty_score: finalRank.components.novelty_score,
    soft_penalties: {
      total: finalRank.components.soft_penalties,
      components: finalRank.softPenaltyComponents,
    },
    dynamic_source_penalty: Number(item?.dynamic_source_penalty || 0),
    tie_break_outcome: item?.tie_break_outcome || null,
  };
}

/**
 * Score an array of candidates in place.
 * Returns a new array sorted by _score descending.
 */
function scoreCandidates(items, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const nowMs = typeof opts.nowMs === "number" && Number.isFinite(opts.nowMs)
    ? opts.nowMs
    : Date.now();
  const scored = items.map((item) => scoreCandidate(item, { ...opts, nowMs }));
  return scored.sort((a, b) => (b._score || 0) - (a._score || 0));
}

/**
 * Apply diversity cap and select top N from a scored+sorted candidate list.
 *
 * Rules (spec §2.5):
 *   - Score descending (already sorted)
 *   - Max perSourceCap items from the same source domain
 *   - Take top maxItems
 *   - Returns { selected, rejected } for audit logging
 */
function selectTopN(scoredItems, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems ?? 5));
  const perSourceCap = Math.max(1, Number(opts.perSourceCap ?? 2));

  const selected = [];
  const rejected = [];
  const domainCounts = Object.create(null);

  for (const item of (Array.isArray(scoredItems) ? scoredItems : [])) {
    if (selected.length >= maxItems) {
      rejected.push({ item, reason: "selection_pool_full" });
      continue;
    }
    const domain = String(item?.source_domain || item?.source || "unknown").trim().toLowerCase();
    const count = domainCounts[domain] || 0;
    if (count >= perSourceCap) {
      rejected.push({ item, reason: `selection_source_cap (${domain}: ${count}/${perSourceCap})` });
      continue;
    }
    domainCounts[domain] = count + 1;
    selected.push(item);
  }

  // Items remaining after filling maxItems — also rejected
  for (const item of scoredItems) {
    if (!selected.includes(item) && !rejected.some((r) => r.item === item)) {
      rejected.push({ item, reason: "selection_not_selected" });
    }
  }

  return { selected, rejected };
}

module.exports = {
  scoreCandidate,
  scoreCandidates,
  selectTopN,
  resolveScoringConfig,
  // Exposed for testing
  computeFreshnessScore,
  computeSourceTierScore,
  computeLaneBonusScore,
  computeNoveltyScore,
  classifyProceduralNotice,
  compareByFinalRank,
  computeFinalRankScore,
  DEFAULT_WEIGHTS,
  DEFAULT_FINAL_RANK_WEIGHTS,
  DEFAULT_TIER_SCORES,
  DEFAULT_LANE_BONUSES,
  computeStoryQualityScore,
};
