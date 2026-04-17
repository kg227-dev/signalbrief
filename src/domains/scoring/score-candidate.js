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

// Freshness: how many hours to treat as max age.
// Items at 0h score 1.0; items at maxAgeHours score 0.05 (not 0 — they're still eligible).
const DEFAULT_MAX_AGE_HOURS = 48;
const FRESHNESS_FLOOR = 0.05;
const OFFICIAL_FILLER_PATTERN = /\b(frequently requested|what'?s new|drug safety communication|recall|warns consumers|alerts customers|consumer update|fact sheet|guidance for industry|companies that have not submitted|drug amount reports|shortage mitigation efforts|proactively posted|final rule|proposed rule|podcast(?:s)?|things? to know|how you can find|user fee amendments?|labeling resources?|facilities?, sites? and organization|drug safety and availability|notice of (?:public )?meeting|advisory committee meeting)\b/i;
const COMMENTARY_PATTERN = /(^|[\s"“])opinion:|\b(commentary|analysis|feature)\b|\b(watch now|best noise-canceling|readers are buying|spring sale|get ready with me|music video|excerpt from|reporter goes up against)\b/i;
const TECH_NOISE_PATTERN = /\b(earbuds?|shopping|sale|coupon|music video|camera test|review roundup|best .{0,30}\b|vision pro|steam link|offline dictation|dictation app|continuous glucose|glucose monitor|vibe coding|rooting for|blaming everything|users are mastering|social app|creator culture|meme)\b/i;
const TECH_STRATEGIC_PATTERN = /\b(ai security|cybersecurity|ransomware|data breach|platform policy|antitrust|supreme court|scotus|isp|piracy|chip|semiconductor|compute|data centers?|capital allocation|funding round|venture fund|ai infrastructure|open[- ]source model|enterprise ai|procurement|model safety|frontier model|regulator|regulation)\b/i;
const TECH_FALSE_POSITIVE_PATTERN = /\b(surgeon|liver|spleen|patient|medical examiner|charged with killing|hospital worker|autopsy)\b/i;
const ENERGY_FALSE_POSITIVE_PATTERN = /\b(dark energy|3d map of universe|universe|cosmolog(?:y|ists?)|astronom(?:y|ers?)|galax(?:y|ies)|cosmic)\b/i;
const INDUSTRIALS_FALSE_POSITIVE_PATTERN = /\b(drug supply chain security act|pharma|pharmaceutical|biotech|peptide|drug compounding|advisory committee)\b/i;
const PROCEDURAL_NOTICE_PATTERN = /\b(notice of|combined notice|notice announcing|informal settlement conference|guidance documents published|federal register|notice of filing|notice of conference|meeting notice|availability of guidance|guidance for industry|filing(?:s)? received)\b/i;
const STRATEGIC_SHIFT_PATTERN = /\b(enforcement|penalt(?:y|ies)|deadline|effective date|timeline|within \d+ (?:days|weeks|months)|cost|costs|margin|margins|capex|pricing|price|rate increase|fee|fees|competition|competitive|market share|buyer leverage|seller leverage|capacity|throughput|supply|demand|tariff|capital|procurement)\b/i;
const GOV_NOTICE_DOMAIN_PATTERN = /\b(federalregister\.gov|ferc\.gov|fda\.gov|sec\.gov|cms\.gov|justice\.gov)\b/i;

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
  DEFAULT_WEIGHTS,
  DEFAULT_TIER_SCORES,
  DEFAULT_LANE_BONUSES,
};
