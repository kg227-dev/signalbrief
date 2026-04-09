"use strict";

const { normalizeDigestHeadlinePreview } = require("../digest/runtime/digest-headline-preview-runtime");

function buildQuickScanText(items, stripInlineHtml) {
  const strip = typeof stripInlineHtml === "function"
    ? stripInlineHtml
    : (value) => String(value || "");
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeDigestHeadlinePreview(strip(item?.headline || "")))
    .filter(Boolean)
    .join(" · ");
}

function buildDigestSnapshotItems(items, parseSourceDomain) {
  const parseDomain = typeof parseSourceDomain === "function"
    ? parseSourceDomain
    : () => null;
  return (Array.isArray(items) ? items : []).map((item, idx) => ({
    index: idx + 1,
    tag: item?.tag || null,
    headline: item?.headline || null,
    summary: item?.summary || null,
    signal_shift: item?.signal_shift || null,
    implication_type: item?.implication_type || null,
    wim_brief: item?.wim_brief || null,
    wim: item?.wim || null,
    implications: item?.implications || null,
    watch_next: item?.watch_next || null,
    writeup_status: item?.writeup_status || null,
    writeup_attempt_count: Number.isFinite(Number(item?.writeup_attempt_count)) ? Number(item.writeup_attempt_count) : null,
    writeup_rejection_reasons: Array.isArray(item?.writeup_rejection_reasons) ? item.writeup_rejection_reasons.slice() : [],
    writeup_version: item?.writeup_version || null,
    url: item?.url || null,
    source: item?.source || null,
    source_domain: item?.source_domain || parseDomain(item),
    source_platform: item?.source_platform || null,
    source_identity_key: item?.source_identity_key || null,
    source_identity_scope: item?.source_identity_scope || null,
    baseScore: Number.isFinite(Number(item?.baseScore)) ? Number(item.baseScore) : null,
    topicMatch: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
    relevanceScore: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
    why_shown: Array.isArray(item?.why_shown) ? item.why_shown.slice() : [],
    entity_keys: Array.isArray(item?.entity_keys) ? item.entity_keys.slice() : [],
    storyline_id: item?.storyline_id || null,
    storyline_key: item?.storyline_key || null,
    freshness_key: item?.freshness_key || null,
    storyline_size: Number.isFinite(Number(item?.storyline_size)) ? Number(item.storyline_size) : null,
    supporting_sources: Array.isArray(item?.supporting_sources) ? item.supporting_sources.slice() : [],
    supporting_headlines: Array.isArray(item?.supporting_headlines) ? item.supporting_headlines.slice() : [],
    cross_source_count: Number.isFinite(Number(item?.cross_source_count)) ? Number(item.cross_source_count) : null,
    content_flags: Array.isArray(item?.content_flags) ? item.content_flags.slice() : [],
    source_tier: item?.source_tier || null,
    source_authority: Number.isFinite(Number(item?.source_authority)) ? Number(item.source_authority) : null,
    preferred_source_match: item?.preferred_source_match || null,
    preferred_source_kind: item?.preferred_source_kind || null,
    preferred_source_match_scope: item?.preferred_source_match_scope || null,
    preferred_source_identity_key: item?.preferred_source_identity_key || null,
    preferred_source_available_in_search: item?.preferred_source_available_in_search === true,
    retrieval_pass: item?.retrieval_pass || null,
    retrieval_search_result_domains: Array.isArray(item?.retrieval_search_result_domains) ? item.retrieval_search_result_domains.slice(0, 10) : [],
    retrieval_preferred_search_domains: Array.isArray(item?.retrieval_preferred_search_domains) ? item.retrieval_preferred_search_domains.slice(0, 10) : [],
    won_by_preferred_substitute: item?.won_by_preferred_substitute === true,
    broader_retrieval_found_better: item?.broader_retrieval_found_better === true,
    source_identity_ambiguous: item?.source_identity_ambiguous === true,
    derivative_confidence: Number.isFinite(Number(item?.derivative_confidence)) ? Number(item.derivative_confidence) : null,
    derivative_reason_codes: Array.isArray(item?.derivative_reason_codes) ? item.derivative_reason_codes.slice() : [],
    derivative_parent_domain: item?.derivative_parent_domain || null,
    derivative_parent_identity_key: item?.derivative_parent_identity_key || null,
    suppression_reason_codes: Array.isArray(item?.suppression_reason_codes) ? item.suppression_reason_codes.slice() : [],
    selection_reason_codes: Array.isArray(item?.selection_reason_codes) ? item.selection_reason_codes.slice() : [],
    winner_selection_reason: item?.winner_selection_reason || null,
    coverage_gap_status: item?.coverage_gap_status || null,
    specialist_trade_outperformed_preferred: item?.specialist_trade_outperformed_preferred === true,
    strategic_value: Number.isFinite(Number(item?.strategic_value)) ? Number(item.strategic_value) : null,
    routine_item_score: Number.isFinite(Number(item?.routine_item_score)) ? Number(item.routine_item_score) : null,
    score_breakdown: item?.score_breakdown && typeof item.score_breakdown === "object"
      ? { ...item.score_breakdown }
      : null,
    strict_quality: item?.strict_quality && typeof item.strict_quality === "object"
      ? { ...item.strict_quality }
      : null,
    exception_used: item?.exception_used === true,
    exception_reason: item?.exception_reason || null,
    follow_up_allowed: item?.follow_up_allowed === true,
    inclusion_reason: item?.inclusion_reason || null,
  }));
}

function buildDeliveryDiagnosticsFields(deliveryDiagnostics = {}) {
  return {
    requested_count: deliveryDiagnostics.requested_count,
    freshness_block_count: deliveryDiagnostics.freshness_block_count,
    semantic_repeat_block_count: deliveryDiagnostics.semantic_repeat_block_count,
    alternate_queries_used: deliveryDiagnostics.alternate_queries_used,
    preferred_domains_count: deliveryDiagnostics.preferred_domains_count,
    preferred_candidate_count: deliveryDiagnostics.preferred_candidate_count,
    non_preferred_candidate_count: deliveryDiagnostics.non_preferred_candidate_count,
    final_selected_preferred_count: deliveryDiagnostics.final_selected_preferred_count,
    preferred_displaced_weak_count: deliveryDiagnostics.preferred_displaced_weak_count,
    derivative_suppressed_count: deliveryDiagnostics.derivative_suppressed_count,
    specialist_trade_beat_preferred_count: deliveryDiagnostics.specialist_trade_beat_preferred_count,
    platform_identity_ambiguity_count: deliveryDiagnostics.platform_identity_ambiguity_count,
    broader_retrieval_found_better_count: deliveryDiagnostics.broader_retrieval_found_better_count,
    coverage_gap_preferred_missing_count: deliveryDiagnostics.coverage_gap_preferred_missing_count,
    coverage_gap_preferred_weaker_count: deliveryDiagnostics.coverage_gap_preferred_weaker_count,
    search_budget_soft_calls: deliveryDiagnostics.search_budget_soft_calls,
    search_budget_hard_calls: deliveryDiagnostics.search_budget_hard_calls,
    search_budget_calls_used: deliveryDiagnostics.search_budget_calls_used,
    search_budget_exhausted: deliveryDiagnostics.search_budget_exhausted,
    broad_fallback_topics_used: deliveryDiagnostics.broad_fallback_topics_used,
    zero_yield_retry_count: deliveryDiagnostics.zero_yield_retry_count,
    budget_stop_reason: deliveryDiagnostics.budget_stop_reason,
    candidate_pool_before_dedup: deliveryDiagnostics.candidate_pool_before_dedup,
    candidate_pool_after_dedup: deliveryDiagnostics.candidate_pool_after_dedup,
    provider_429_count: deliveryDiagnostics.provider_429_count,
    provider_429_rate: deliveryDiagnostics.provider_429_rate,
    provider_transport_errors: deliveryDiagnostics.provider_transport_errors,
    provider_degraded: deliveryDiagnostics.provider_degraded,
    fallback_reason: deliveryDiagnostics.fallback_reason,
    refill_count: deliveryDiagnostics.refill_count,
    thin_pool: deliveryDiagnostics.thin_pool,
    dominant_failure_mode: deliveryDiagnostics.dominant_failure_mode,
    writeup_first_pass_success_count: deliveryDiagnostics.writeup_first_pass_success_count,
    writeup_first_pass_success_rate_pct: deliveryDiagnostics.writeup_first_pass_success_rate_pct,
    writeup_repair_attempted_count: deliveryDiagnostics.writeup_repair_attempted_count,
    writeup_repair_success_count: deliveryDiagnostics.writeup_repair_success_count,
    writeup_repair_pass_success_rate_pct: deliveryDiagnostics.writeup_repair_pass_success_rate_pct,
    writeup_drop_count: deliveryDiagnostics.writeup_drop_count,
    writeup_underfill_due_writeup_count: deliveryDiagnostics.writeup_underfill_due_writeup_count,
    writeup_repeated_phrase_rejection_count: deliveryDiagnostics.writeup_repeated_phrase_rejection_count,
    writeup_model_generated_count: deliveryDiagnostics.writeup_model_generated_count,
    writeup_model_generated_share_pct: deliveryDiagnostics.writeup_model_generated_share_pct,
    writeup_dropped_share_pct: deliveryDiagnostics.writeup_dropped_share_pct,
    writeup_allow_underfill_topic_tags: Array.isArray(deliveryDiagnostics.writeup_allow_underfill_topic_tags)
      ? deliveryDiagnostics.writeup_allow_underfill_topic_tags.slice()
      : [],
    surviving_topic_bucket_count: Number.isFinite(Number(deliveryDiagnostics.surviving_topic_bucket_count))
      ? Number(deliveryDiagnostics.surviving_topic_bucket_count)
      : null,
    strict_quality_exception_count: Number.isFinite(Number(deliveryDiagnostics.strict_quality_exception_count))
      ? Number(deliveryDiagnostics.strict_quality_exception_count)
      : null,
    extreme_underfill: deliveryDiagnostics.extreme_underfill === true,
    extreme_underfill_target_rate_pct: Number.isFinite(Number(deliveryDiagnostics.extreme_underfill_target_rate_pct))
      ? Number(deliveryDiagnostics.extreme_underfill_target_rate_pct)
      : null,
    blocked_topic_list: Array.isArray(deliveryDiagnostics.blocked_topic_list)
      ? deliveryDiagnostics.blocked_topic_list.map((row) => ({
          tag: row?.tag || null,
          reason: row?.reason || null,
        }))
      : [],
  };
}

function deliveryModeAttemptCount(user = {}) {
  const priorAttemptCount = Math.max(0, Number(user?.__digest_retry?.attempt_count || 0));
  return priorAttemptCount + 1;
}

function computeRemainingWindowMinutes(catchupWindowMinutes, prefs = {}, nowDate = new Date()) {
  const safeWindowMinutes = Math.max(30, Number(catchupWindowMinutes || 60));
  const [dh, dm] = String(prefs.delivery_time || "07:00").split(":").map(Number);
  const etNow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowDate).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = Number(part.value || 0);
    return acc;
  }, {});
  const nowMinutes = (Number(etNow.hour || 0) * 60) + Number(etNow.minute || 0);
  const userMinutes = (Number(dh || 0) * 60) + Number(dm || 0);
  let diff = nowMinutes - userMinutes;
  if (diff < -(12 * 60)) diff += 24 * 60;
  if (diff > (12 * 60)) diff -= 24 * 60;
  return safeWindowMinutes - Math.max(0, diff);
}

function getSubscribedStandardTopics(user) {
  return (Array.isArray(user?.topics) ? user.topics : [])
    .map((topic) => String(topic || "").trim())
    .filter((topic) => topic && !topic.startsWith("custom_"));
}

function getRequestedItemCount(subscribedStandardTopics, targetItemCount) {
  return Math.max(0, Array.isArray(subscribedStandardTopics) ? subscribedStandardTopics.length : 0)
    * Math.max(0, Number(targetItemCount || 0));
}

function filterItemsForSubscribedTopics(items, subscribedStandardTopics) {
  const allowed = new Set(Array.isArray(subscribedStandardTopics) ? subscribedStandardTopics : []);
  if (!allowed.size) return [];
  return (Array.isArray(items) ? items : []).filter((item) => allowed.has(String(item?.tag || "").trim()));
}

function filterTopicBucketsForSubscribedTopics(topicBuckets, subscribedStandardTopics) {
  const allowed = Array.isArray(subscribedStandardTopics) ? subscribedStandardTopics : [];
  const out = Object.create(null);
  for (const topic of allowed) {
    const normalizedTopic = String(topic || "").trim();
    if (!normalizedTopic) continue;
    out[normalizedTopic] = Array.isArray(topicBuckets?.[normalizedTopic])
      ? topicBuckets[normalizedTopic].slice()
      : [];
  }
  return out;
}

function groupFlatItemsByTopic(items = {}) {
  const grouped = Object.create(null);
  for (const item of (Array.isArray(items) ? items : [])) {
    const tag = String(item?.tag || "").trim().toUpperCase();
    if (!tag) continue;
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(item);
  }
  return grouped;
}

function flattenTopicBuckets(topicBuckets, subscribedStandardTopics) {
  const orderedTopics = Array.isArray(subscribedStandardTopics) ? subscribedStandardTopics : [];
  const flattened = [];
  for (const topic of orderedTopics) {
    flattened.push(...(Array.isArray(topicBuckets?.[topic]) ? topicBuckets[topic] : []));
  }
  return flattened;
}

function buildDeliverySelection(items, topicBuckets, requestedItemCount, incompleteTopics) {
  const selectedItems = Array.isArray(items) ? items : [];
  const deliveryEligible = requestedItemCount > 0 && Array.isArray(incompleteTopics) && incompleteTopics.length === 0;
  return {
    items: selectedItems,
    available_count: selectedItems.length,
    selected_count: selectedItems.length,
    delivery_eligible: deliveryEligible,
    topic_buckets: topicBuckets,
  };
}

function buildStrictDeliverySelection(assembly = {}) {
  const items = Array.isArray(assembly?.items) ? assembly.items.slice() : [];
  const topicBuckets = assembly?.topic_buckets && typeof assembly.topic_buckets === "object"
    ? Object.fromEntries(
        Object.entries(assembly.topic_buckets).map(([tag, bucketItems]) => [tag, Array.isArray(bucketItems) ? bucketItems.slice() : []])
      )
    : {};
  return {
    items,
    available_count: items.length,
    selected_count: items.length,
    delivery_eligible: assembly?.delivery_eligible === true,
    topic_buckets: topicBuckets,
    blocked_topics: Array.isArray(assembly?.blocked_topics) ? assembly.blocked_topics.slice() : [],
    surviving_topic_bucket_count: Math.max(0, Number(assembly?.surviving_topic_bucket_count || 0)),
    extreme_underfill: assembly?.extreme_underfill === true,
    strict_quality_exception_count: Math.max(0, Number(assembly?.total_exceptions_used || 0)),
    extreme_underfill_target_rate_pct: Number.isFinite(Number(assembly?.extreme_underfill_target_rate_pct))
      ? Number(assembly.extreme_underfill_target_rate_pct)
      : null,
  };
}

function listIncompleteTopics(topicBuckets, subscribedStandardTopics, opts = {}) {
  const minPerTopic = Math.max(1, Number(opts.minPerTopic || 1));
  const allowUnderfillTopics = new Set(
    (Array.isArray(opts.allowUnderfillTopicTags) ? opts.allowUnderfillTopicTags : [])
      .map((topic) => String(topic || "").trim())
      .filter(Boolean)
  );
  return (Array.isArray(subscribedStandardTopics) ? subscribedStandardTopics : []).filter((topic) => {
    const count = Array.isArray(topicBuckets?.[topic]) ? topicBuckets[topic].length : 0;
    if (allowUnderfillTopics.has(topic) && count > 0) return false;
    return count < minPerTopic;
  });
}

function buildUserQuickScanRows(items, deps = {}) {
  const strip = typeof deps.stripInlineHtml === "function"
    ? deps.stripInlineHtml
    : (value) => String(value || "");
  const topicVisual = typeof deps.topicVisual === "function"
    ? deps.topicVisual
    : () => ({ icon: "", chipText: "#000", chipBg: "#fff" });
  const escapeHtml = typeof deps.escapeHtml === "function"
    ? deps.escapeHtml
    : (value) => String(value || "");
  return (Array.isArray(items) ? items : []).map((item, idx) => {
    const short = normalizeDigestHeadlinePreview(strip(item?.headline || ""));
    const topic = topicVisual(item.tag);
    const safeTag = escapeHtml(String(item.tag || "News"));
    const safeShort = escapeHtml(short);
    return `<tr>
          <td style="font-size:14px;color:#111827;font-weight:700;padding:6px 10px 6px 0;vertical-align:top;line-height:1.5;white-space:nowrap;">${idx + 1}</td>
          <td style="padding:6px 0;vertical-align:top;line-height:1.5;">
            <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};margin-bottom:2px;">${topic.icon} ${safeTag}</div>
            <div style="font-size:14px;color:#374151;line-height:1.5;">${safeShort}</div>
          </td>
        </tr>`;
  }).join("\n");
}

module.exports = {
  buildDeliveryDiagnosticsFields,
  buildDeliverySelection,
  buildDigestSnapshotItems,
  buildQuickScanText,
  buildStrictDeliverySelection,
  buildUserQuickScanRows,
  computeRemainingWindowMinutes,
  deliveryModeAttemptCount,
  filterItemsForSubscribedTopics,
  filterTopicBucketsForSubscribedTopics,
  flattenTopicBuckets,
  getRequestedItemCount,
  getSubscribedStandardTopics,
  groupFlatItemsByTopic,
  listIncompleteTopics,
};
