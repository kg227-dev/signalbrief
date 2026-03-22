"use strict";

const { createDigestOrchestratorDeliveryRankingRuntime } = require("./digest-orchestrator-delivery-ranking-runtime");
const { sortDigestItemsByScoreDescending } = require("../digest/runtime/digest-item-ordering-runtime");
const {
  DELIVERY_POLICY,
  classifyRetryFailureClass,
  computeRetryDelayMinutes,
  countRecentLowerConfidenceAssist,
  deriveInternalThinnessLabel,
  getCustomTopicMetadata,
  listTrustedOnlyCustomKeywords,
  selectDeliveryItems,
} = require("../runtime/digest-delivery-policy-runtime");

function createDigestOrchestratorDeliveryRuntime(deps) {
  const {
    CONFIG,
    log,
    applyAutoTopicLearning,
    writeUser,
    buildLearningSummary,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    buildRecentEntityHistory,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
    applyEntityCoverageCap,
    reserveCustomKeywordSlot,
    applyDigestDepth,
    computeDigestQualityScore,
    buildDigestId,
    appendEngagementEventChecked,
    beginDigestDeliveryRecord,
    updateDigestDeliveryRecord,
    loadRecentSentDigests,
    loadAllCurrentRecords,
    digestRetryStateRuntime,
    sendTelegram,
    formatTelegram,
    buildDigestInlineKeyboard,
    generateLeadSubjectLine,
    generateEditorialNote,
    buildEmail,
    buildOpenTrackingPixel,
    getBaseUrl,
    sendEmail,
    normalizeUrlForDedup,
    formatEtDateKey,
    stripInlineHtml,
    topicVisual,
    escapeHtml,
  } = deps;
  const rankingRuntime = createDigestOrchestratorDeliveryRankingRuntime({
    CONFIG,
    log,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    buildRecentEntityHistory,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
    applyEntityCoverageCap,
    reserveCustomKeywordSlot,
  });

  function buildQuickScanText(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => stripInlineHtml(item?.headline || "").split(":")[0].split("—")[0].trim())
      .filter(Boolean)
      .join(" · ");
  }

  function buildDigestSnapshotItems(items) {
    return (Array.isArray(items) ? items : []).map((item, idx) => ({
      index: idx + 1,
      tag: item?.tag || null,
      headline: item?.headline || null,
      summary: item?.summary || null,
      wim_brief: item?.wim_brief || null,
      wim: item?.wim || null,
      implications: item?.implications || null,
      watch_next: item?.watch_next || null,
      url: item?.url || null,
      source: item?.source || null,
      source_domain: item?.source_domain || parseSourceDomain(item),
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
      delivery_confidence: String(item?.delivery_confidence || "").trim() || null,
      delivery_confidence_label: String(item?.delivery_confidence_label || "").trim() || null,
      delivery_trusted_only_topic_hit: item?.delivery_trusted_only_topic_hit === true,
      delivery_topic_classes: Array.isArray(item?.delivery_topic_classes) ? item.delivery_topic_classes.slice() : [],
      delivery_custom_keywords: Array.isArray(item?.delivery_custom_keywords) ? item.delivery_custom_keywords.slice() : [],
      score_breakdown: item?.score_breakdown && typeof item.score_breakdown === "object"
        ? { ...item.score_breakdown }
        : null,
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
    };
  }

  function deliveryModeAttemptCount(user = {}) {
    const priorAttemptCount = Math.max(0, Number(user?.__digest_retry?.attempt_count || 0));
    return priorAttemptCount + 1;
  }

  function selectTrustedOnlyKeywords(customKeywords = []) {
    return listTrustedOnlyCustomKeywords(customKeywords);
  }

  function computeRemainingWindowMinutes(prefs = {}, nowDate = new Date()) {
    const catchupWindowMinutes = Math.max(30, Number(CONFIG?.digest?.catchupWindowMinutes || 60));
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
    return catchupWindowMinutes - Math.max(0, diff);
  }

  function loadRecentLowerConfidenceAssistCount(userId, nowIso) {
    if (typeof loadAllCurrentRecords !== "function") return 0;
    const recentRecords = loadAllCurrentRecords({
      status: "sent",
      userId,
    });
    return countRecentLowerConfidenceAssist(recentRecords, nowIso);
  }

  function scheduleRetryState(params = {}) {
    if (!digestRetryStateRuntime || typeof digestRetryStateRuntime.upsertRetryState !== "function") return null;
    return digestRetryStateRuntime.upsertRetryState(params);
  }

  function clearRetryState(userId, dateKey) {
    if (!digestRetryStateRuntime || typeof digestRetryStateRuntime.clearRetryState !== "function") return false;
    return digestRetryStateRuntime.clearRetryState(userId, dateKey);
  }

  function buildUserQuickScanRows(items) {
    return items.map((item, idx) => {
      const short = stripInlineHtml(item.headline).split(":")[0].split("—")[0].trim();
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

  async function deliverDueUsers(params) {
    const {
      dueUsers,
      enriched,
      now,
      shortDate,
      dateStr,
      digestDateKey,
      runId,
      repeatIndex,
      repeatPenalty,
      depthPolicy,
      rankingPolicy,
      publicDigestUrl,
      suppressWelcome,
      targetChatId,
      deliveryMode = "scheduled",
      deliveryEventSource = targetChatId ? "on-demand" : "scheduled-job",
      claudeUsage,
      engagementEvents,
      runDiagnostics,
      repetitionNote,
    } = params;

    const deliveredUsers = [];
    const failedUsers = [];
    const withheldUsers = [];

    for (let user of dueUsers) {
      const userId = String(user?.chatId || user?.email || "").trim();
      const userDigestId = buildDigestId(digestDateKey, userId);
      let deliveryRecordVersion = null;
      let selectedSnapshotItems = [];
      let quickScan = "";
      try {
        const recordStart = typeof beginDigestDeliveryRecord === "function"
          ? beginDigestDeliveryRecord({
            digest_id: userDigestId,
            user_id: userId,
            date_et: digestDateKey,
            mode: deliveryMode,
            run_id: runId,
            source: deliveryEventSource,
            trigger: deliveryMode,
            date_str: dateStr,
          })
          : { ok: true, skipped: false, version: 1, record: { version: 1 } };
        if (!recordStart?.ok) {
          throw new Error(recordStart?.reason || "failed to initialize digest delivery record");
        }
        if (recordStart?.skipped) {
          log(`⏭️ Skipped ${user.email || user.chatId}: digest already sent for ${digestDateKey} (${deliveryMode})`);
          continue;
        }
        deliveryRecordVersion = Math.max(1, Number(recordStart?.version || recordStart?.record?.version || 1));

        const recentDigestRecords = typeof loadRecentSentDigests === "function"
          ? loadRecentSentDigests(userId, {
            limit: deliveryMode === "scheduled"
              ? Math.max(5, Number(CONFIG.digest.scheduledFreshnessWindowDays || 5))
              : Math.max(1, Number(CONFIG.digest.perUserEntityHistoryDigests || 3)),
          })
          : [];
        const autoLearning = applyAutoTopicLearning(user, {
          events: engagementEvents,
          now,
          date_key: digestDateKey,
          run_id: runId,
        });
        const autoLearningEventFailures = Math.max(0, Number(autoLearning.event_write_failures || 0));
        if (autoLearningEventFailures > 0) {
          log(`⚠️ [auto-learning] ${user.email || user.chatId}: engagement event write failures=${autoLearningEventFailures}`);
        }
        if (autoLearning.changed) {
          writeUser(user.chatId, user);
          const changes = autoLearning.adjustments
            .map((adjustment) => `${adjustment.topic}:${adjustment.prev}->${adjustment.next}`)
            .join(", ");
          log(`  [auto-learning] ${user.email || user.chatId}: ${changes} (events=${autoLearning.processed_events})`);
        }
        const baseLearning = autoLearning.changed
          ? buildLearningSummary(autoLearning.adjustments, 2)
          : "";
        const learningSummary = [baseLearning, String(repetitionNote || "").trim()]
          .filter(Boolean)
          .join(" · ");

        const ranked = rankingRuntime.rankAndSuppressUserItems({
          user,
          enriched,
          repeatIndex,
          repeatPenalty,
          depthPolicy,
          rankingPolicy,
          recentDigestRecords,
          nowIso: now.toISOString(),
          deliveryMode,
          runDiagnostics,
        });
        let userItems = ranked.userItems;
        const wasFiltered = ranked.wasFiltered;
        const deliveryDiagnostics = ranked.diagnostics && typeof ranked.diagnostics === "object"
          ? ranked.diagnostics
          : {};
        const prefs = user.preferences || {};

        const depth = prefs.depth || "full";
        const userCustomKeywords = (Array.isArray(user.topics) ? user.topics : [])
          .filter((topic) => String(topic || "").startsWith("custom_"))
          .map((topic) => String(topic || "").replace(/^custom_/, "").replace(/_/g, " ").trim())
          .filter(Boolean);
        const attemptCount = deliveryModeAttemptCount(user);
        const lowerConfidenceAssist7dCount = loadRecentLowerConfidenceAssistCount(userId, now.toISOString());
        const trustedOnlyCustomKeywords = selectTrustedOnlyKeywords(userCustomKeywords);
        const deliverySelection = selectDeliveryItems(userItems, {
          attemptCount,
          nowIso: now.toISOString(),
          customKeywords: userCustomKeywords,
          lowerConfidenceAssistCount: lowerConfidenceAssist7dCount,
        });
        const candidateDisplayItems = sortDigestItemsByScoreDescending(applyDigestDepth(userItems, depth));
        const previousDigestItems = Array.isArray(user.last_digest_items) ? user.last_digest_items : [];
        const candidateDigestQuality = computeDigestQualityScore({
          items: candidateDisplayItems,
          user,
          previous_items: previousDigestItems,
        });
        const internalThinnessLabel = deriveInternalThinnessLabel({
          availableCandidateCount: userItems.length,
          highConfidenceAvailableCount: deliverySelection.high_confidence_available_count,
        });
        const deliveryEligible = deliverySelection.delivery_eligible === true;
        const deliveryItems = deliveryEligible
          ? sortDigestItemsByScoreDescending(applyDigestDepth(deliverySelection.items, depth))
          : [];
        const digestQuality = deliveryEligible
          ? computeDigestQualityScore({
            items: deliveryItems,
            user,
            previous_items: previousDigestItems,
          })
          : candidateDigestQuality;
        selectedSnapshotItems = buildDigestSnapshotItems(deliveryEligible ? deliveryItems : candidateDisplayItems);
        quickScan = buildQuickScanText(deliveryEligible ? deliveryItems : candidateDisplayItems);
        const eventItems = buildDigestSnapshotItems(deliveryItems).map((item) => ({
          index: item.index,
          headline: item.headline,
          url: item.url,
          tag: item.tag,
          base_score: item.baseScore,
          topic_match: item.topicMatch,
          relevance_score: item.relevanceScore,
          entity_keys: item.entity_keys,
          storyline_id: item.storyline_id,
          storyline_key: item.storyline_key,
          freshness_key: item.freshness_key,
          storyline_size: item.storyline_size,
          source_domain: item.source_domain,
          source_tier: item.source_tier,
          strategic_value: item.strategic_value,
          routine_item_score: item.routine_item_score,
          score_breakdown: item.score_breakdown,
          delivery_confidence: item.delivery_confidence || null,
        }));
        if (typeof updateDigestDeliveryRecord === "function") {
          updateDigestDeliveryRecord({
            digest_id: userDigestId,
            user_id: userId,
            date_et: digestDateKey,
            mode: deliveryMode,
            version: deliveryRecordVersion,
            run_id: runId,
            source: deliveryEventSource,
            trigger: deliveryMode,
            status: "selected",
            date_str: dateStr,
            quick_scan: quickScan,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            delivery_outcome: deliveryEligible
              ? (deliverySelection.lower_confidence_used ? "delivered_with_lower_confidence" : "delivered_full_confidence")
              : null,
            attempt_count: attemptCount,
            high_confidence_count: deliverySelection.high_confidence_count,
            lower_confidence_count: deliverySelection.lower_confidence_count,
            high_confidence_available_count: deliverySelection.high_confidence_available_count,
            lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
            lower_confidence_used: deliverySelection.lower_confidence_used,
            lower_confidence_assist_7d_count: lowerConfidenceAssist7dCount + (deliverySelection.lower_confidence_used ? 1 : 0),
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }

        // --- shipping contract guard: each delivered digest must contain 5 items ---
        if (!deliveryEligible) {
          const failureClass = classifyRetryFailureClass({
            diagnostics: {
              thin_pool: deliveryDiagnostics.thin_pool,
              dominant_failure_mode: deliveryDiagnostics.dominant_failure_mode,
              provider_429_count: deliveryDiagnostics.provider_429_count,
              transport_errors: deliveryDiagnostics.provider_transport_errors,
              provider_degraded: deliveryDiagnostics.provider_degraded,
            },
            availableCandidateCount: userItems.length,
          });
          const retryableScheduledAttempt = deliveryMode === "scheduled" && attemptCount === 1;
          const latestSafeDelay = computeRemainingWindowMinutes(prefs, now) - 5;
          const retryDelayMinutes = retryableScheduledAttempt
            ? computeRetryDelayMinutes(failureClass, latestSafeDelay)
            : null;
          const retryScheduledFor = Number.isFinite(Number(retryDelayMinutes))
            ? new Date(now.getTime() + (Number(retryDelayMinutes) * 60 * 1000)).toISOString()
            : null;
          const deliveryOutcome = retryScheduledFor
            ? "withheld_retry_pending"
            : attemptCount > 1
              ? "withheld_after_retry"
              : "withheld_after_retry_window";
          if (retryScheduledFor) {
            scheduleRetryState({
              user_id: userId,
              date_et: digestDateKey,
              attempt_count: attemptCount,
              next_retry_at: retryScheduledFor,
              underfill_reason: failureClass,
              requested_count: DELIVERY_POLICY.target_item_count,
              high_confidence_count: deliverySelection.high_confidence_count,
              lower_confidence_count: deliverySelection.lower_confidence_count,
              delivery_outcome: deliveryOutcome,
              retry_pending: true,
              last_attempt_at: now.toISOString(),
            });
          } else {
            scheduleRetryState({
              user_id: userId,
              date_et: digestDateKey,
              attempt_count: attemptCount,
              next_retry_at: null,
              underfill_reason: failureClass,
              requested_count: DELIVERY_POLICY.target_item_count,
              high_confidence_count: deliverySelection.high_confidence_count,
              lower_confidence_count: deliverySelection.lower_confidence_count,
              delivery_outcome: deliveryOutcome,
              retry_pending: false,
              last_attempt_at: now.toISOString(),
            });
          }
          if (typeof updateDigestDeliveryRecord === "function") {
            updateDigestDeliveryRecord({
              digest_id: userDigestId,
              user_id: userId,
              date_et: digestDateKey,
              mode: deliveryMode,
              version: deliveryRecordVersion,
              run_id: runId,
              source: deliveryEventSource,
              trigger: deliveryMode,
              status: "withheld",
              withheld_reason: failureClass,
              delivery_outcome: deliveryOutcome,
              retry_scheduled_for: retryScheduledFor,
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              attempt_count: attemptCount,
              high_confidence_count: deliverySelection.high_confidence_count,
              lower_confidence_count: deliverySelection.lower_confidence_count,
              high_confidence_available_count: deliverySelection.high_confidence_available_count,
              lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
              lower_confidence_used: false,
              lower_confidence_assist_7d_count: lowerConfidenceAssist7dCount,
              internal_thinness_label: internalThinnessLabel,
              ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
              items: selectedSnapshotItems,
            });
          }
          withheldUsers.push({
            userId,
            email: user.email,
            status: "withheld",
            delivery_outcome: deliveryOutcome,
            withheld_reason: failureClass,
            retry_scheduled_for: retryScheduledFor,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            attempt_count: attemptCount,
            high_confidence_count: deliverySelection.high_confidence_count,
            lower_confidence_count: deliverySelection.lower_confidence_count,
            high_confidence_available_count: deliverySelection.high_confidence_available_count,
            lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
            internal_thinness_label: internalThinnessLabel,
            trusted_only_custom_keywords: trustedOnlyCustomKeywords,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
          });
          continue;
        }

        // --- quality floor guard: withhold delivery if quality is too low ---
        const minDeliveryQualityScore = Number(CONFIG.digest?.minDeliveryQualityScore ?? 25);
        if (deliveryItems.length === 0 || digestQuality.score < minDeliveryQualityScore) {
          const withholdReason = deliveryItems.length === 0 ? "empty_items" : "quality_below_floor";
          log(`  skip delivery for ${user.email || userId}: ${withholdReason} (score=${digestQuality.score}, min=${minDeliveryQualityScore})`);
          scheduleRetryState({
            user_id: userId,
            date_et: digestDateKey,
            attempt_count: attemptCount,
            next_retry_at: null,
            underfill_reason: withholdReason,
            requested_count: DELIVERY_POLICY.target_item_count,
            high_confidence_count: deliverySelection.high_confidence_count,
            lower_confidence_count: deliverySelection.lower_confidence_count,
            delivery_outcome: attemptCount > 1 ? "withheld_after_retry" : "withheld_after_retry_window",
            retry_pending: false,
            last_attempt_at: now.toISOString(),
          });
          if (typeof updateDigestDeliveryRecord === "function") {
            updateDigestDeliveryRecord({
              digest_id: userDigestId,
              user_id: userId,
              date_et: digestDateKey,
              mode: deliveryMode,
              version: deliveryRecordVersion,
              run_id: runId,
              source: deliveryEventSource,
              trigger: deliveryMode,
              status: "withheld",
              withheld_reason: withholdReason,
              delivery_outcome: attemptCount > 1 ? "withheld_after_retry" : "withheld_after_retry_window",
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              attempt_count: attemptCount,
              high_confidence_count: deliverySelection.high_confidence_count,
              lower_confidence_count: deliverySelection.lower_confidence_count,
              high_confidence_available_count: deliverySelection.high_confidence_available_count,
              lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
              lower_confidence_used: deliverySelection.lower_confidence_used,
              lower_confidence_assist_7d_count: lowerConfidenceAssist7dCount + (deliverySelection.lower_confidence_used ? 1 : 0),
              internal_thinness_label: internalThinnessLabel,
              ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            });
          }
          withheldUsers.push({
            userId,
            email: user.email,
            status: "withheld",
            withheld_reason: withholdReason,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            attempt_count: attemptCount,
            high_confidence_count: deliverySelection.high_confidence_count,
            lower_confidence_count: deliverySelection.lower_confidence_count,
            high_confidence_available_count: deliverySelection.high_confidence_available_count,
            lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
          });
          continue;
        }

        const userQuickScan = buildUserQuickScanRows(deliveryItems);
        const isFirstDigest = !user.welcome_email_sent && !suppressWelcome;

        let delivered = false;
        let engagementWriteFailures = 0;
        const deliveredChannels = [];
        if (typeof updateDigestDeliveryRecord === "function") {
          updateDigestDeliveryRecord({
            digest_id: userDigestId,
            user_id: userId,
            date_et: digestDateKey,
            mode: deliveryMode,
            version: deliveryRecordVersion,
            run_id: runId,
            source: deliveryEventSource,
            trigger: deliveryMode,
            status: "sending",
            sending_at: new Date().toISOString(),
            date_str: dateStr,
            quick_scan: quickScan,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            delivery_outcome: deliverySelection.lower_confidence_used ? "delivered_with_lower_confidence" : "delivered_full_confidence",
            attempt_count: attemptCount,
            high_confidence_count: deliverySelection.high_confidence_count,
            lower_confidence_count: deliverySelection.lower_confidence_count,
            high_confidence_available_count: deliverySelection.high_confidence_available_count,
            lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
            lower_confidence_used: deliverySelection.lower_confidence_used,
            lower_confidence_assist_7d_count: lowerConfidenceAssist7dCount + (deliverySelection.lower_confidence_used ? 1 : 0),
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }

        if (user.chatId && !user.chatId.startsWith("email-") && prefs.telegram_enabled !== false) {
          const userTelegram = formatTelegram(deliveryItems, shortDate, user, {
            digestQuality,
            learningSummary,
            publicDigestUrl,
          });
          const userKeyboard = buildDigestInlineKeyboard(deliveryItems);
          try {
            await sendTelegram(userTelegram, user.chatId, { reply_markup: userKeyboard });
            const eventOutcome = appendEngagementEventChecked({
              event_type: "digest_sent",
              event_key: `digest_sent:${userDigestId}:${deliveryMode}:v${deliveryRecordVersion}:telegram`,
              date_et: digestDateKey,
              user_chat_id: String(user.chatId),
              user_email: user.email || null,
              digest_id: userDigestId,
              run_id: runId,
              channel: "telegram",
              source: deliveryEventSource,
              metadata: {
                item_count: deliveryItems.length,
                depth,
                delivery_mode: deliveryMode,
                delivery_version: deliveryRecordVersion,
                quality_score: digestQuality.score,
                quality_band: digestQuality.band,
                quality_components: digestQuality.components,
                items: eventItems,
              },
            }, { scope: "digest", context: `digest_sent:telegram:${user.email || user.chatId}`, log });
            if (!eventOutcome.ok) engagementWriteFailures += 1;
            delivered = true;
            deliveredChannels.push("telegram");
          } catch (err) {
            log(`⚠️ Telegram delivery failed for ${user.email || user.chatId}: ${err.message}`);
          }
        }

        if (user.email && prefs.email_enabled !== false) {
          const subjectResult = await generateLeadSubjectLine(deliveryItems[0] || null, now);
          claudeUsage.input_tokens += Number(subjectResult?.usage?.input_tokens || 0);
          claudeUsage.output_tokens += Number(subjectResult?.usage?.output_tokens || 0);

          const noteResult = await generateEditorialNote(deliveryItems);
          claudeUsage.input_tokens += Number(noteResult?.usage?.input_tokens || 0);
          claudeUsage.output_tokens += Number(noteResult?.usage?.output_tokens || 0);

          let userEmailHtml = buildEmail(
            deliveryItems,
            dateStr,
            userQuickScan,
            user.token || "",
            isFirstDigest,
            wasFiltered,
            depth,
            user,
            digestDateKey,
            userDigestId,
            {
              digestQuality,
              learningSummary,
              publicDigestUrl,
              editorialNote: noteResult.note || "",
            }
          );
          if (user.token) {
            const trackingPixel = buildOpenTrackingPixel(userDigestId, user.token, getBaseUrl());
            userEmailHtml = /<\/body>/i.test(userEmailHtml)
              ? userEmailHtml.replace(/<\/body>/i, `${trackingPixel}\n</body>`)
              : `${userEmailHtml}\n${trackingPixel}`;
          }
          try {
            await sendEmail(user.email, subjectResult.subject, userEmailHtml, user.token || null);
            const eventOutcome = appendEngagementEventChecked({
              event_type: "digest_sent",
              event_key: `digest_sent:${userDigestId}:${deliveryMode}:v${deliveryRecordVersion}:email`,
              date_et: digestDateKey,
              user_chat_id: String(user.chatId),
              user_email: user.email || null,
              digest_id: userDigestId,
              run_id: runId,
              channel: "email",
              source: deliveryEventSource,
              metadata: {
                item_count: deliveryItems.length,
                depth,
                delivery_mode: deliveryMode,
                delivery_version: deliveryRecordVersion,
                quality_score: digestQuality.score,
                quality_band: digestQuality.band,
                quality_components: digestQuality.components,
                items: eventItems,
              },
            }, { scope: "digest", context: `digest_sent:email:${user.email || user.chatId}`, log });
            if (!eventOutcome.ok) engagementWriteFailures += 1;
            delivered = true;
            deliveredChannels.push("email");
            if (isFirstDigest || suppressWelcome) user.welcome_email_sent = true;
          } catch (err) {
            log(`⚠️ Email delivery failed for ${user.email || user.chatId}: ${err.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 600));
        }

        if (!delivered) throw new Error("no channels succeeded");
        clearRetryState(userId, digestDateKey);
        if (typeof updateDigestDeliveryRecord === "function") {
          updateDigestDeliveryRecord({
            digest_id: userDigestId,
            user_id: userId,
            date_et: digestDateKey,
            mode: deliveryMode,
            version: deliveryRecordVersion,
            run_id: runId,
            source: deliveryEventSource,
            trigger: deliveryMode,
            status: "sent",
            sent_at: new Date().toISOString(),
            channels: deliveredChannels,
            date_str: dateStr,
            quick_scan: quickScan,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            delivery_outcome: deliverySelection.lower_confidence_used ? "delivered_with_lower_confidence" : "delivered_full_confidence",
            attempt_count: attemptCount,
            high_confidence_count: deliverySelection.high_confidence_count,
            lower_confidence_count: deliverySelection.lower_confidence_count,
            high_confidence_available_count: deliverySelection.high_confidence_available_count,
            lower_confidence_available_count: deliverySelection.lower_confidence_available_count,
            lower_confidence_used: deliverySelection.lower_confidence_used,
            lower_confidence_assist_7d_count: lowerConfidenceAssist7dCount + (deliverySelection.lower_confidence_used ? 1 : 0),
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }

        const currentUrlKeys = [...new Set(
          deliveryItems
            .map((item) => normalizeUrlForDedup(item?.url))
            .filter(Boolean)
        )];
        const currentStorylineKeys = [...new Set(
          deliveryItems
            .map((item) => String(item?.storyline_key || "").trim())
            .filter(Boolean)
        )];
        const currentFreshnessKeys = [...new Set(
          deliveryItems
            .map((item) => String(item?.freshness_key || "").trim())
            .filter(Boolean)
        )];
        const priorUrlHistory = Array.isArray(user.recent_digest_url_history)
          ? user.recent_digest_url_history.slice()
          : [];
        priorUrlHistory.push({
          date_et: digestDateKey,
          digest_id: userDigestId,
          urls: currentUrlKeys,
          storyline_keys: currentStorylineKeys,
          freshness_keys: currentFreshnessKeys,
        });
        user.recent_digest_url_history = priorUrlHistory.slice(-Math.max(
          Number(CONFIG.digest.scheduledFreshnessWindowDays || 5),
          Number(CONFIG.digest.perUserFreshnessDigests || 3),
          1
        ));
        user.digests_received = (user.digests_received || 0) + 1;
        user.last_digest_at = now.toISOString();
        user.last_digest_items = selectedSnapshotItems.map((item) => ({ ...item }));

        if (!user.digest_dates) user.digest_dates = [];
        if (!user.digest_dates.includes(digestDateKey)) user.digest_dates.push(digestDateKey);

        const history = Array.isArray(user.quality_history) ? user.quality_history.slice() : [];
        history.push({
          digest_id: userDigestId,
          date_et: digestDateKey,
          ts_utc: now.toISOString(),
          score: digestQuality.score,
          band: digestQuality.band,
          components: digestQuality.components,
        });
        if (history.length > 120) history.splice(0, history.length - 120);
        user.quality_history = history;
        user.last_quality_score = history[history.length - 1] || null;
        if (Object.prototype.hasOwnProperty.call(user, "__digest_retry")) delete user.__digest_retry;
        writeUser(user.chatId, user);

        deliveredUsers.push({
          id: user.email || user.chatId,
          on_demand: Boolean(targetChatId),
          digest_id: userDigestId,
          delivery_mode: deliveryMode,
          delivery_version: deliveryRecordVersion,
          digest_quality_score: Number.isFinite(Number(digestQuality?.score))
            ? Number(digestQuality.score.toFixed(2))
            : null,
          digest_quality_band: String(digestQuality?.band || "") || null,
          delivery_outcome: deliverySelection.lower_confidence_used ? "delivered_with_lower_confidence" : "delivered_full_confidence",
          high_confidence_count: deliverySelection.high_confidence_count,
          lower_confidence_count: deliverySelection.lower_confidence_count,
          lower_confidence_used: deliverySelection.lower_confidence_used,
          digest_url: String(publicDigestUrl || ""),
          engagement_event_failures: engagementWriteFailures,
          ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
        });

        const eventWriteSuffix = engagementWriteFailures > 0
          ? `, event_writes_failed=${engagementWriteFailures}`
          : "";
        log(`✅ Delivered to ${user.email || user.chatId} (${deliveryItems.length} items, depth=${depth}, dqs=${digestQuality.score.toFixed(1)}${eventWriteSuffix})`);
      } catch (err) {
        if (deliveryRecordVersion && typeof updateDigestDeliveryRecord === "function") {
          updateDigestDeliveryRecord({
            digest_id: userDigestId,
            user_id: userId,
            date_et: digestDateKey,
            mode: deliveryMode,
            version: deliveryRecordVersion,
            run_id: runId,
            source: deliveryEventSource,
            trigger: deliveryMode,
            status: "failed",
            failed_at: new Date().toISOString(),
            error: err.message,
            date_str: dateStr,
            quick_scan: quickScan,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }
        failedUsers.push({ id: user.email || user.chatId, error: err.message, on_demand: Boolean(targetChatId) });
        log(`❌ Failed delivery to ${user.email || user.chatId}: ${err.message}`);
      }
    }

    return {
      deliveredUsers,
      failedUsers,
      withheldUsers,
    };
  }

  return {
    deliverDueUsers,
  };
}

module.exports = {
  createDigestOrchestratorDeliveryRuntime,
};
