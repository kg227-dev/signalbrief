"use strict";

const RUN_ROOT_CAUSES = Object.freeze([
  "validator_over_reject",
  "writeup_generation_failure",
  "selection_ranking_failure",
  "same_topic_backfill_degradation",
  "retrieval_thinness",
  "low_trust_selection_mix",
  "source_monopoly_or_cap_pressure",
  "parse_or_structured_output_failure",
  "missed_story_detection_noise",
  "unknown",
]);

const TOPIC_ROOT_CAUSES = Object.freeze([
  "writeup_failure_causing_strong_tier_loss",
  "selection_prefers_weaker_story_shapes",
  "retrieval_supply_thin",
  "trusted_pool_available_but_not_selected",
  "weak_backfill_after_writeup_loss",
  "source_mix_low_trust",
  "strong_pool_exhausted",
  "topic_stable",
  "unknown",
]);

const ROOT_CAUSE_ACTIONS = Object.freeze({
  validator_over_reject: {
    recommendedAction: "Relax soft-fail handling and increase minimum-viable accepts before changing ranking or retrieval.",
    recommendedNonAction: "Do not add sources or expand retrieval first.",
  },
  writeup_generation_failure: {
    recommendedAction: "Fix generation, parse, and extraction handling before touching selection or source mix.",
    recommendedNonAction: "Do not recalibrate retrieval while generation-stage failures dominate.",
  },
  selection_ranking_failure: {
    recommendedAction: "Tune topic relevance and story-shape ranking so trusted stronger candidates win selection.",
    recommendedNonAction: "Do not relax validator first when writeup is healthy.",
  },
  same_topic_backfill_degradation: {
    recommendedAction: "Preserve same-topic trusted replacements before weaker fallback entries can fill the slot.",
    recommendedNonAction: "Do not broaden the fallback pool.",
  },
  retrieval_thinness: {
    recommendedAction: "Inspect source pack coverage and query routing for thin topics before changing validator behavior.",
    recommendedNonAction: "Do not spend effort on repair-path tuning until supply is fixed.",
  },
  low_trust_selection_mix: {
    recommendedAction: "Raise trusted-source weighting and penalize low-trust winners when better supply exists.",
    recommendedNonAction: "Do not treat this as a retrieval problem if depth is already healthy.",
  },
  source_monopoly_or_cap_pressure: {
    recommendedAction: "Review source-cap behavior and diversity rules so one publisher does not suppress the best set.",
    recommendedNonAction: "Do not widen categories to hide source-balance problems.",
  },
  parse_or_structured_output_failure: {
    recommendedAction: "Harden structured output parsing and malformed-response recovery before validator tuning.",
    recommendedNonAction: "Do not add sources while parse failures dominate.",
  },
  missed_story_detection_noise: {
    recommendedAction: "Tighten missed-story flagging so the audit highlights only true selection misses.",
    recommendedNonAction: "Do not retune ranking from noisy missed-story signals alone.",
  },
  unknown: {
    recommendedAction: "Inspect per-topic writeup, selection, and retrieval traces to isolate the first dominant failure stage.",
    recommendedNonAction: "Do not make broad system changes until one dominant cause is confirmed.",
  },
  writeup_failure_causing_strong_tier_loss: {
    recommendedAction: "Fix validator softness and writeup acceptance before changing ranking or source mix.",
    recommendedNonAction: "Do not widen the source pool first.",
  },
  selection_prefers_weaker_story_shapes: {
    recommendedAction: "Adjust ranking so stronger trusted candidates beat weaker but shape-favored stories.",
    recommendedNonAction: "Do not blame retrieval when strong candidates already reached selection.",
  },
  retrieval_supply_thin: {
    recommendedAction: "Improve topic-specific source coverage and retrieval depth for this topic first.",
    recommendedNonAction: "Do not change validator or repair policy before supply improves.",
  },
  trusted_pool_available_but_not_selected: {
    recommendedAction: "Tune topic ranking and pool-cut behavior so trusted available candidates are selected.",
    recommendedNonAction: "Do not add more sources when trusted supply already exists.",
  },
  weak_backfill_after_writeup_loss: {
    recommendedAction: "Prefer same-topic trusted reserve items after writeup losses instead of weaker fallback survivors.",
    recommendedNonAction: "Do not broaden fallback behavior.",
  },
  source_mix_low_trust: {
    recommendedAction: "Raise the floor on trusted-source selection for this topic and demote low-trust fillers.",
    recommendedNonAction: "Do not classify this as retrieval-thin unless candidate depth is also weak.",
  },
  strong_pool_exhausted: {
    recommendedAction: "Rebuild strong-topic supply before changing ranking heuristics.",
    recommendedNonAction: "Do not relax low-trust selection constraints to mask exhausted strong supply.",
  },
  topic_stable: {
    recommendedAction: "No immediate action required.",
    recommendedNonAction: "Do not retune this topic while it remains stable.",
  },
});

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function num(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function ratio(numerator, denominator, digits = 3) {
  const denom = Number(denominator);
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  return Number((Number(numerator || 0) / denom).toFixed(digits));
}

function pct(numerator, denominator, digits = 2) {
  const denom = Number(denominator);
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  return Number((((Number(numerator || 0) / denom) * 100)).toFixed(digits));
}

function roundNumber(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(digits));
}

function countMapTotal(countMap) {
  if (!countMap || typeof countMap !== "object") return 0;
  return Object.values(countMap).reduce((sum, value) => sum + num(value, 0), 0);
}

function normalizeSourceTier(rawTier) {
  const numeric = Number(rawTier);
  if (numeric === 1 || numeric === 2 || numeric === 3) return numeric;
  const normalized = String(rawTier || "").trim().toLowerCase();
  if (normalized === "premium") return 1;
  if (normalized === "strong") return 2;
  if (normalized === "standard") return 3;
  return null;
}

function isTrustedCandidate(candidate) {
  const tier = normalizeSourceTier(candidate?.source_tier);
  return tier != null && tier <= 2;
}

function isSelected(candidate) {
  return candidate?.selected === true;
}

function getActionPair(rootCause) {
  return ROOT_CAUSE_ACTIONS[rootCause] || ROOT_CAUSE_ACTIONS.unknown;
}

function severityRank(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function mergeSeverity(current, next) {
  return severityRank(next) > severityRank(current) ? next : current;
}

function findDominantCountEntry(countMap = {}) {
  let bestKey = "";
  let bestValue = 0;
  for (const [key, value] of Object.entries(countMap || {})) {
    const numeric = num(value, 0);
    if (numeric > bestValue) {
      bestKey = key;
      bestValue = numeric;
    }
  }
  return { key: bestKey, value: bestValue };
}

function classifyProviderFailureCount(writeupFailureDetails = []) {
  return (Array.isArray(writeupFailureDetails) ? writeupFailureDetails : []).reduce((sum, detail) => {
    const reason = String(detail?.reason || "").trim().toLowerCase();
    if (!reason) return sum;
    if (reason.includes("parse") || reason.includes("provider") || reason.includes("json") || reason.includes("empty")) return sum + 1;
    return sum;
  }, 0);
}

function buildRunEvidence(summary = {}) {
  const writeup = summary?.writeup && typeof summary.writeup === "object" ? summary.writeup : {};
  const attemptedCount = Math.max(0, num(writeup.attempted_count, 0));
  const softFailCount = Math.max(0, num(writeup.soft_fail_count, 0));
  return {
    droppedSharePct: num(writeup.dropped_share_pct, 0),
    strongTierAttempted: Math.max(0, num(writeup.strong_tier_attempted_count, 0)),
    strongTierSelected: Math.max(0, num(writeup.strong_tier_final_selected_count, 0)),
    minimumViableAcceptRate: ratio(writeup.minimum_viable_accept_count, attemptedCount),
    softFailRate: ratio(softFailCount, attemptedCount),
    softFailToAcceptRate: ratio(writeup.soft_fail_recovery_count, softFailCount),
  };
}

function buildTopicMetrics(tag, topic = {}, fetchTopic = {}) {
  const candidates = Array.isArray(topic?.candidates) ? topic.candidates : [];
  const selectedCandidates = candidates.filter(isSelected);
  const unselectedCandidates = candidates.filter((candidate) => !isSelected(candidate));
  const trustedSelectedCount = selectedCandidates.filter(isTrustedCandidate).length;
  const trustedUnselectedCount = unselectedCandidates.filter(isTrustedCandidate).length;
  const highSignalUnselectedCount = (Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0)
    + trustedUnselectedCount;
  const writeup = topic?.writeup && typeof topic.writeup === "object" ? topic.writeup : {};
  const strictQuality = topic?.strict_quality && typeof topic.strict_quality === "object" ? topic.strict_quality : {};

  return {
    tag: String(tag || "").trim().toUpperCase(),
    totalCandidates: Math.max(0, num(topic?.total_candidates, candidates.length)),
    selectedCount: Math.max(0, num(topic?.selected_count, selectedCandidates.length)),
    trustedSelectedCount,
    trustedShare: ratio(trustedSelectedCount, selectedCandidates.length),
    trustedUnselectedCount,
    highSignalUnselectedCount,
    missedStoryFlagCount: Math.max(0, num(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0, 0)),
    sourceCapRejections: Math.max(0, num(topic?.rejection_reason_counts?.selection_source_cap, 0)),
    poolCutRejections: Math.max(0, num(topic?.rejection_reason_counts?.selection_pool_full, 0))
      + Math.max(0, num(topic?.rejection_reason_counts?.selection_not_selected, 0)),
    discoveryCapRejections: Math.max(0, num(topic?.rejection_reason_counts?.selection_discovery_cap, 0)),
    writeupAttempted: Math.max(0, num(writeup.attempted_count, 0)),
    writeupDropCount: Math.max(0, num(writeup.drop_count, 0)),
    writeupDroppedSharePct: Math.max(0, num(writeup.dropped_share_pct, 0)),
    underfillDueWriteupCount: Math.max(0, num(writeup.underfill_due_writeup_count, 0)),
    strongTierAttempted: Math.max(0, num(writeup.strong_tier_attempted_count, 0)),
    strongTierDropCount: Math.max(0, num(writeup.strong_tier_drop_count, 0)),
    strongTierSelected: Math.max(0, num(writeup.strong_tier_final_selected_count, 0)),
    softFailCount: Math.max(0, num(writeup.soft_fail_count, 0)),
    softFailRecoveryCount: Math.max(0, num(writeup.soft_fail_recovery_count, 0)),
    minimumViableAcceptCount: Math.max(0, num(writeup.minimum_viable_accept_count, 0)),
    parseFailureCounts: writeup?.parse_failure_counts && typeof writeup.parse_failure_counts === "object"
      ? writeup.parse_failure_counts
      : {},
    coverageStatus: String(fetchTopic?.coverage_status || "").trim().toLowerCase(),
    providerLimited: String(fetchTopic?.coverage_status || "").toLowerCase().includes("provider_limited"),
    thinCoverage: String(fetchTopic?.coverage_status || "").toLowerCase().includes("thin"),
    brokerItems: Math.max(0, num(fetchTopic?.broker_item_count, 0)),
    discoveryItems: Math.max(0, num(fetchTopic?.discovery_item_count, 0)),
    discoveryCandidateSharePct: Math.max(0, num(fetchTopic?.discovery_candidate_share_pct, 0)),
    strongPoolExhausted: strictQuality?.strong_pool_exhausted === true,
    standardTierBlockedWhileStrongAvailable: strictQuality?.standard_tier_blocked_while_strong_available === true,
    blockedBucket: strictQuality?.pass === false,
    selectedContainsLowTrust: selectedCandidates.some((candidate) => !isTrustedCandidate(candidate)),
  };
}

function buildTopicEvidence(metrics = {}) {
  return {
    trustedShare: metrics.trustedShare,
    strongTierAttempted: metrics.strongTierAttempted,
    strongTierSelected: metrics.strongTierSelected,
    writeupDrops: metrics.writeupDropCount,
    underfill: Math.max(0, 5 - metrics.selectedCount),
    totalCandidates: metrics.totalCandidates,
    missedStoryFlags: metrics.missedStoryFlagCount,
  };
}

function maybeElevateTopicSeverity(primaryRootCause, baseSeverity, topicCauseCounts) {
  if (primaryRootCause && primaryRootCause !== "topic_stable" && num(topicCauseCounts?.[primaryRootCause], 0) >= 3) {
    return "high";
  }
  return baseSeverity;
}

function deriveTopicDiagnosis(tag, topic = {}, fetchTopic = {}, topicCauseCounts = null) {
  const metrics = buildTopicMetrics(tag, topic, fetchTopic);
  const evidence = buildTopicEvidence(metrics);
  let primaryRootCause = "unknown";
  let severity = "low";
  const secondaryRootCauses = [];

  const retrievalThin = metrics.totalCandidates < 15
    || metrics.selectedCount < 5 && (metrics.totalCandidates < 12 || metrics.thinCoverage || metrics.providerLimited);

  const writeupStrongLoss = metrics.strongTierAttempted >= 2
    && (metrics.strongTierDropCount >= 1 || metrics.writeupDroppedSharePct >= 25)
    && metrics.strongTierSelected < metrics.strongTierAttempted;

  const weakBackfill = writeupStrongLoss
    && !metrics.strongPoolExhausted
    && metrics.selectedContainsLowTrust;

  const trustedPoolAvailableNotSelected = metrics.highSignalUnselectedCount >= 2
    && metrics.totalCandidates >= 15
    && metrics.writeupDroppedSharePct < 25;

  const weakerStoryShapes = metrics.trustedUnselectedCount >= 2
    && metrics.selectedContainsLowTrust
    && metrics.writeupDroppedSharePct < 25;

  const lowTrustMix = metrics.totalCandidates >= 15
    && metrics.selectedCount > 0
    && metrics.trustedShare < 0.5;

  if (retrievalThin) {
    primaryRootCause = "retrieval_supply_thin";
    severity = metrics.totalCandidates < 10 || metrics.selectedCount < 5 ? "high" : "medium";
  } else if (writeupStrongLoss) {
    primaryRootCause = "writeup_failure_causing_strong_tier_loss";
    severity = metrics.underfillDueWriteupCount > 0 || metrics.strongTierDropCount >= 2 ? "high" : "medium";
  } else if (weakBackfill) {
    primaryRootCause = "weak_backfill_after_writeup_loss";
    severity = metrics.selectedContainsLowTrust ? "high" : "medium";
  } else if (trustedPoolAvailableNotSelected) {
    primaryRootCause = "trusted_pool_available_but_not_selected";
    severity = metrics.missedStoryFlagCount > 0 ? "high" : "medium";
  } else if (weakerStoryShapes) {
    primaryRootCause = "selection_prefers_weaker_story_shapes";
    severity = "medium";
  } else if (lowTrustMix) {
    primaryRootCause = "source_mix_low_trust";
    severity = metrics.trustedShare < 0.25 ? "medium" : "low";
  } else if (metrics.strongPoolExhausted) {
    primaryRootCause = "strong_pool_exhausted";
    severity = "medium";
  } else if (metrics.selectedCount >= 5 && metrics.totalCandidates >= 15 && metrics.writeupDroppedSharePct < 20 && metrics.trustedShare >= 0.6) {
    primaryRootCause = "topic_stable";
    severity = "low";
  }

  if (primaryRootCause === "writeup_failure_causing_strong_tier_loss" && weakBackfill) {
    secondaryRootCauses.push("weak_backfill_after_writeup_loss");
  }
  if (primaryRootCause === "trusted_pool_available_but_not_selected" && weakerStoryShapes) {
    secondaryRootCauses.push("selection_prefers_weaker_story_shapes");
  }
  if (primaryRootCause === "retrieval_supply_thin" && metrics.strongPoolExhausted) {
    secondaryRootCauses.push("strong_pool_exhausted");
  }

  severity = maybeElevateTopicSeverity(primaryRootCause, severity, topicCauseCounts);
  const status = primaryRootCause === "topic_stable"
    ? "stable"
    : severity === "high"
      ? "critical"
      : "watch";
  const actions = getActionPair(primaryRootCause);

  return {
    topic: metrics.tag,
    status,
    primaryRootCause,
    secondaryRootCauses,
    severity,
    evidence,
    recommendedAction: actions.recommendedAction,
    recommendedNonAction: actions.recommendedNonAction,
  };
}

function countTopicPrimaryCauses(topicDiagnoses = []) {
  const counts = Object.create(null);
  for (const diagnosis of (Array.isArray(topicDiagnoses) ? topicDiagnoses : [])) {
    const key = String(diagnosis?.primaryRootCause || "").trim();
    if (!key || key === "topic_stable") continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function mapTopicCauseToRunCause(topicDiagnosis = {}) {
  const cause = String(topicDiagnosis?.primaryRootCause || "").trim();
  if (cause === "retrieval_supply_thin") return "retrieval_thinness";
  if (cause === "weak_backfill_after_writeup_loss") return "same_topic_backfill_degradation";
  if (cause === "trusted_pool_available_but_not_selected" || cause === "selection_prefers_weaker_story_shapes") return "selection_ranking_failure";
  if (cause === "source_mix_low_trust") return "low_trust_selection_mix";
  if (cause === "strong_pool_exhausted") return "retrieval_thinness";
  if (cause === "writeup_failure_causing_strong_tier_loss") return "validator_over_reject";
  return "";
}

function buildRunStageMetrics(auditDoc = {}) {
  const summary = auditDoc?.summary && typeof auditDoc.summary === "object" ? auditDoc.summary : {};
  const writeup = summary?.writeup && typeof summary.writeup === "object" ? summary.writeup : {};
  const topicEntries = auditDoc?.topics && typeof auditDoc.topics === "object" ? Object.entries(auditDoc.topics) : [];
  const topics = topicEntries.map(([, topic]) => topic);
  const attemptedCount = Math.max(0, num(writeup.attempted_count, 0));
  const providerFailureCount = classifyProviderFailureCount(auditDoc?.enrichmentDiagnostics?.writeup_failure_details);
  const parseFailureCounts = writeup?.parse_failure_counts && typeof writeup.parse_failure_counts === "object"
    ? writeup.parse_failure_counts
    : {};
  const parseFailureCount = countMapTotal(parseFailureCounts);
  const candidateDepthHealthyTopics = topics.filter((topic) => num(topic?.total_candidates, 0) >= 15).length;
  const thinTopics = topics.filter((topic) => {
    const count = num(topic?.total_candidates, 0);
    return count > 0 && count < 15;
  }).length;
  const blockedTopics = topics.filter((topic) => topic?.strict_quality?.pass === false).length;
  const trustedSelectedCount = topics.reduce((sum, topic) => {
    const candidates = Array.isArray(topic?.candidates) ? topic.candidates : [];
    return sum + candidates.filter((candidate) => isSelected(candidate) && isTrustedCandidate(candidate)).length;
  }, 0);
  const selectedCount = topics.reduce((sum, topic) => sum + Math.max(0, num(topic?.selected_count, 0)), 0);
  const missedStoryFlagCount = Math.max(0, num(summary?.missed_story_flag_count, 0));
  const sourceCapCount = Math.max(0, num(summary?.selection_rejection_counts?.selection_source_cap, 0));
  const poolCutCount = Math.max(0, num(summary?.selection_rejection_counts?.selection_pool_full, 0))
    + Math.max(0, num(summary?.selection_rejection_counts?.selection_not_selected, 0));
  const weakBackfillTopicCount = topicEntries.reduce((sum, [tag, topic]) => {
    const topicMetrics = buildTopicMetrics(tag, topic, {});
    const hasWeakBackfill = topicMetrics.strongTierAttempted >= 2
      && topicMetrics.strongTierDropCount >= 1
      && !topicMetrics.strongPoolExhausted
      && topicMetrics.selectedContainsLowTrust;
    return sum + (hasWeakBackfill ? 1 : 0);
  }, 0);

  return {
    topicCount: topics.length,
    candidateDepthHealthyTopics,
    candidateDepthHealthyShare: ratio(candidateDepthHealthyTopics, topics.length),
    thinTopics,
    blockedTopics,
    attemptedCount,
    dropCount: Math.max(0, num(writeup.drop_count, 0)),
    droppedSharePct: Math.max(0, num(writeup.dropped_share_pct, 0)),
    strongTierAttempted: Math.max(0, num(writeup.strong_tier_attempted_count, 0)),
    strongTierDropCount: Math.max(0, num(writeup.strong_tier_drop_count, 0)),
    strongTierSelected: Math.max(0, num(writeup.strong_tier_final_selected_count, 0)),
    generationFailureCount: Math.max(0, num(writeup.generation_failure_count, 0)),
    parseFailureCount,
    providerFailureCount,
    hardFailCount: Math.max(0, num(writeup.hard_fail_count, 0)),
    softFailCount: Math.max(0, num(writeup.soft_fail_count, 0)),
    softFailRecoveryCount: Math.max(0, num(writeup.soft_fail_recovery_count, 0)),
    minimumViableAcceptCount: Math.max(0, num(writeup.minimum_viable_accept_count, 0)),
    trustedSelectedShare: ratio(trustedSelectedCount, selectedCount),
    selectedCount,
    missedStoryFlagCount,
    sourceCapCount,
    poolCutCount,
    weakBackfillTopicCount,
  };
}

function inferTopicCauseCountsForRun(topicDiagnoses = []) {
  const counts = Object.create(null);
  for (const diagnosis of (Array.isArray(topicDiagnoses) ? topicDiagnoses : [])) {
    const runCause = mapTopicCauseToRunCause(diagnosis);
    if (!runCause) continue;
    counts[runCause] = (counts[runCause] || 0) + 1;
  }
  return counts;
}

function pushSecondary(rootCauses, value) {
  const next = String(value || "").trim();
  if (!next || next === rootCauses[0] || rootCauses.includes(next)) return rootCauses;
  rootCauses.push(next);
  return rootCauses;
}

function deriveRunDiagnosis(auditDoc = {}) {
  const topicEntries = auditDoc?.topics && typeof auditDoc.topics === "object"
    ? Object.entries(auditDoc.topics)
    : [];
  const topicDiagnoses = topicEntries
    .map(([, topic]) => topic?.topicDiagnosis)
    .filter((diagnosis) => diagnosis && typeof diagnosis === "object");
  const topicRunCauseCounts = inferTopicCauseCountsForRun(topicDiagnoses);
  const metrics = buildRunStageMetrics(auditDoc);
  const evidence = buildRunEvidence(auditDoc?.summary || {});

  const providerGenerationDominant = (metrics.generationFailureCount + metrics.providerFailureCount) >= Math.max(2, metrics.softFailCount + metrics.hardFailCount);
  const parseDominant = metrics.parseFailureCount >= Math.max(2, metrics.dropCount * 0.4);
  const validatorPressure = metrics.droppedSharePct >= 40
    && metrics.candidateDepthHealthyShare >= 0.6
    && metrics.strongTierAttempted >= Math.max(3, metrics.strongTierSelected + 2)
    && !providerGenerationDominant;
  const retrievalThin = metrics.thinTopics >= Math.max(1, Math.ceil(metrics.topicCount / 3));
  const rankingFailure = num(topicRunCauseCounts.selection_ranking_failure, 0) >= 1
    || (metrics.poolCutCount >= 4 && metrics.missedStoryFlagCount >= 2 && metrics.droppedSharePct < 25);
  const backfillDegradation = metrics.weakBackfillTopicCount >= 1 || num(topicRunCauseCounts.same_topic_backfill_degradation, 0) >= 1;
  const lowTrustSelectionMix = metrics.selectedCount > 0
    && metrics.trustedSelectedShare < 0.5
    && metrics.candidateDepthHealthyShare >= 0.6
    && metrics.droppedSharePct < 25
    && !retrievalThin;
  const sourceCapPressure = metrics.sourceCapCount >= 3 && metrics.poolCutCount >= 2;
  const missedStoryNoise = metrics.missedStoryFlagCount >= 5 && metrics.droppedSharePct < 20 && !rankingFailure;

  let primaryRootCause = "unknown";
  let severity = "low";
  const secondaryRootCauses = [];

  if (parseDominant) {
    primaryRootCause = "parse_or_structured_output_failure";
    severity = "high";
  } else if (providerGenerationDominant && metrics.dropCount >= 2) {
    primaryRootCause = "writeup_generation_failure";
    severity = metrics.dropCount >= 4 ? "high" : "medium";
  } else if (validatorPressure) {
    primaryRootCause = "validator_over_reject";
    severity = metrics.dropCount >= 4 || metrics.strongTierDropCount >= 2 ? "high" : "medium";
  } else if (backfillDegradation) {
    primaryRootCause = "same_topic_backfill_degradation";
    severity = metrics.weakBackfillTopicCount >= 3 || num(topicRunCauseCounts.same_topic_backfill_degradation, 0) >= 3 ? "high" : "medium";
  } else if (retrievalThin) {
    primaryRootCause = "retrieval_thinness";
    severity = metrics.thinTopics >= 3 ? "high" : "medium";
  } else if (rankingFailure) {
    primaryRootCause = "selection_ranking_failure";
    severity = num(topicRunCauseCounts.selection_ranking_failure, 0) >= 3 ? "high" : "medium";
  } else if (lowTrustSelectionMix) {
    primaryRootCause = "low_trust_selection_mix";
    severity = metrics.trustedSelectedShare < 0.25 ? "medium" : "low";
  } else if (sourceCapPressure) {
    primaryRootCause = "source_monopoly_or_cap_pressure";
    severity = "medium";
  } else if (missedStoryNoise) {
    primaryRootCause = "missed_story_detection_noise";
    severity = "low";
  }

  if (primaryRootCause !== "parse_or_structured_output_failure" && parseDominant) pushSecondary(secondaryRootCauses, "parse_or_structured_output_failure");
  if (primaryRootCause !== "writeup_generation_failure" && providerGenerationDominant && metrics.dropCount >= 2) pushSecondary(secondaryRootCauses, "writeup_generation_failure");
  if (primaryRootCause !== "validator_over_reject" && validatorPressure) pushSecondary(secondaryRootCauses, "validator_over_reject");
  if (primaryRootCause !== "retrieval_thinness" && retrievalThin) pushSecondary(secondaryRootCauses, "retrieval_thinness");
  if (primaryRootCause !== "selection_ranking_failure" && rankingFailure) pushSecondary(secondaryRootCauses, "selection_ranking_failure");

  const primaryCount = primaryRootCause === "same_topic_backfill_degradation"
    ? Math.max(num(topicRunCauseCounts[primaryRootCause], 0), metrics.weakBackfillTopicCount)
    : primaryRootCause === "unknown"
      ? 0
      : num(topicRunCauseCounts[primaryRootCause], 0);
  if (primaryCount >= 3) severity = "high";
  const confidence = primaryRootCause === "unknown"
    ? 0.5
    : primaryCount >= 3
      ? 0.94
      : primaryRootCause === "validator_over_reject" || primaryRootCause === "writeup_generation_failure" || primaryRootCause === "parse_or_structured_output_failure"
        ? 0.9
        : 0.78;
  const status = severity === "high" ? "red" : primaryRootCause === "unknown" ? "green" : "yellow";

  const primaryActions = getActionPair(primaryRootCause);
  const topIssues = [{
    issueCode: primaryRootCause,
    severity,
    confidence: roundNumber(confidence, 2),
    evidence: {
      ...evidence,
      affectedTopicCount: primaryCount,
      candidateDepthHealthyShare: metrics.candidateDepthHealthyShare,
      thinTopicCount: metrics.thinTopics,
      parseFailureCount: metrics.parseFailureCount,
      providerFailureCount: metrics.providerFailureCount,
      sourceCapCount: metrics.sourceCapCount,
      missedStoryFlagCount: metrics.missedStoryFlagCount,
    },
    recommendedAction: primaryActions.recommendedAction,
    recommendedNonAction: primaryActions.recommendedNonAction,
  }];

  const topicDerivedIssues = new Map();
  for (const diagnosis of topicDiagnoses) {
    const runCause = mapTopicCauseToRunCause(diagnosis);
    if (!runCause || runCause === primaryRootCause) continue;
    const entry = topicDerivedIssues.get(runCause) || {
      issueCode: runCause,
      severity: diagnosis.severity || "low",
      confidence: 0.74,
      affectedTopicCount: 0,
      representative: diagnosis,
    };
    entry.affectedTopicCount += 1;
    entry.severity = mergeSeverity(entry.severity, diagnosis.severity || "low");
    topicDerivedIssues.set(runCause, entry);
  }

  for (const entry of topicDerivedIssues.values()) {
    if (entry.affectedTopicCount >= 3) entry.severity = "high";
  }

  const sortedTopicIssues = Array.from(topicDerivedIssues.values())
    .sort((left, right) => {
      const severityDiff = severityRank(right.severity) - severityRank(left.severity);
      if (severityDiff !== 0) return severityDiff;
      const countDiff = num(right.affectedTopicCount, 0) - num(left.affectedTopicCount, 0);
      if (countDiff !== 0) return countDiff;
      return String(left.issueCode || "").localeCompare(String(right.issueCode || ""));
    })
    .slice(0, 2)
    .map((entry) => {
      const actions = getActionPair(entry.issueCode);
      return {
        issueCode: entry.issueCode,
        severity: entry.severity,
        confidence: roundNumber(entry.affectedTopicCount >= 3 ? 0.88 : 0.72, 2),
        evidence: {
          ...evidence,
          affectedTopicCount: entry.affectedTopicCount,
          representativeTopic: entry.representative?.topic || null,
        },
        recommendedAction: actions.recommendedAction,
        recommendedNonAction: actions.recommendedNonAction,
      };
    });

  return {
    status,
    primaryRootCause,
    secondaryRootCauses: secondaryRootCauses.slice(0, 3),
    topIssues: topIssues.concat(sortedTopicIssues),
  };
}

function attachDiagnosisToAuditDocument(auditDoc = {}) {
  const doc = auditDoc && typeof auditDoc === "object" ? auditDoc : {};
  const fetchTopics = new Map(
    (Array.isArray(doc?.fetch?.topic_diagnostics) ? doc.fetch.topic_diagnostics : [])
      .map((topic) => [String(topic?.tag || "").trim().toUpperCase(), topic])
  );
  const topicEntries = doc?.topics && typeof doc.topics === "object"
    ? Object.entries(doc.topics)
    : [];
  const firstPassDiagnoses = topicEntries.map(([tag, topic]) => deriveTopicDiagnosis(tag, topic, fetchTopics.get(String(tag || "").trim().toUpperCase()) || {}));
  const topicCauseCounts = countTopicPrimaryCauses(firstPassDiagnoses);

  doc.topics = topicEntries.reduce((acc, [tag, topic]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    acc[normalizedTag] = {
      ...topic,
      topicDiagnosis: deriveTopicDiagnosis(normalizedTag, topic, fetchTopics.get(normalizedTag) || {}, topicCauseCounts),
    };
    return acc;
  }, Object.create(null));

  doc.runDiagnosis = deriveRunDiagnosis(doc);
  return doc;
}

function buildProductBlockerFromAuditDoc(auditDoc = {}) {
  const runDiagnosis = auditDoc?.runDiagnosis && typeof auditDoc.runDiagnosis === "object"
    ? auditDoc.runDiagnosis
    : null;
  const issue = Array.isArray(runDiagnosis?.topIssues) && runDiagnosis.topIssues.length > 0
    ? runDiagnosis.topIssues[0]
    : null;
  if (!runDiagnosis || !issue) return null;
  return {
    audit_date_et: String(auditDoc?.date_et || "").trim() || null,
    status: String(runDiagnosis.status || "").trim() || "green",
    root_cause: String(issue.issueCode || runDiagnosis.primaryRootCause || "unknown").trim() || "unknown",
    severity: String(issue.severity || "low").trim() || "low",
    confidence: roundNumber(issue.confidence, 2),
    recommended_action: String(issue.recommendedAction || getActionPair(issue.issueCode || "unknown").recommendedAction),
    recommended_non_action: String(issue.recommendedNonAction || getActionPair(issue.issueCode || "unknown").recommendedNonAction),
  };
}

module.exports = {
  ROOT_CAUSE_ACTIONS,
  RUN_ROOT_CAUSES,
  TOPIC_ROOT_CAUSES,
  attachDiagnosisToAuditDocument,
  buildProductBlockerFromAuditDoc,
  buildRunEvidence,
  countTopicPrimaryCauses,
  deriveRunDiagnosis,
  deriveTopicDiagnosis,
  mapTopicCauseToRunCause,
};
