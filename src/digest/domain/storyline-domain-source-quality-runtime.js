"use strict";

const { clamp } = require("./storyline-domain-helpers-runtime");
const {
  normalizeMatchText,
  topicsRelated,
} = require("../../runtime/topic-normalization-runtime");
const {
  parseSourceIdentity,
} = require("./source-domain-runtime");
const {
  normalizeSourceIdentityKey,
  SOURCE_POLICY_RANKING_EFFECTS,
  normalizeSourcePolicyDomain,
  normalizeSourceTopicToken,
  TIER_OVERRIDE_SCORES,
  TOPIC_FIT_BAND_SCORES,
} = require("../../runtime/source-policy-registry-runtime");
const {
  AGGREGATOR_DOMAINS,
  ANALYSIS_BLOG_DOMAINS,
  CORPORATE_PR_DOMAINS,
  CORPORATE_SUBDOMAIN_PATTERNS,
  GENERIC_ENTITY_STOPWORDS,
  KNOWN_LEGIT_NET,
  PLATFORM_ROOT_DOMAINS,
  PRIMARY_OFFICIAL_DOMAINS,
  SOURCE_TIER_RULES,
  STANDARD_TOPIC_TOKENS,
  SUSPECT_DOMAIN_PATTERNS,
  TOPIC_AUTHORITY_OVERRIDES,
  TRADE_SPECIALIST_DOMAINS,
} = require("./storyline-domain-source-quality-registry-runtime");

const DERIVATIVE_HEADLINE_PATTERNS = [
  /\b(?:pushes|drives|leads)\s+companies\s+to\s+(?:invest|spend)\b/i,
  /\bmarket\s+(?:expected|projected|set)\s+to\s+(?:reach|grow|hit)\b/i,
  /\b(?:companies|firms)\s+are\s+(?:investing|spending|pouring)\s+billions\b/i,
  /\btop\s+\d+\s+(?:trends?|stocks?|companies|things)\b/i,
  /\beverything\s+you\s+need\s+to\s+know\b/i,
  /\bwhat\s+you\s+(?:need|should)\s+to\s+know\b/i,
];

const PRESS_RELEASE_REWRITE_PATTERNS = [
  /\b(?:announces?|declares?|reports?|appoints?|names?)\s/i,
];

const HARD_EXCLUDE_FLAGS = new Set(["routine_dividend", "stock_promo"]);

const _state = {
  adminSourceRegistry: null,
  preferredSourceRegistry: null,
  preferredSourceMatcher: null,
};

function normalizeSourceDomain(raw) {
  return normalizeSourcePolicyDomain(raw);
}

function matchesDomain(sourceDomain, candidateDomain) {
  const source = normalizeSourceDomain(sourceDomain);
  const candidate = normalizeSourceDomain(candidateDomain);
  if (!source || !candidate) return false;
  return source === candidate || source.endsWith(`.${candidate}`);
}

function resolveTopicAuthorityOverrides(sourceDomain) {
  const normalized = normalizeSourceDomain(sourceDomain);
  if (!normalized) return null;
  let bestDomain = null;
  let bestOverrides = null;
  for (const [domain, overrides] of Object.entries(TOPIC_AUTHORITY_OVERRIDES)) {
    if (!matchesDomain(normalized, domain)) continue;
    if (!bestDomain || domain.length > bestDomain.length) {
      bestDomain = domain;
      bestOverrides = overrides;
    }
  }
  return bestOverrides;
}

function buildBaselineTopicFitMap(sourceDomain) {
  const overrides = resolveTopicAuthorityOverrides(sourceDomain);
  const topicFitMap = {};
  for (const topic of Object.keys(overrides || {})) {
    topicFitMap[normalizeSourceTopicToken(topic)] = "high";
  }
  return topicFitMap;
}

function isCorporateAnnouncementDomain(sourceDomain) {
  const normalized = normalizeSourceDomain(sourceDomain);
  if (!normalized) return false;
  return CORPORATE_SUBDOMAIN_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isPlatformDomain(sourceDomainRaw) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) return false;
  return sourceDomain === "youtu.be"
    || matchesDomain(sourceDomain, "youtube.com")
    || matchesDomain(sourceDomain, "medium.com")
    || matchesDomain(sourceDomain, "substack.com");
}

function classifySourceType(sourceDomainRaw, baselineTier = null) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) return "unclassified";
  let resolvedTier = baselineTier;
  if (!resolvedTier) {
    for (const [sourceTier, rule] of Object.entries(SOURCE_TIER_RULES)) {
      if (rule.domains.some((domain) => matchesDomain(sourceDomain, domain))) {
        resolvedTier = sourceTier;
        break;
      }
    }
    if (!resolvedTier && isCorporateAnnouncementDomain(sourceDomain)) resolvedTier = "corporate";
    if (!resolvedTier && isPlatformDomain(sourceDomain)) resolvedTier = "weak";
    if (!resolvedTier && (sourceDomain.includes("blog.") || sourceDomain.includes(".blog"))) resolvedTier = "blog";
  }
  if (PRIMARY_OFFICIAL_DOMAINS.has(sourceDomain) || sourceDomain.endsWith(".gov")) return "primary_official";
  if (CORPORATE_PR_DOMAINS.has(sourceDomain) || isCorporateAnnouncementDomain(sourceDomain)) return "corporate_pr";
  if (isPlatformDomain(sourceDomain)) return "platform_user_generated";
  if (AGGREGATOR_DOMAINS.has(sourceDomain)) return "aggregator_republisher";
  if (ANALYSIS_BLOG_DOMAINS.has(sourceDomain) || sourceDomain.includes("blog.") || sourceDomain.includes(".blog")) return "analysis_blog";
  if (TRADE_SPECIALIST_DOMAINS.has(sourceDomain)) return "trade_specialist";
  if (resolvedTier === "premium" || resolvedTier === "strong" || resolvedTier === "standard") return "reported_media";
  if (resolvedTier === "blog") return "analysis_blog";
  if (resolvedTier === "corporate") return "corporate_pr";
  if (resolvedTier === "weak") return "aggregator_republisher";
  return "unclassified";
}

function derivePolicyFromBaseline(baseTier, sourceType) {
  if (baseTier === "blocked") return "blocked";
  if (baseTier === "weak") return sourceType === "platform_user_generated" ? "review" : "limited";
  if (baseTier === "corporate") return "limited";
  if (baseTier === "blog") return "allowed";
  if (baseTier === "suspect" || baseTier === "unknown") return "review";
  if (sourceType === "primary_official") return "preferred";
  if (sourceType === "reported_media" || sourceType === "trade_specialist") {
    return (baseTier === "premium" || baseTier === "strong") ? "preferred" : "allowed";
  }
  if (sourceType === "analysis_blog") {
    return (baseTier === "premium" || baseTier === "strong" || baseTier === "standard") ? "allowed" : "limited";
  }
  if (sourceType === "platform_user_generated") return "review";
  if (sourceType === "corporate_pr") return "limited";
  if (sourceType === "aggregator_republisher") return baseTier === "suspect" ? "review" : "limited";
  return "allowed";
}

function deriveReviewStatusFromBaseline(baseTier, sourceType) {
  if (baseTier === "unknown" || baseTier === "suspect") return "unreviewed";
  if (sourceType === "platform_user_generated") return "monitor";
  return "reviewed";
}

function deriveOriginalityProfile(sourceType) {
  if (sourceType === "primary_official") return "primary";
  if (sourceType === "reported_media" || sourceType === "trade_specialist") return "original_reporting";
  if (sourceType === "analysis_blog") return "derived_synthesis";
  if (sourceType === "corporate_pr") return "press_release_repost";
  if (sourceType === "aggregator_republisher") return "rewrite_aggregator";
  return "unknown";
}

function deriveTierFromGovernance(baselineTier, sourceType, policy) {
  if (policy === "blocked") return "blocked";
  if (sourceType === "primary_official") return "premium";
  if (sourceType === "reported_media") {
    return policy === "preferred"
      ? (baselineTier === "premium" ? "premium" : "strong")
      : "standard";
  }
  if (sourceType === "trade_specialist") {
    return policy === "preferred" ? "strong" : "standard";
  }
  if (sourceType === "analysis_blog") return "blog";
  if (sourceType === "corporate_pr") return "corporate";
  if (sourceType === "platform_user_generated") return policy === "review" ? "unknown" : "weak";
  if (sourceType === "aggregator_republisher") return policy === "review" ? "suspect" : "weak";
  if (policy === "review") return "unknown";
  return baselineTier || "unknown";
}

const TYPE_AUTHORITY_RANGES = Object.freeze({
  primary_official: Object.freeze([0.85, 0.99]),
  reported_media: Object.freeze([0.58, 0.96]),
  trade_specialist: Object.freeze([0.58, 0.92]),
  analysis_blog: Object.freeze([0.42, 0.74]),
  corporate_pr: Object.freeze([0.32, 0.56]),
  aggregator_republisher: Object.freeze([0.16, 0.45]),
  platform_user_generated: Object.freeze([0.18, 0.5]),
  unclassified: Object.freeze([0.28, 0.62]),
});

const POLICY_AUTHORITY_RANGES = Object.freeze({
  preferred: Object.freeze([0.72, 0.99]),
  allowed: Object.freeze([0.46, 0.84]),
  limited: Object.freeze([0.28, 0.58]),
  review: Object.freeze([0.32, 0.5]),
  blocked: Object.freeze([0, 0]),
});

function deriveAuthorityFromGovernance({
  baseAuthority,
  sourceType,
  policy,
  reviewStatus,
  topicFitBand,
  originalityProfile,
  preserveLowBase = false,
}) {
  if (policy === "blocked") return 0;
  const numericBase = Number.isFinite(Number(baseAuthority))
    ? Number(baseAuthority)
    : (policy === "preferred" ? 0.85 : policy === "allowed" ? 0.62 : policy === "limited" ? 0.42 : 0.4);
  const [typeMin, typeMax] = TYPE_AUTHORITY_RANGES[sourceType] || TYPE_AUTHORITY_RANGES.unclassified;
  const [policyMin, policyMax] = POLICY_AUTHORITY_RANGES[policy] || POLICY_AUTHORITY_RANGES.allowed;
  const floor = Math.min(Math.max(typeMin, policyMin), Math.min(typeMax, policyMax));
  const ceiling = Math.max(floor, Math.min(typeMax, policyMax));
  let score = clamp(numericBase, floor, ceiling);
  if (topicFitBand === "high") score += 0.05;
  if (topicFitBand === "medium") score += 0.02;
  if (topicFitBand === "low") score -= 0.08;
  if (originalityProfile === "rewrite_aggregator") score -= 0.04;
  if (!preserveLowBase && reviewStatus === "unreviewed" && policy === "review") score = clamp(score, 0.38, 0.48);
  if (!preserveLowBase && reviewStatus === "monitor" && policy === "review") score = clamp(score, 0.34, 0.5);
  if (preserveLowBase) score = Math.min(score, numericBase);
  return clamp(score, 0, 1);
}

function buildPolicyEffects(policy, sourceType) {
  const base = SOURCE_POLICY_RANKING_EFFECTS[policy] || SOURCE_POLICY_RANKING_EFFECTS.allowed;
  const requiresCorroboration = policy === "limited"
    ? sourceType !== "corporate_pr"
    : base.requires_corroboration;
  const leadEligible = policy === "allowed"
    ? sourceType !== "analysis_blog"
    : base.lead_eligible;
  const exposureCap = policy === "limited" && sourceType === "corporate_pr"
    ? 1
    : base.exposure_cap;
  return {
    policy,
    lead_eligible: leadEligible,
    exposure_cap: exposureCap,
    requires_corroboration: requiresCorroboration,
    score_multiplier: Number(base.score_multiplier.toFixed(3)),
  };
}

function getLegacyPreferredSourceDomainMatcher() {
  return require("../../runtime/preferred-source-registry-runtime").matchPreferredSourceDomain;
}

function setAdminSourceRegistry(registryMap) {
  if (registryMap instanceof Map) {
    _state.adminSourceRegistry = {
      domains: registryMap,
      identities: new Map(),
    };
    return;
  }
  if (registryMap && typeof registryMap === "object") {
    const domains = registryMap.domains instanceof Map ? registryMap.domains : new Map();
    const identities = registryMap.identities instanceof Map ? registryMap.identities : new Map();
    _state.adminSourceRegistry = { domains, identities };
    return;
  }
  _state.adminSourceRegistry = null;
}

function setPreferredSourceRegistry(registry) {
  _state.preferredSourceRegistry = registry && typeof registry === "object" ? registry : null;
}

function setPreferredSourceMatcher(matcher) {
  _state.preferredSourceMatcher = typeof matcher === "function" ? matcher : null;
}

function resolveAdminSourceRegistryEntry(sourceDomain, sourceIdentityKey = null) {
  const normalizedDomain = normalizeSourceDomain(sourceDomain);
  const normalizedIdentityKey = normalizeSourceIdentityKey(sourceIdentityKey);
  if (!_state.adminSourceRegistry || (!normalizedDomain && !normalizedIdentityKey)) return null;
  const identityEntries = _state.adminSourceRegistry.identities instanceof Map ? _state.adminSourceRegistry.identities : new Map();
  if (normalizedIdentityKey && identityEntries.has(normalizedIdentityKey)) {
    return {
      match_scope: "identity",
      matched_identity_key: normalizedIdentityKey,
      matched_domain: null,
      entry: identityEntries.get(normalizedIdentityKey) || null,
    };
  }
  if (!normalizedDomain) return null;
  const domainEntries = _state.adminSourceRegistry.domains instanceof Map ? _state.adminSourceRegistry.domains : new Map();
  let bestMatch = null;
  for (const [domain, entry] of domainEntries.entries()) {
    const normalizedEntryDomain = normalizeSourceDomain(domain);
    if (!normalizedEntryDomain) continue;
    if (!matchesDomain(normalizedDomain, normalizedEntryDomain)) continue;
    if (!bestMatch || normalizedEntryDomain.length > bestMatch.matched_domain.length) {
      bestMatch = {
        match_scope: "domain",
        matched_domain: normalizedEntryDomain,
        matched_identity_key: null,
        entry: entry && typeof entry === "object" ? entry : null,
      };
    }
  }
  return bestMatch;
}

function classifySourceTierBaseline(sourceDomainRaw, tag) {
  const sourceDomain = normalizeSourceDomain(sourceDomainRaw);
  if (!sourceDomain) {
    const sourceType = "unclassified";
    const policy = "review";
    const reviewStatus = "unreviewed";
    const originalityProfile = "unknown";
    const policyEffects = buildPolicyEffects(policy, sourceType);
    return {
      source_domain: "",
      source_type: sourceType,
      source_policy: policy,
      review_status: reviewStatus,
      originality_profile: originalityProfile,
      source_tier: "unknown",
      source_authority: deriveAuthorityFromGovernance({
        baseAuthority: 0.42,
        sourceType,
        policy,
        reviewStatus,
        topicFitBand: null,
        originalityProfile,
      }),
      topic_fit: 0,
      topic_fit_band: null,
      topic_fit_map: {},
      baseline_source_tier: "unknown",
      baseline_source_authority: 0.42,
      topic_override_score: null,
      topic_override_applied: false,
      policy_source: "baseline",
      policy_effects: policyEffects,
      hard_block: false,
      inherits_from_domain: null,
      admin_override: null,
    };
  }

  let baseTier = null;
  let baseScore = 0;
  let matchedRuleDomain = null;
  for (const [sourceTier, rule] of Object.entries(SOURCE_TIER_RULES)) {
    const matchedDomain = rule.domains.find((domain) => matchesDomain(sourceDomain, domain));
    if (matchedDomain) {
      baseTier = sourceTier;
      baseScore = rule.score;
      matchedRuleDomain = matchedDomain;
      break;
    }
  }

  if (!baseTier) {
    if (isCorporateAnnouncementDomain(sourceDomain)) {
      baseTier = "corporate";
      baseScore = 0.42;
      matchedRuleDomain = sourceDomain;
    } else if (sourceDomain.endsWith(".medium.com")) {
      baseTier = "weak";
      baseScore = 0.28;
      matchedRuleDomain = "medium.com";
    } else if (sourceDomain.endsWith(".substack.com")) {
      baseTier = "weak";
      baseScore = 0.22;
      matchedRuleDomain = "substack.com";
    } else if (sourceDomain.includes("blog.") || sourceDomain.includes(".blog")) {
      baseTier = "blog";
      baseScore = 0.48;
      matchedRuleDomain = sourceDomain;
    }
  }

  if (!baseTier) {
    const suspectMatch = SUSPECT_DOMAIN_PATTERNS.find((p) => p.test(sourceDomain));
    if (suspectMatch) {
      baseTier = "suspect";
      baseScore = 0.15;
    } else {
      baseTier = "unknown";
      baseScore = 0.42;
    }
  }

  const fit = computeTopicDomainFit(sourceDomain, tag);
  const sourceType = classifySourceType(sourceDomain, baseTier);
  const policy = derivePolicyFromBaseline(baseTier, sourceType);
  const reviewStatus = deriveReviewStatusFromBaseline(baseTier, sourceType);
  const originalityProfile = deriveOriginalityProfile(sourceType);
  const topicOverrideApplied = fit.overrideScore != null && fit.overrideScore > baseScore;
  const finalScore = deriveAuthorityFromGovernance({
    baseAuthority: topicOverrideApplied ? fit.overrideScore : baseScore,
    sourceType,
    policy,
    reviewStatus,
    topicFitBand: fit.band || null,
    originalityProfile,
    preserveLowBase: baseTier === "suspect",
  });
  const policyEffects = buildPolicyEffects(policy, sourceType);

  return {
    source_domain: sourceDomain,
    source_type: sourceType,
    source_policy: policy,
    review_status: reviewStatus,
    originality_profile: originalityProfile,
    source_tier: baseTier,
    source_authority: finalScore,
    topic_fit: fit.topicFit,
    topic_fit_band: fit.band || null,
    topic_fit_map: buildBaselineTopicFitMap(sourceDomain),
    baseline_source_tier: baseTier,
    baseline_source_authority: finalScore,
    topic_override_score: fit.overrideScore,
    topic_override_applied: topicOverrideApplied,
    policy_source: topicOverrideApplied
      ? "topic_override"
      : "baseline",
    policy_effects: policyEffects,
    hard_block: false,
    source_family_domain: matchedRuleDomain || sourceDomain,
    inherits_from_domain: null,
    admin_override: null,
  };
}

function resolvePreferredSourceMatch(sourceDomain, tag, sourceIdentityKey = null) {
  if (_state.preferredSourceMatcher) {
    return _state.preferredSourceMatcher(sourceDomain, tag, { sourceIdentityKey }) || {
      match: "none",
      kind: null,
      scope: "none",
      topics: [],
      strength: 0,
      matched_domain: null,
      matched_identity: null,
    };
  }
  if (!_state.preferredSourceRegistry) {
    return {
      match: "none",
      kind: null,
      scope: "none",
      topics: [],
      strength: 0,
      matched_domain: null,
      matched_identity: null,
    };
  }
  return getLegacyPreferredSourceDomainMatcher()(_state.preferredSourceRegistry, sourceDomain, tag, {
    sourceIdentityKey,
  });
}

function explainSourcePolicy(sourceDomainRaw, tag, options = {}) {
  const baseline = classifySourceTierBaseline(sourceDomainRaw, tag);
  const sourceDomain = String(baseline?.source_domain || "").trim();
  const sourceIdentityKey = normalizeSourceIdentityKey(options?.sourceIdentityKey);
  const adminMatch = resolveAdminSourceRegistryEntry(sourceDomain, sourceIdentityKey);
  if (!adminMatch || !adminMatch.entry) return baseline;

  const adminEntry = adminMatch.entry;
  const matchedScope = String(adminMatch.match_scope || "domain").trim() || "domain";
  const matchedDomain = String(adminMatch.matched_domain || "").trim() || null;
  const matchedIdentityKey = String(adminMatch.matched_identity_key || "").trim() || null;
  const tierOverride = String(adminEntry?.tier_override || "").trim().toLowerCase() || null;
  const authorityOverride = adminEntry?.authority_override === "" || adminEntry?.authority_override == null
    ? null
    : (Number.isFinite(Number(adminEntry.authority_override))
      ? Number(adminEntry.authority_override)
      : null);
  const hardBlock = adminEntry?.hard_block === true;
  const legacySourceType = tierOverride ? classifySourceType(sourceDomain, tierOverride) : null;
  const legacyPolicy = tierOverride ? derivePolicyFromBaseline(tierOverride, legacySourceType) : null;
  const legacyReviewStatus = tierOverride ? deriveReviewStatusFromBaseline(tierOverride, legacySourceType) : null;
  const legacyOriginalityProfile = legacySourceType ? deriveOriginalityProfile(legacySourceType) : null;
  const effectiveSourceType = String(adminEntry?.source_type || "").trim() || legacySourceType || baseline.source_type;
  const effectivePolicy = hardBlock
    ? "blocked"
    : (String(adminEntry?.policy || "").trim() || legacyPolicy || baseline.source_policy);
  const effectiveReviewStatus = String(adminEntry?.review_status || "").trim() || legacyReviewStatus || baseline.review_status;
  const effectiveOriginalityProfile = String(adminEntry?.originality_profile || "").trim()
    || legacyOriginalityProfile
    || baseline.originality_profile;
  const fit = computeTopicDomainFit(sourceDomain, tag, adminEntry?.topic_fit || null);

  let effectiveTier = tierOverride || baseline.source_tier;
  let effectiveAuthority = baseline.source_authority;
  let policySource = baseline.policy_source || "baseline";

  if (authorityOverride == null) {
    effectiveTier = tierOverride || deriveTierFromGovernance(baseline.source_tier, effectiveSourceType, effectivePolicy);
    effectiveAuthority = deriveAuthorityFromGovernance({
      baseAuthority: tierOverride && Object.prototype.hasOwnProperty.call(TIER_OVERRIDE_SCORES, tierOverride)
        ? TIER_OVERRIDE_SCORES[tierOverride]
        : baseline.source_authority,
      sourceType: effectiveSourceType,
      policy: effectivePolicy,
      reviewStatus: effectiveReviewStatus,
      topicFitBand: fit.band || baseline.topic_fit_band || null,
      originalityProfile: effectiveOriginalityProfile,
      preserveLowBase: tierOverride === "suspect" || (!tierOverride && baseline.source_tier === "suspect"),
    });
  }
  if (authorityOverride != null) effectiveAuthority = authorityOverride;
  if (hardBlock) {
    effectiveTier = "blocked";
    effectiveAuthority = 0;
    policySource = "admin_hard_block";
  } else if (matchedScope === "identity") {
    policySource = "admin_identity_override";
  } else {
    policySource = matchedDomain && matchedDomain !== sourceDomain
      ? "admin_inherited_override"
      : "admin_override";
  }

  const effectiveTopicFitMap = {
    ...(baseline.topic_fit_map || {}),
    ...((adminEntry?.topic_fit && typeof adminEntry.topic_fit === "object") ? adminEntry.topic_fit : {}),
  };
  const policyEffects = buildPolicyEffects(effectivePolicy, effectiveSourceType);

  return {
    ...baseline,
    source_type: effectiveSourceType,
    source_policy: effectivePolicy,
    review_status: effectiveReviewStatus,
    originality_profile: effectiveOriginalityProfile,
    source_tier: effectiveTier,
    source_authority: effectiveAuthority,
    topic_fit: fit.topicFit != null ? fit.topicFit : baseline.topic_fit,
    topic_fit_band: fit.band || baseline.topic_fit_band || null,
    topic_fit_map: effectiveTopicFitMap,
    policy_effects: policyEffects,
    hard_block: hardBlock,
    policy_source: policySource,
    source_family_domain: baseline.source_family_domain || sourceDomain,
    inherits_from_domain: matchedDomain && matchedDomain !== sourceDomain ? matchedDomain : null,
    inherits_from_identity: matchedScope === "identity" ? matchedIdentityKey : null,
    admin_override: {
      domain: String(adminEntry?.domain || matchedDomain || sourceDomain).trim() || null,
      identity_key: String(adminEntry?.identity_key || matchedIdentityKey || "").trim() || null,
      match_domain: matchedDomain,
      match_identity_key: matchedIdentityKey,
      match_scope: matchedScope,
      source_type: String(adminEntry?.source_type || "").trim() || null,
      policy: String(adminEntry?.policy || "").trim() || null,
      review_status: String(adminEntry?.review_status || "").trim() || null,
      topic_fit: (adminEntry?.topic_fit && typeof adminEntry.topic_fit === "object") ? adminEntry.topic_fit : {},
      originality_profile: String(adminEntry?.originality_profile || "").trim() || null,
      tier_override: tierOverride,
      authority_override: authorityOverride,
      hard_block: hardBlock,
      stop_nagging: adminEntry?.stop_nagging === true,
      note: String(adminEntry?.note || "").trim() || "",
      updated_at: String(adminEntry?.updated_at || "").trim() || null,
      updated_by: String(adminEntry?.updated_by || "").trim() || null,
    },
  };
}

function classifySourceTier(sourceDomainRaw, tag, options = {}) {
  return explainSourcePolicy(sourceDomainRaw, tag, options);
}

function computeTopicDomainFit(sourceDomain, tag, adminTopicFit = null) {
  if (!tag || !sourceDomain) return { overrideScore: null, topicFit: 0, band: null, matchedTopic: null };
  const tagToken = normalizeSourceTopicToken(tag);
  const topicFitMap = adminTopicFit && typeof adminTopicFit === "object" ? adminTopicFit : null;
  if (topicFitMap) {
    const exactBand = topicFitMap[tagToken];
    if (exactBand) {
      return {
        overrideScore: null,
        topicFit: TOPIC_FIT_BAND_SCORES[exactBand] || 0,
        band: exactBand,
        matchedTopic: tagToken,
      };
    }
    for (const [overrideTag, overrideBand] of Object.entries(topicFitMap)) {
      if (topicsRelated(tagToken, overrideTag)) {
        return {
          overrideScore: null,
          topicFit: Math.max(0.4, (TOPIC_FIT_BAND_SCORES[overrideBand] || 0.65) * 0.75),
          band: overrideBand === "high" ? "medium" : overrideBand,
          matchedTopic: overrideTag,
        };
      }
    }
  }
  const overrides = resolveTopicAuthorityOverrides(sourceDomain);
  if (!overrides) return { overrideScore: null, topicFit: 0, band: null, matchedTopic: null };

  if (overrides[tagToken] != null) {
    return { overrideScore: overrides[tagToken], topicFit: 1.0, band: "high", matchedTopic: tagToken };
  }

  for (const [overrideTag, overrideVal] of Object.entries(overrides)) {
    if (topicsRelated(tagToken, overrideTag)) {
      return { overrideScore: overrideVal, topicFit: 0.7, band: "medium", matchedTopic: overrideTag };
    }
  }

  return { overrideScore: null, topicFit: 0, band: null, matchedTopic: null };
}

function computeOriginalitySignal(item, sourceInfo) {
  const sourceType = sourceInfo?.source_type || "unclassified";
  const originalityProfile = sourceInfo?.originality_profile || deriveOriginalityProfile(sourceType);
  let score = 1.0;

  if (originalityProfile === "primary") score = 1.0;
  else if (originalityProfile === "original_reporting") score = 0.9;
  else if (originalityProfile === "derived_synthesis") score = 0.62;
  else if (originalityProfile === "press_release_repost") score = 0.52;
  else if (originalityProfile === "rewrite_aggregator") score = 0.35;
  else if (sourceType === "platform_user_generated") score = 0.45;

  const headline = String(item?.headline || "");
  for (const pattern of DERIVATIVE_HEADLINE_PATTERNS) {
    if (pattern.test(headline)) {
      score -= 0.15;
      break;
    }
  }

  if (sourceType !== "corporate_pr" && sourceType !== "primary_official") {
    for (const pattern of PRESS_RELEASE_REWRITE_PATTERNS) {
      if (pattern.test(headline)) {
        score -= 0.1;
        break;
      }
    }
  }

  return clamp(score, 0, 1);
}

function isWeakSourceItem(item = {}) {
  const sourceType = String(item?.source_type || "").trim().toLowerCase()
    || classifySourceType(item?.source_domain || item?.source, String(item?.source_tier || "").trim().toLowerCase());
  const policy = String(item?.source_policy || "").trim().toLowerCase()
    || derivePolicyFromBaseline(String(item?.source_tier || "").trim().toLowerCase(), sourceType);
  const authority = Number(item?.source_authority || 0);
  const routineScore = Number(item?.routine_item_score || 0);
  const corroborated = Number(item?.cross_source_count || 0) >= 2
    || Number(item?.supporting_sources_avg_authority || 0) >= 0.7;
  if (policy === "blocked" || item?.source_hard_block === true) return true;
  if (routineScore >= 0.72) return true;
  if (sourceType === "corporate_pr") {
    return routineScore >= 0.6 || authority < 0.28;
  }
  if (policy === "limited") {
    return !corroborated && authority < 0.46;
  }
  if (policy === "review") {
    return !corroborated && authority < 0.4;
  }
  return authority < 0.2;
}

module.exports = {
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
};
