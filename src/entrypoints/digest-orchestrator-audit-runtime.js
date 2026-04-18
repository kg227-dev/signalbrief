"use strict";

const { attachDiagnosisToAuditDocument } = require("../runtime/root-cause-diagnosis-runtime");

function sanitizeCountMap(rawCounts) {
  const sanitized = Object.create(null);
  const entries = rawCounts && typeof rawCounts === "object" ? Object.entries(rawCounts) : [];
  for (const [key, value] of entries) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = Number(value);
    if (!normalizedKey || !Number.isFinite(normalizedValue) || normalizedValue <= 0) continue;
    sanitized[normalizedKey] = normalizedValue;
  }
  return sanitized;
}

function uniqTrimmed(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function cloneJsonValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeAuditCandidate(candidate, selectedFallback = false) {
  const selected = candidate?.selected === true || selectedFallback === true;
  const selectionReason = selected
    ? null
    : String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
  const strictQuality = candidate?.strict_quality && typeof candidate.strict_quality === "object"
    ? cloneJsonValue(candidate.strict_quality)
    : null;
  return {
    headline: String(candidate?.headline || "").slice(0, 160),
    url: String(candidate?.url || ""),
    source: String(candidate?.source || ""),
    source_domain: String(candidate?.source_domain || ""),
    source_tier: candidate?.source_tier ?? null,
    source_type: String(candidate?.source_type || ""),
    source_authority: Number.isFinite(Number(candidate?.source_authority)) ? Number(candidate.source_authority) : null,
    lane: String(candidate?.lane || ""),
    ranking_version: candidate?.ranking_version || null,
    _score: candidate?._score ?? null,
    _score_components: candidate?._score_components ?? null,
    final_rank_score: Number.isFinite(Number(candidate?.final_rank_score)) ? Number(candidate.final_rank_score) : null,
    final_rank_components: candidate?.final_rank_components && typeof candidate.final_rank_components === "object"
      ? cloneJsonValue(candidate.final_rank_components)
      : null,
    story_quality_score: Number.isFinite(Number(candidate?.story_quality_score)) ? Number(candidate.story_quality_score) : null,
    story_quality_components: candidate?.story_quality_components && typeof candidate.story_quality_components === "object"
      ? cloneJsonValue(candidate.story_quality_components)
      : null,
    source_authority_score: Number.isFinite(Number(candidate?.source_authority_score)) ? Number(candidate.source_authority_score) : null,
    freshness_score: Number.isFinite(Number(candidate?.freshness_score)) ? Number(candidate.freshness_score) : null,
    novelty_score: Number.isFinite(Number(candidate?.novelty_score)) ? Number(candidate.novelty_score) : null,
    soft_penalties: candidate?.soft_penalties && typeof candidate.soft_penalties === "object"
      ? cloneJsonValue(candidate.soft_penalties)
      : null,
    dynamic_source_penalty: Number.isFinite(Number(candidate?.dynamic_source_penalty)) ? Number(candidate.dynamic_source_penalty) : null,
    tie_break_outcome: candidate?.tie_break_outcome || null,
    cluster_rep_selected_by_final_rank_score: candidate?.cluster_rep_selected_by_final_rank_score === true,
    _story_relationship: candidate?._story_relationship ?? "new",
    storyline_key: String(candidate?.storyline_key || "").trim() || null,
    cross_source_count: Number.isFinite(Number(candidate?.cross_source_count)) ? Number(candidate.cross_source_count) : null,
    cluster_size: Number.isFinite(Number(candidate?.cluster_size)) ? Number(candidate.cluster_size) : null,
    cluster_density: Number.isFinite(Number(candidate?.cluster_density)) ? Number(candidate.cluster_density) : null,
    cluster_score_variance: Number.isFinite(Number(candidate?.cluster_score_variance)) ? Number(candidate.cluster_score_variance) : null,
    published_at: String(candidate?.published_at || "").trim() || null,
    freshness_hours: Number.isFinite(Number(candidate?.freshness_hours)) ? Number(candidate.freshness_hours) : null,
    content_flags: Array.isArray(candidate?.content_flags) ? candidate.content_flags.slice() : [],
    event_markers: Array.isArray(candidate?.event_markers) ? candidate.event_markers.slice() : [],
    entity_keys: Array.isArray(candidate?.entity_keys) ? candidate.entity_keys.slice() : [],
    selected,
    selection_reason: selectionReason,
    writeup_status: candidate?.writeup_status || null,
    writeup_attempt_count: Number.isFinite(Number(candidate?.writeup_attempt_count)) ? Number(candidate.writeup_attempt_count) : null,
    writeup_rejection_reasons: Array.isArray(candidate?.writeup_rejection_reasons) ? candidate.writeup_rejection_reasons.slice() : [],
    writeup_version: candidate?.writeup_version || null,
    strict_quality: strictQuality,
    quality_rule_results: Array.isArray(candidate?.quality_rule_results) ? cloneJsonValue(candidate.quality_rule_results) : [],
    rejected_rule: candidate?.rejected_rule || strictQuality?.rejected_rule || null,
    rejected_reason: candidate?.rejected_reason || strictQuality?.rejected_reason || null,
    exception_used: candidate?.exception_used === true || strictQuality?.exception_used === true,
    exception_reason: candidate?.exception_reason || strictQuality?.exception_reason || null,
    follow_up_allowed: candidate?.follow_up_allowed === true || strictQuality?.follow_up_allowed === true,
    inclusion_reason: candidate?.inclusion_reason || strictQuality?.inclusion_reason || null,
    major_story_candidate: candidate?.major_story_candidate === true || strictQuality?.major_story_candidate === true,
    major_story_block_reason: candidate?.major_story_block_reason || strictQuality?.major_story_block_reason || null,
    strategic_relevance: candidate?.strategic_relevance || null,
    strategic_relevance_reason: candidate?.strategic_relevance_reason
      ? String(candidate.strategic_relevance_reason).slice(0, 120)
      : null,
    duplicate_of: candidate?.duplicate_of ? String(candidate.duplicate_of) : null,
    v1_selected: candidate?.v1_selected === true,
    v2_selected: candidate?.v2_selected === true,
    selection_disagreement_reason: candidate?.selection_disagreement_reason || null,
    v2_regret_flag: candidate?.v2_regret_flag === true,
    v2_regret_reason: candidate?.v2_regret_reason || null,
    top1_changed: candidate?.top1_changed === true,
    kill_switch_triggered: candidate?.kill_switch_triggered === true,
    kill_switch_reasons: Array.isArray(candidate?.kill_switch_reasons) ? candidate.kill_switch_reasons.slice() : [],
  };
}

function normalizeAuditSourceTier(rawTier) {
  const numericTier = Number(rawTier);
  if (numericTier === 1 || numericTier === 2 || numericTier === 3) return numericTier;
  return null;
}

function buildTopicMissedStoryFlags(candidates = []) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const selectedScores = rows
    .filter((candidate) => candidate?.selected === true)
    .map((candidate) => Number(candidate?._score))
    .filter((value) => Number.isFinite(value));
  const selectedFloor = selectedScores.length > 0 ? Math.min(...selectedScores) : 0.65;
  return rows
    .filter((candidate) => candidate?.selected !== true)
    .map((candidate) => {
      const score = Number(candidate?._score);
      const tier = normalizeAuditSourceTier(candidate?.source_tier);
      const lane = String(candidate?.lane || "").trim().toLowerCase();
      const selectionReason = String(candidate?.selection_reason || "").trim() || "selection_not_selected";
      const sourceAuthority = Number(candidate?.source_authority || 0);
      const crossSourceCount = Number(candidate?.cross_source_count || 0);
      const sourceType = String(candidate?.source_type || "").trim().toLowerCase();
      const scoreNearSelected = Number.isFinite(score) && score >= Math.max(0.55, selectedFloor - 0.05);
      const highTierSource = tier != null && tier <= 2;
      const officialPrimary = sourceType === "primary_official" || lane.includes("official");
      const multiSource = crossSourceCount >= 2;
      const sourceCapBlocked = selectionReason.startsWith("selection_source_cap");
      const poolBlocked = selectionReason === "selection_pool_full" || selectionReason === "selection_not_selected";
      if (!scoreNearSelected) return null;
      if (!(highTierSource || officialPrimary || multiSource || sourceAuthority >= 0.58)) return null;
      if (!(sourceCapBlocked || poolBlocked || selectionReason === "selection_discovery_cap")) return null;
      const signals = [];
      if (highTierSource) signals.push(`tier_${tier}_source`);
      if (officialPrimary) signals.push("official_primary");
      if (multiSource) signals.push("multi_source");
      if (sourceAuthority >= 0.58) signals.push("strong_authority");
      if (sourceCapBlocked) signals.push("source_cap_blocked");
      if (selectionReason === "selection_discovery_cap") signals.push("discovery_cap_blocked");
      if (poolBlocked) signals.push("pool_cut");
      return {
        headline: candidate.headline,
        url: candidate.url,
        source: candidate.source,
        source_tier: candidate.source_tier ?? null,
        lane: candidate.lane,
        _score: Number.isFinite(score) ? Number(score.toFixed(3)) : null,
        selection_reason: selectionReason,
        signals,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(right?._score || 0) - Number(left?._score || 0))
    .slice(0, 3);
}

function buildTopicSummariesFromSelectionDiagnostics(selectionDiagnostics, selectedUrls) {
  const detailedTopics = Array.isArray(selectionDiagnostics?.topic_selection_audit)
    ? selectionDiagnostics.topic_selection_audit
    : [];
  if (detailedTopics.length > 0) {
    const summaries = Object.create(null);
    for (const topic of detailedTopics) {
      const tag = String(topic?.tag || "").trim().toUpperCase() || "__untagged__";
      const candidates = (Array.isArray(topic?.candidates) ? topic.candidates : []).map((candidate) => {
        return sanitizeAuditCandidate(candidate, selectedUrls.has(String(candidate?.url || "").trim()));
      });
      const fallbackLaneCounts = Object.create(null);
      const fallbackReasonCounts = Object.create(null);
      for (const candidate of candidates) {
        const lane = String(candidate?.lane || "unknown").trim() || "unknown";
        fallbackLaneCounts[lane] = (fallbackLaneCounts[lane] || 0) + 1;
        if (candidate.selected !== true) {
          const reason = String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
          fallbackReasonCounts[reason] = (fallbackReasonCounts[reason] || 0) + 1;
        }
      }
      const laneBreakdown = sanitizeCountMap(topic?.lane_breakdown);
      const rejectionReasonCounts = sanitizeCountMap(topic?.rejection_reason_counts);
      summaries[tag] = {
        total_candidates: Number(topic?.total_candidates || candidates.length),
        selected_count: Number(topic?.selected_count || candidates.filter((candidate) => candidate.selected === true).length),
        rejected_count: Number(topic?.rejected_count || Math.max(0, candidates.length - candidates.filter((candidate) => candidate.selected === true).length)),
        tier_counts: sanitizeCountMap(topic?.tier_counts),
        lane_breakdown: Object.keys(laneBreakdown).length > 0 ? laneBreakdown : fallbackLaneCounts,
        rejection_reason_counts: Object.keys(rejectionReasonCounts).length > 0 ? rejectionReasonCounts : fallbackReasonCounts,
        missed_story_flags: buildTopicMissedStoryFlags(candidates),
        writeup: topic?.writeup && typeof topic.writeup === "object"
          ? cloneJsonValue(topic.writeup)
          : null,
        strict_quality: topic?.strict_quality && typeof topic.strict_quality === "object"
          ? cloneJsonValue(topic.strict_quality)
          : null,
        ranking_primary_version: topic?.ranking_primary_version || null,
        ranking_live_version: topic?.ranking_live_version || null,
        ranking_shadow_version: topic?.ranking_shadow_version || null,
        selection_overlap_pct: Number.isFinite(Number(topic?.selection_overlap_pct)) ? Number(topic.selection_overlap_pct) : null,
        trusted_share_pct_v1: Number.isFinite(Number(topic?.trusted_share_pct_v1)) ? Number(topic.trusted_share_pct_v1) : null,
        trusted_share_pct_v2: Number.isFinite(Number(topic?.trusted_share_pct_v2)) ? Number(topic.trusted_share_pct_v2) : null,
        trusted_share_delta_pct: Number.isFinite(Number(topic?.trusted_share_delta_pct)) ? Number(topic.trusted_share_delta_pct) : null,
        avg_final_rank_v1_selected: Number.isFinite(Number(topic?.avg_final_rank_v1_selected)) ? Number(topic.avg_final_rank_v1_selected) : null,
        avg_final_rank_v2_selected: Number.isFinite(Number(topic?.avg_final_rank_v2_selected)) ? Number(topic.avg_final_rank_v2_selected) : null,
        avg_final_rank_delta: Number.isFinite(Number(topic?.avg_final_rank_delta)) ? Number(topic.avg_final_rank_delta) : null,
        top1_changed: topic?.top1_changed === true,
        kill_switch_triggered: topic?.kill_switch_triggered === true,
        kill_switch_reasons: Array.isArray(topic?.kill_switch_reasons) ? topic.kill_switch_reasons.slice() : [],
        regret_flag_count: Number(topic?.regret_flag_count || 0),
        regret_reason_counts: sanitizeCountMap(topic?.regret_reason_counts),
        candidates,
      };
    }
    return summaries;
  }

  const byTag = Object.create(null);
  for (const candidate of (Array.isArray(selectionDiagnostics?.scored_candidates) ? selectionDiagnostics.scored_candidates : [])) {
    const tag = String(candidate?.tag || "").trim().toUpperCase() || "__untagged__";
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(sanitizeAuditCandidate(candidate, selectedUrls.has(String(candidate?.url || "").trim())));
  }

  const summaries = Object.create(null);
  for (const [tag, candidates] of Object.entries(byTag)) {
    const laneCounts = Object.create(null);
    const rejectionReasonCounts = Object.create(null);
    for (const candidate of candidates) {
      const lane = String(candidate?.lane || "unknown").trim() || "unknown";
      laneCounts[lane] = (laneCounts[lane] || 0) + 1;
      if (candidate.selected !== true) {
        const reason = String(candidate?.selection_reason || "selection_not_selected").trim() || "selection_not_selected";
        rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1;
      }
    }
    summaries[tag] = {
      total_candidates: candidates.length,
      selected_count: candidates.filter((candidate) => candidate.selected === true).length,
      rejected_count: candidates.filter((candidate) => candidate.selected !== true).length,
      tier_counts: {},
      lane_breakdown: laneCounts,
      rejection_reason_counts: rejectionReasonCounts,
      missed_story_flags: buildTopicMissedStoryFlags(candidates),
      candidates,
    };
  }
  return summaries;
}

function serializeFetchTopicDiagnostics(fetchDiagnostics) {
  return (Array.isArray(fetchDiagnostics?.topic_diagnostics) ? fetchDiagnostics.topic_diagnostics : []).map((topic) => ({
    tag: String(topic?.tag || "").trim().toUpperCase() || null,
    coverage_status: String(topic?.coverage_status || "").trim() || null,
    unique_item_count: Number(topic?.unique_item_count || 0),
    usable_item_count: Number(topic?.usable_item_count || 0),
    query_count: Number(topic?.query_count || 0),
    preferred_call_count: Number(topic?.preferred_call_count || 0),
    broad_call_count: Number(topic?.broad_call_count || 0),
    trusted_source_call_count: Number(topic?.trusted_source_call_count || 0),
    trusted_official_call_count: Number(topic?.trusted_official_call_count || 0),
    trusted_reported_call_count: Number(topic?.trusted_reported_call_count || 0),
    broker_item_count: Number(topic?.broker_item_count || 0),
    broker_official_item_count: Number(topic?.broker_official_item_count || 0),
    broker_publisher_feed_item_count: Number(topic?.broker_publisher_feed_item_count || 0),
    discovery_item_count: Number(topic?.discovery_item_count || 0),
    discovery_capped_count: Number(topic?.discovery_capped_count || 0),
    discovery_candidate_share_pct: Number(topic?.discovery_candidate_share_pct || 0),
    broker_candidate_share_pct: Number(topic?.broker_candidate_share_pct || 0),
    total_calls_scheduled: Number(topic?.total_calls_scheduled || 0),
    status_counts: sanitizeCountMap(topic?.status_counts),
    failed_calls: Number(topic?.failed_calls || 0),
    transport_errors: Number(topic?.transport_errors || 0),
    degraded: topic?.degraded === true,
    last_error: String(topic?.last_error || "").trim() || null,
  }));
}

function serializeBrokerDiagnostics(fetchDiagnostics) {
  const broker = fetchDiagnostics?.standard_topic_broker;
  if (!broker || typeof broker !== "object") {
    return {
      enabled: false,
      config_source: "none",
      active_topic_tags: [],
      lane_counts: {},
      source_fetch_count: 0,
      source_success_count: 0,
      source_failure_count: 0,
      source_diagnostics: [],
      topic_diagnostics: [],
    };
  }
  return {
    enabled: broker.enabled === true,
    config_source: String(broker.config_source || "").trim() || "none",
    active_topic_tags: uniqTrimmed(broker.active_topic_tags),
    lane_counts: sanitizeCountMap(broker.lane_counts),
    source_fetch_count: Number(broker.source_fetch_count || 0),
    source_success_count: Number(broker.source_success_count || 0),
    source_failure_count: Number(broker.source_failure_count || 0),
    source_diagnostics: (Array.isArray(broker.source_diagnostics) ? broker.source_diagnostics : []).map((source) => ({
      id: String(source?.id || "").trim() || null,
      lane: String(source?.lane || "").trim() || null,
      topic_tags: uniqTrimmed(source?.topic_tags),
      endpoint: String(source?.endpoint || "").trim() || null,
      ok: source?.ok === true,
      status: Number(source?.status || 0),
      parsed_count: Number(source?.parsed_count || 0),
      retained_count: Number(source?.retained_count || 0),
      stale_count: Number(source?.stale_count || 0),
      non_article_count: Number(source?.non_article_count || 0),
      validation_drop_count: Number(source?.validation_drop_count || 0),
      error: String(source?.error || "").trim() || null,
    })),
    topic_diagnostics: (Array.isArray(broker.topic_diagnostics) ? broker.topic_diagnostics : []).map((topic) => ({
      tag: String(topic?.tag || "").trim().toUpperCase() || null,
      lane_counts: sanitizeCountMap(topic?.lane_counts),
      source_counts: sanitizeCountMap(topic?.source_counts),
      source_ids: uniqTrimmed(topic?.source_ids),
      item_count: Number(topic?.item_count || 0),
      article_item_count: Number(topic?.article_item_count || 0),
      official_document_count: Number(topic?.official_document_count || 0),
      errors: (Array.isArray(topic?.errors) ? topic.errors : []).map((error) => ({
        source_id: String(error?.source_id || "").trim() || null,
        error: String(error?.error || "").trim() || null,
      })),
    })),
  };
}

function buildDigestAuditDocument({ digestDateKey, runId, runMode, selected, selectionDiagnostics, fetchDiagnostics, enrichmentDiagnostics }) {
  const selectedUrls = new Set(
    (Array.isArray(selected) ? selected : []).map((item) => String(item?.url || "").trim()).filter(Boolean)
  );
  const topicSummaries = buildTopicSummariesFromSelectionDiagnostics(selectionDiagnostics, selectedUrls);
  const globalLaneCounts = Object.create(null);
  for (const topic of Object.values(topicSummaries)) {
    for (const [lane, count] of Object.entries(topic.lane_breakdown || {})) {
      globalLaneCounts[lane] = (globalLaneCounts[lane] || 0) + count;
    }
  }
  const missedStoryFlagCount = Object.values(topicSummaries).reduce((sum, topic) => {
    return sum + Math.max(0, Number(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0));
  }, 0);
  const writeupSummary = selectionDiagnostics?.writeup && typeof selectionDiagnostics.writeup === "object"
    ? cloneJsonValue(selectionDiagnostics.writeup)
    : null;

  return attachDiagnosisToAuditDocument({
    run_id: runId || null,
    date_et: digestDateKey,
    mode: runMode,
    generated_at: new Date().toISOString(),
    summary: {
      total_candidates: Number(selectionDiagnostics?.candidate_pool_scored || 0),
      total_selected: selectedUrls.size,
      candidate_pool_before_dedup: Number(selectionDiagnostics?.candidate_pool_before_dedup || 0),
      candidate_pool_after_editorial: Number(selectionDiagnostics?.candidate_pool_after_editorial || 0),
      candidate_pool_after_archive_dedup: Number(selectionDiagnostics?.candidate_pool_after_archive_dedup || 0),
      candidate_pool_after_freshness: Number(selectionDiagnostics?.candidate_pool_after_freshness || 0),
      candidate_pool_after_history: Number(selectionDiagnostics?.candidate_pool_after_history || 0),
      candidate_pool_after_story_relationship: Number(selectionDiagnostics?.candidate_pool_after_story_relationship || 0),
      candidate_pool_after_dedup: Number(selectionDiagnostics?.candidate_pool_after_dedup || 0),
      dedup_removed: Number(selectionDiagnostics?.archive_repeat_block_count || 0),
      stale_removed: Number(selectionDiagnostics?.stale_removed_count || 0),
      history_suppressed: Number(selectionDiagnostics?.history_suppressed_count || 0),
      editorial_excluded: Number(selectionDiagnostics?.editorial_excluded_count || 0),
      editorial_domain_suppressed: Number(selectionDiagnostics?.editorial_domain_suppressed_count || 0),
      editorial_pins_injected: Number(selectionDiagnostics?.editorial_pin_count || 0),
      continuation_removed: Number(selectionDiagnostics?.story_relationship_continuation_removed || 0),
      follow_up_count: Number(selectionDiagnostics?.story_relationship_follow_up_count || 0),
      discovery_capped: Number(selectionDiagnostics?.discovery_capped_count || 0),
      selection_rejection_counts: sanitizeCountMap(selectionDiagnostics?.selection_rejection_counts),
      score_top: selectionDiagnostics?.score_top ?? null,
      score_bottom: selectionDiagnostics?.score_bottom ?? null,
      global_lane_breakdown: globalLaneCounts,
      missed_story_flag_count: missedStoryFlagCount,
      writeup: writeupSummary,
      strict_quality: selectionDiagnostics?.strict_quality && typeof selectionDiagnostics.strict_quality === "object"
        ? cloneJsonValue(selectionDiagnostics.strict_quality)
        : null,
      broker_saturated_topics: Array.isArray(fetchDiagnostics?.topic_diagnostics)
        ? fetchDiagnostics.topic_diagnostics.filter((topic) => Number(topic?.broker_item_count || 0) >= 10).length
        : 0,
    },
    topics: topicSummaries,
    fetch: {
      broker_candidate_count: Number(fetchDiagnostics?.broker_candidate_count || 0),
      discovery_candidate_count: Number(fetchDiagnostics?.discovery_candidate_count || 0),
      discovery_candidate_cap_count: Number(fetchDiagnostics?.discovery_candidate_cap_count || 0),
      discovery_candidate_capped_count: Number(fetchDiagnostics?.discovery_candidate_capped_count || 0),
      broker_candidate_share_pct: Number(fetchDiagnostics?.broker_candidate_share_pct || 0),
      discovery_candidate_share_pct: Number(fetchDiagnostics?.discovery_candidate_share_pct || 0),
      max_discovery_candidate_share_pct: Number(fetchDiagnostics?.max_discovery_candidate_share_pct || 0),
      retrieval_origin_counts: sanitizeCountMap(fetchDiagnostics?.retrieval_origin_counts),
      topic_diagnostics: serializeFetchTopicDiagnostics(fetchDiagnostics),
      standard_topic_broker: serializeBrokerDiagnostics(fetchDiagnostics),
      discovery_fetch_items: Array.isArray(fetchDiagnostics?.discovery_fetch_items)
        ? fetchDiagnostics.discovery_fetch_items
        : [],
      broker_fetch_items: Array.isArray(fetchDiagnostics?.broker_fetch_items)
        ? fetchDiagnostics.broker_fetch_items
        : [],
    },
    selectionDiagnostics: {
      editorial_dropped_items: Array.isArray(selectionDiagnostics?.editorial_dropped_items)
        ? selectionDiagnostics.editorial_dropped_items
        : [],
      archive_dedup_dropped_items: Array.isArray(selectionDiagnostics?.archive_dedup_dropped_items)
        ? selectionDiagnostics.archive_dedup_dropped_items
        : [],
      freshness_dropped_items: Array.isArray(selectionDiagnostics?.freshness_dropped_items)
        ? selectionDiagnostics.freshness_dropped_items
        : [],
      story_dedup_dropped_items: Array.isArray(selectionDiagnostics?.story_dedup_dropped_items)
        ? selectionDiagnostics.story_dedup_dropped_items
        : [],
      classifier_dropped_items: selectionDiagnostics?.classifier_dropped_items === null
        ? null
        : Array.isArray(selectionDiagnostics?.classifier_dropped_items)
          ? selectionDiagnostics.classifier_dropped_items
          : null,
    },
    enrichmentDiagnostics: {
      item_outcomes: Array.isArray(enrichmentDiagnostics?.item_outcomes)
        ? enrichmentDiagnostics.item_outcomes
        : [],
      writeup_failure_details: Array.isArray(enrichmentDiagnostics?.writeup_failure_details)
        ? enrichmentDiagnostics.writeup_failure_details
        : [],
    },
  });
}

function replaceTopicDiagnostic(topicDiagnostics, nextTopicDiagnostic) {
  const diagnostics = Array.isArray(topicDiagnostics) ? topicDiagnostics.slice() : [];
  const tag = String(nextTopicDiagnostic?.tag || "").trim().toUpperCase();
  if (!tag) return diagnostics;
  const filtered = diagnostics.filter((topic) => String(topic?.tag || "").trim().toUpperCase() !== tag);
  filtered.push(nextTopicDiagnostic);
  filtered.sort((left, right) => String(left?.tag || "").localeCompare(String(right?.tag || "")));
  return filtered;
}

function recomputeDigestAuditRollups(auditDoc) {
  const doc = auditDoc && typeof auditDoc === "object" ? auditDoc : {};
  const topics = doc.topics && typeof doc.topics === "object" ? doc.topics : {};
  const topicList = Object.values(topics);
  const globalLaneBreakdown = Object.create(null);
  const selectionRejectionCounts = Object.create(null);
  let totalCandidates = 0;
  let totalSelected = 0;
  let missedStoryFlagCount = 0;
  let blockedTopicBucketCount = 0;

  for (const topic of topicList) {
    totalCandidates += Number(topic?.total_candidates || 0);
    totalSelected += Number(topic?.selected_count || 0);
    missedStoryFlagCount += Math.max(0, Number(Array.isArray(topic?.missed_story_flags) ? topic.missed_story_flags.length : 0));
    if (topic?.strict_quality?.pass === false) blockedTopicBucketCount += 1;
    for (const [lane, count] of Object.entries(topic?.lane_breakdown || {})) {
      globalLaneBreakdown[lane] = (globalLaneBreakdown[lane] || 0) + Number(count || 0);
    }
    for (const [reason, count] of Object.entries(topic?.rejection_reason_counts || {})) {
      selectionRejectionCounts[reason] = (selectionRejectionCounts[reason] || 0) + Number(count || 0);
    }
  }

  doc.summary = {
    ...(doc.summary && typeof doc.summary === "object" ? doc.summary : {}),
    total_candidates: totalCandidates,
    total_selected: totalSelected,
    global_lane_breakdown: globalLaneBreakdown,
    selection_rejection_counts: selectionRejectionCounts,
    discovery_capped: Number(selectionRejectionCounts.selection_discovery_cap || 0),
    missed_story_flag_count: missedStoryFlagCount,
    blocked_topic_bucket_count: blockedTopicBucketCount,
  };

  const fetch = doc.fetch && typeof doc.fetch === "object" ? doc.fetch : {};
  const topicDiagnostics = Array.isArray(fetch.topic_diagnostics) ? fetch.topic_diagnostics : [];
  const brokerCandidateCount = topicDiagnostics.reduce((sum, topic) => sum + Number(topic?.broker_item_count || 0), 0);
  const discoveryCandidateCount = topicDiagnostics.reduce((sum, topic) => sum + Number(topic?.discovery_item_count || 0), 0);
  const discoveryCandidateCappedCount = topicDiagnostics.reduce((sum, topic) => sum + Number(topic?.discovery_capped_count || 0), 0);
  const totalCandidateCount = brokerCandidateCount + discoveryCandidateCount;
  doc.fetch = {
    ...fetch,
    broker_candidate_count: brokerCandidateCount,
    discovery_candidate_count: discoveryCandidateCount,
    discovery_candidate_capped_count: discoveryCandidateCappedCount,
    broker_candidate_share_pct: totalCandidateCount > 0
      ? Number(((brokerCandidateCount / totalCandidateCount) * 100).toFixed(2))
      : 0,
    discovery_candidate_share_pct: totalCandidateCount > 0
      ? Number(((discoveryCandidateCount / totalCandidateCount) * 100).toFixed(2))
      : 0,
  };
  return attachDiagnosisToAuditDocument(doc);
}

function mergeTopicAuditDocument(existingDoc, freshDoc, mergeTopicTag) {
  const tag = String(mergeTopicTag || "").trim().toUpperCase();
  if (!tag) return freshDoc;
  const merged = existingDoc && typeof existingDoc === "object"
    ? cloneJsonValue(existingDoc)
    : { date_et: freshDoc?.date_et || null, topics: {}, fetch: {}, summary: {} };
  const freshTopic = freshDoc?.topics && typeof freshDoc.topics === "object"
    ? (freshDoc.topics[tag] || null)
    : null;
  if (!freshTopic) return freshDoc;

  merged.run_id = freshDoc?.run_id || merged.run_id || null;
  merged.date_et = freshDoc?.date_et || merged.date_et || null;
  merged.mode = freshDoc?.mode || merged.mode || null;
  merged.generated_at = freshDoc?.generated_at || new Date().toISOString();
  merged.topics = {
    ...(merged.topics && typeof merged.topics === "object" ? merged.topics : {}),
    [tag]: freshTopic,
  };

  const freshFetch = freshDoc?.fetch && typeof freshDoc.fetch === "object" ? freshDoc.fetch : {};
  const existingFetch = merged.fetch && typeof merged.fetch === "object" ? merged.fetch : {};
  const freshTopicDiagnostic = (Array.isArray(freshFetch.topic_diagnostics) ? freshFetch.topic_diagnostics : [])
    .find((topic) => String(topic?.tag || "").trim().toUpperCase() === tag);
  const existingBroker = existingFetch.standard_topic_broker && typeof existingFetch.standard_topic_broker === "object"
    ? existingFetch.standard_topic_broker
    : {};
  const freshBroker = freshFetch.standard_topic_broker && typeof freshFetch.standard_topic_broker === "object"
    ? freshFetch.standard_topic_broker
    : {};
  const freshBrokerTopicDiagnostic = (Array.isArray(freshBroker.topic_diagnostics) ? freshBroker.topic_diagnostics : [])
    .find((topic) => String(topic?.tag || "").trim().toUpperCase() === tag);

  function mergeFetchItemArray(existingArr, freshArr) {
    const existing = Array.isArray(existingArr)
      ? existingArr.filter((row) => String(row?.topic || "").toUpperCase() !== tag) : [];
    const fresh = Array.isArray(freshArr) ? freshArr : [];
    return existing.concat(fresh);
  }

  merged.fetch = {
    ...existingFetch,
    max_discovery_candidate_share_pct: freshFetch.max_discovery_candidate_share_pct ?? existingFetch.max_discovery_candidate_share_pct ?? 0,
    retrieval_origin_counts: sanitizeCountMap(existingFetch.retrieval_origin_counts),
    topic_diagnostics: freshTopicDiagnostic
      ? replaceTopicDiagnostic(existingFetch.topic_diagnostics, freshTopicDiagnostic)
      : (Array.isArray(existingFetch.topic_diagnostics) ? existingFetch.topic_diagnostics : []),
    standard_topic_broker: {
      ...existingBroker,
      topic_diagnostics: freshBrokerTopicDiagnostic
        ? replaceTopicDiagnostic(existingBroker.topic_diagnostics, freshBrokerTopicDiagnostic)
        : (Array.isArray(existingBroker.topic_diagnostics) ? existingBroker.topic_diagnostics : []),
      last_topic_rerun: {
        tag,
        run_id: freshDoc?.run_id || null,
        refreshed_at: freshDoc?.generated_at || new Date().toISOString(),
      },
    },
    broker_fetch_items: mergeFetchItemArray(existingFetch.broker_fetch_items, freshFetch.broker_fetch_items),
    discovery_fetch_items: mergeFetchItemArray(existingFetch.discovery_fetch_items, freshFetch.discovery_fetch_items),
  };

  const priorRefreshes = Array.isArray(merged.partial_refreshes) ? merged.partial_refreshes : [];
  const nextRefresh = {
    tag,
    mode: freshDoc?.mode || "admin_topic_audit_rerun",
    run_id: freshDoc?.run_id || null,
    refreshed_at: freshDoc?.generated_at || new Date().toISOString(),
  };
  merged.partial_refreshes = priorRefreshes
    .filter((entry) => String(entry?.tag || "").trim().toUpperCase() !== tag)
    .concat(nextRefresh)
    .slice(-20);
  merged.partial_refresh = nextRefresh;

  const existingSD = merged.selectionDiagnostics && typeof merged.selectionDiagnostics === "object"
    ? merged.selectionDiagnostics : {};
  const freshSD = freshDoc?.selectionDiagnostics && typeof freshDoc.selectionDiagnostics === "object"
    ? freshDoc.selectionDiagnostics : {};
  function mergeDropArray(existingArr, freshArr) {
    const existing = Array.isArray(existingArr)
      ? existingArr.filter((row) => String(row?.topic || "").toUpperCase() !== tag) : [];
    const fresh = Array.isArray(freshArr) ? freshArr : [];
    return existing.concat(fresh);
  }
  merged.selectionDiagnostics = {
    editorial_dropped_items: mergeDropArray(existingSD.editorial_dropped_items, freshSD.editorial_dropped_items),
    archive_dedup_dropped_items: mergeDropArray(existingSD.archive_dedup_dropped_items, freshSD.archive_dedup_dropped_items),
    freshness_dropped_items: mergeDropArray(existingSD.freshness_dropped_items, freshSD.freshness_dropped_items),
    story_dedup_dropped_items: mergeDropArray(existingSD.story_dedup_dropped_items, freshSD.story_dedup_dropped_items),
    classifier_dropped_items: freshSD.classifier_dropped_items !== undefined
      ? freshSD.classifier_dropped_items !== null
        ? mergeDropArray(existingSD.classifier_dropped_items, freshSD.classifier_dropped_items)
        : (existingSD.classifier_dropped_items !== null ? existingSD.classifier_dropped_items : null)
      : (existingSD.classifier_dropped_items !== undefined ? existingSD.classifier_dropped_items : null),
  };

  return recomputeDigestAuditRollups(merged);
}

function createDigestOrchestratorAuditRuntime(deps) {
  const {
    fs,
    path,
    digestAuditDir,
    log = () => {},
  } = deps;

  function writeDigestAuditLog({
    digestDateKey,
    runId,
    runMode,
    selected,
    selectionDiagnostics,
    fetchDiagnostics,
    enrichmentDiagnostics,
    mergeTopicTag = "",
  }) {
    try {
      fs.mkdirSync(digestAuditDir, { recursive: true });
      const auditDoc = buildDigestAuditDocument({
        digestDateKey,
        runId,
        runMode,
        selected,
        selectionDiagnostics,
        fetchDiagnostics,
        enrichmentDiagnostics,
      });
      const normalizedMergeTopicTag = String(mergeTopicTag || "").trim().toUpperCase();
      const filePath = path.join(digestAuditDir, `${digestDateKey}.json`);
      let finalDoc = auditDoc;
      if (normalizedMergeTopicTag) {
        let existingDoc = null;
        try {
          existingDoc = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
        finalDoc = mergeTopicAuditDocument(existingDoc, auditDoc, normalizedMergeTopicTag);
      }
      fs.writeFileSync(filePath, JSON.stringify(finalDoc, null, 2), "utf8");
    } catch (err) {
      if (runMode === "scheduled") throw err;
      log(`Audit log write failed (non-fatal): ${String(err?.message || err)}`);
    }
  }

  return {
    buildDigestAuditDocument,
    recomputeDigestAuditRollups,
    mergeTopicAuditDocument,
    writeDigestAuditLog,
  };
}

module.exports = {
  buildDigestAuditDocument,
  recomputeDigestAuditRollups,
  mergeTopicAuditDocument,
  createDigestOrchestratorAuditRuntime,
};
