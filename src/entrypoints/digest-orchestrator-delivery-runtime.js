"use strict";

const { sortDigestItemsByScoreDescending } = require("../digest/runtime/digest-item-ordering-runtime");
const {
  evaluateFinalDigestAssembly,
  resolveStrictQualityConfig,
} = require("../digest/domain/strict-quality-domain-runtime");
const {
  DELIVERY_POLICY,
  classifyRetryFailureClass,
  computeRetryDelayMinutes,
  deriveInternalThinnessLabel,
  isRetryEligibleFailureClass,
  selectTopicBuckets,
} = require("../runtime/digest-mvp-delivery-runtime");
const {
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
} = require("./digest-orchestrator-delivery-helpers-runtime");

function createDigestOrchestratorDeliveryRuntime(deps) {
  const {
    CONFIG,
    log,
    writeUser,
    parseSourceDomain,
    applyDigestDepth,
    computeDigestQualityScore,
    buildDigestId,
    appendEngagementEventChecked,
    beginDigestDeliveryRecord,
    updateDigestDeliveryRecord,
    loadRecentSentDigests,
    loadAllCurrentRecords,
    digestRetryStateRuntime,
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

  function scheduleRetryState(params = {}) {
    if (!digestRetryStateRuntime || typeof digestRetryStateRuntime.upsertRetryState !== "function") return null;
    return digestRetryStateRuntime.upsertRetryState(params);
  }

  function clearRetryState(userId, dateKey) {
    if (!digestRetryStateRuntime || typeof digestRetryStateRuntime.clearRetryState !== "function") return false;
    return digestRetryStateRuntime.clearRetryState(userId, dateKey);
  }

  function scheduleScheduledDeliveryFailureRetry(params = {}) {
    const {
      deliveryMode,
      userId,
      dateKey,
      attemptCount,
      prefs,
      now,
      attemptedChannelCount = 0,
      requestedItemCount = DELIVERY_POLICY.target_item_count,
    } = params;
    if (deliveryMode !== "scheduled") return null;

    const normalizedAttemptCount = Math.max(1, Number(attemptCount || 1));
    const attemptedCount = Math.max(0, Number(attemptedChannelCount || 0));
    let retryScheduledFor = null;
    let deliveryOutcome = "delivery_failed_after_retry_window";
    if (attemptedCount > 0) {
      if (normalizedAttemptCount > 1) {
        deliveryOutcome = "delivery_failed_after_retry";
      } else {
        const latestSafeDelay = computeRemainingWindowMinutes(CONFIG?.digest?.catchupWindowMinutes, prefs, now) - 5;
        const retryDelayMinutes = computeRetryDelayMinutes("transient", latestSafeDelay);
        if (Number.isFinite(Number(retryDelayMinutes)) && Number(retryDelayMinutes) > 0) {
          retryScheduledFor = new Date(now.getTime() + (Number(retryDelayMinutes) * 60 * 1000)).toISOString();
          deliveryOutcome = "delivery_failed_retry_pending";
        }
      }
    }

    scheduleRetryState({
      user_id: userId,
      date_et: dateKey,
      attempt_count: normalizedAttemptCount,
      next_retry_at: retryScheduledFor,
      underfill_reason: attemptedCount > 0 ? "delivery_failed" : "no_delivery_channel",
      requested_count: Math.max(1, Number(requestedItemCount || DELIVERY_POLICY.target_item_count)),
      delivery_outcome: deliveryOutcome,
      retry_pending: Boolean(retryScheduledFor),
      last_attempt_at: now.toISOString(),
    });

    return {
      deliveryOutcome,
      retryScheduledFor,
      retryPending: Boolean(retryScheduledFor),
    };
  }

  async function deliverDueUsers(params) {
    const {
      dueUsers,
      enriched,
      finalSelectedByTopic,
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
      deliveryMode = "scheduled",
      deliveryEventSource = "scheduled-job",
      claudeUsage,
      engagementEvents,
      runDiagnostics,
      repetitionNote,
      writeupDiagnostics,
    } = params;
    const strictQualityConfig = resolveStrictQualityConfig(CONFIG.digest || {});
    const strictQualityEnabled = strictQualityConfig.enabled === true;
    const runtimeTopicBuckets = finalSelectedByTopic && typeof finalSelectedByTopic === "object"
      ? Object.fromEntries(
          Object.entries(finalSelectedByTopic).map(([tag, items]) => [String(tag || "").trim().toUpperCase(), Array.isArray(items) ? items.slice() : []])
        )
      : groupFlatItemsByTopic(enriched);

    const deliveredUsers = [];
    const failedUsers = [];
    const withheldUsers = [];

    for (let user of dueUsers) {
      const userId = String(user?.chatId || user?.email || "").trim();
      const userDigestId = buildDigestId(digestDateKey, userId);
      const prefs = user.preferences || {};
      const attemptCount = deliveryModeAttemptCount(user);
      let deliveryRecordVersion = null;
      let selectedSnapshotItems = [];
      let quickScan = "";
      let deliveryDiagnostics = {};
      let deliverySelection = {
        items: [],
        available_count: 0,
        selected_count: 0,
        delivery_eligible: false,
        topic_buckets: {},
      };
      let internalThinnessLabel = null;
      let digestQuality = { score: null, band: null, components: null };
      let attemptedChannelCount = 0;
      let requestedItemCount = DELIVERY_POLICY.target_item_count;
      let depth = String(prefs?.depth || "full").trim() || "full";
      let subjectLine = null;
      let editorialNote = "";
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

        const learningSummary = String(repetitionNote || "").trim();
        depth = String(prefs?.depth || "full").trim() || "full";
        const wasFiltered = false;
        const subscribedStandardTopics = getSubscribedStandardTopics(user);
        requestedItemCount = getRequestedItemCount(subscribedStandardTopics, DELIVERY_POLICY.target_item_count);
        const strictUserTopicBuckets = filterTopicBucketsForSubscribedTopics(runtimeTopicBuckets, subscribedStandardTopics);
        const strictUserItems = flattenTopicBuckets(strictUserTopicBuckets, subscribedStandardTopics);
        const userItems = strictQualityEnabled
          ? strictUserItems
          : filterItemsForSubscribedTopics(enriched, subscribedStandardTopics);
        let candidateDisplayItems = [];
        if (strictQualityEnabled) {
          const strictAssembly = evaluateFinalDigestAssembly(strictUserTopicBuckets, {
            strictQualityConfig,
            configDigest: CONFIG.digest || {},
            subscribedTopics: subscribedStandardTopics,
            maxItemsPerSourceDomain: CONFIG.digest?.maxItemsPerSourceDomain || 2,
            nowMs: now.getTime(),
            topicCandidatesByTag: strictUserTopicBuckets,
          });
          deliverySelection = buildStrictDeliverySelection(strictAssembly);
          deliveryDiagnostics = {
            ...(runDiagnostics && typeof runDiagnostics === "object" ? runDiagnostics : {}),
            requested_count: requestedItemCount,
            candidate_pool_before_dedup: Array.isArray(enriched) ? enriched.length : 0,
            candidate_pool_after_dedup: strictUserItems.length,
            thin_pool: deliverySelection.items.length < requestedItemCount,
            dominant_failure_mode: requestedItemCount === 0
              ? "no_standard_topics"
              : (deliverySelection.delivery_eligible ? null : "strict_quality_blocked"),
            surviving_topic_bucket_count: deliverySelection.surviving_topic_bucket_count,
            strict_quality_exception_count: deliverySelection.strict_quality_exception_count,
            extreme_underfill: deliverySelection.extreme_underfill,
            extreme_underfill_target_rate_pct: deliverySelection.extreme_underfill_target_rate_pct,
            blocked_topic_list: Array.isArray(deliverySelection.blocked_topics)
              ? deliverySelection.blocked_topics.slice()
              : [],
          };
          candidateDisplayItems = sortDigestItemsByScoreDescending(applyDigestDepth(
            deliverySelection.delivery_eligible ? deliverySelection.items : strictUserItems,
            depth
          ));
        } else {
          const topicBuckets = selectTopicBuckets(userItems, subscribedStandardTopics, DELIVERY_POLICY.target_item_count);
          const bucketItems = flattenTopicBuckets(topicBuckets, subscribedStandardTopics);
          const incompleteTopics = listIncompleteTopics(topicBuckets, subscribedStandardTopics, {
            minPerTopic: CONFIG.digest.minDeliveryItemsPerTopic || DELIVERY_POLICY.target_item_count,
            allowUnderfillTopicTags: Array.isArray(writeupDiagnostics?.allow_underfill_topic_tags)
              ? writeupDiagnostics.allow_underfill_topic_tags
              : [],
          });
          deliveryDiagnostics = {
            ...(runDiagnostics && typeof runDiagnostics === "object" ? runDiagnostics : {}),
            requested_count: requestedItemCount,
            candidate_pool_before_dedup: Array.isArray(enriched) ? enriched.length : 0,
            candidate_pool_after_dedup: userItems.length,
            thin_pool: incompleteTopics.length > 0 || requestedItemCount === 0,
            dominant_failure_mode: incompleteTopics.length > 0
              ? "underfilled_topic_bucket"
              : (requestedItemCount === 0 ? "no_standard_topics" : null),
          };
          deliverySelection = buildDeliverySelection(bucketItems, topicBuckets, requestedItemCount, incompleteTopics);
          candidateDisplayItems = sortDigestItemsByScoreDescending(applyDigestDepth(userItems, depth));
        }
        const previousDigestItems = Array.isArray(user.last_digest_items) ? user.last_digest_items : [];
        const candidateDigestQuality = computeDigestQualityScore({
          items: candidateDisplayItems,
          user,
          previous_items: previousDigestItems,
        });
        internalThinnessLabel = deriveInternalThinnessLabel({
          availableCandidateCount: userItems.length,
          highConfidenceAvailableCount: deliverySelection.available_count,
        });
        const deliveryEligible = deliverySelection.delivery_eligible === true;
        const deliveryItems = deliveryEligible
          ? sortDigestItemsByScoreDescending(applyDigestDepth(deliverySelection.items, depth))
          : [];
        digestQuality = deliveryEligible
          ? computeDigestQualityScore({
            items: deliveryItems,
            user,
            previous_items: previousDigestItems,
          })
          : candidateDigestQuality;
        selectedSnapshotItems = buildDigestSnapshotItems(
          deliveryEligible ? deliveryItems : candidateDisplayItems,
          parseSourceDomain
        );
        quickScan = buildQuickScanText(deliveryEligible ? deliveryItems : candidateDisplayItems, stripInlineHtml);
        const eventItems = buildDigestSnapshotItems(deliveryItems, parseSourceDomain).map((item) => ({
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
            depth,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            delivery_outcome: deliveryEligible ? "delivered" : null,
            attempt_count: attemptCount,
            selected_count: deliverySelection.selected_count,
            available_count: deliverySelection.available_count,
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }

        // --- shipping contract guard: each delivered digest must contain 5 items ---
        if (!deliveryEligible) {
          const failureClass = requestedItemCount <= 0
            ? "no_standard_topics"
            : (strictQualityEnabled
              ? String(deliveryDiagnostics.dominant_failure_mode || "no_passing_topic_buckets")
              : classifyRetryFailureClass({
                diagnostics: {
                  thin_pool: deliveryDiagnostics.thin_pool,
                  dominant_failure_mode: deliveryDiagnostics.dominant_failure_mode,
                  provider_429_count: deliveryDiagnostics.provider_429_count,
                  transport_errors: deliveryDiagnostics.provider_transport_errors,
                  provider_degraded: deliveryDiagnostics.provider_degraded,
                },
                availableCandidateCount: userItems.length,
              }));
          const retryableScheduledAttempt = deliveryMode === "scheduled"
            && attemptCount === 1
            && isRetryEligibleFailureClass(failureClass);
          const latestSafeDelay = computeRemainingWindowMinutes(CONFIG?.digest?.catchupWindowMinutes, prefs, now) - 5;
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
              requested_count: requestedItemCount,
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
              requested_count: requestedItemCount,
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
              depth,
              withheld_reason: failureClass,
              delivery_outcome: deliveryOutcome,
              retry_scheduled_for: retryScheduledFor,
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              attempt_count: attemptCount,
              selected_count: deliverySelection.selected_count,
              available_count: deliverySelection.available_count,
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
            selected_count: deliverySelection.selected_count,
            available_count: deliverySelection.available_count,
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
          });
          continue;
        }

        // --- quality floor guard: withhold delivery if quality is too low ---
        const minDeliveryQualityScore = Number(CONFIG.digest?.minDeliveryQualityScore ?? 25);
        if (!strictQualityEnabled && (deliveryItems.length === 0 || digestQuality.score < minDeliveryQualityScore)) {
          const withholdReason = deliveryItems.length === 0 ? "empty_items" : "quality_below_floor";
          log(`  skip delivery for ${user.email || userId}: ${withholdReason} (score=${digestQuality.score}, min=${minDeliveryQualityScore})`);
          scheduleRetryState({
            user_id: userId,
            date_et: digestDateKey,
            attempt_count: attemptCount,
            next_retry_at: null,
            underfill_reason: withholdReason,
            requested_count: requestedItemCount,
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
              depth,
              withheld_reason: withholdReason,
              delivery_outcome: attemptCount > 1 ? "withheld_after_retry" : "withheld_after_retry_window",
              quality_score: digestQuality.score,
              quality_band: digestQuality.band,
              attempt_count: attemptCount,
              selected_count: deliverySelection.selected_count,
              available_count: deliverySelection.available_count,
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
            selected_count: deliverySelection.selected_count,
            available_count: deliverySelection.available_count,
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
          });
          continue;
        }

        const userQuickScan = buildUserQuickScanRows(deliveryItems, {
          stripInlineHtml,
          topicVisual,
          escapeHtml,
        });
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
            depth,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            delivery_outcome: "delivered",
            attempt_count: attemptCount,
            selected_count: deliverySelection.selected_count,
            available_count: deliverySelection.available_count,
            internal_thinness_label: internalThinnessLabel,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }

        if (user.email && prefs.email_enabled !== false) {
          attemptedChannelCount += 1;
          const subjectResult = await generateLeadSubjectLine(deliveryItems[0] || null, now);
          claudeUsage.input_tokens += Number(subjectResult?.usage?.input_tokens || 0);
          claudeUsage.output_tokens += Number(subjectResult?.usage?.output_tokens || 0);

          const noteResult = await generateEditorialNote(deliveryItems);
          claudeUsage.input_tokens += Number(noteResult?.usage?.input_tokens || 0);
          claudeUsage.output_tokens += Number(noteResult?.usage?.output_tokens || 0);
          subjectLine = String(subjectResult?.subject || "").trim() || null;
          editorialNote = String(noteResult?.note || "").trim();

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
              editorialNote,
            }
          );
          if (user.token) {
            const trackingPixel = buildOpenTrackingPixel(userDigestId, user.token, getBaseUrl());
            userEmailHtml = /<\/body>/i.test(userEmailHtml)
              ? userEmailHtml.replace(/<\/body>/i, `${trackingPixel}\n</body>`)
              : `${userEmailHtml}\n${trackingPixel}`;
          }
          try {
            await sendEmail(user.email, subjectLine || subjectResult.subject, userEmailHtml, user.token || null);
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
            depth,
            subject_line: subjectLine,
            editorial_note: editorialNote,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            delivery_outcome: "delivered",
            attempt_count: attemptCount,
            selected_count: deliverySelection.selected_count,
            available_count: deliverySelection.available_count,
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
          digest_id: userDigestId,
          delivery_mode: deliveryMode,
          delivery_version: deliveryRecordVersion,
          digest_quality_score: Number.isFinite(Number(digestQuality?.score))
            ? Number(digestQuality.score.toFixed(2))
            : null,
          digest_quality_band: String(digestQuality?.band || "") || null,
          delivery_outcome: "delivered",
          selected_count: deliverySelection.selected_count,
          available_count: deliverySelection.available_count,
          digest_url: String(publicDigestUrl || ""),
          engagement_event_failures: engagementWriteFailures,
          ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
        });

        const eventWriteSuffix = engagementWriteFailures > 0
          ? `, event_writes_failed=${engagementWriteFailures}`
          : "";
        log(`✅ Delivered to ${user.email || user.chatId} (${deliveryItems.length} items, depth=${depth}, dqs=${digestQuality.score.toFixed(1)}${eventWriteSuffix})`);
      } catch (err) {
        const failureRetry = scheduleScheduledDeliveryFailureRetry({
          deliveryMode,
          userId,
          dateKey: digestDateKey,
          attemptCount,
          prefs,
          now,
          attemptedChannelCount,
          requestedItemCount,
        });
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
            delivery_outcome: failureRetry?.deliveryOutcome || null,
            retry_scheduled_for: failureRetry?.retryScheduledFor || null,
            attempt_count: attemptCount,
            selected_count: deliverySelection.selected_count,
            available_count: deliverySelection.available_count,
            internal_thinness_label: internalThinnessLabel,
            date_str: dateStr,
            quick_scan: quickScan,
            depth,
            subject_line: subjectLine,
            editorial_note: editorialNote,
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            ...buildDeliveryDiagnosticsFields(deliveryDiagnostics),
            items: selectedSnapshotItems,
          });
        }
        failedUsers.push({
          id: user.email || user.chatId,
          error: err.message,
          delivery_outcome: failureRetry?.deliveryOutcome || null,
          retry_scheduled_for: failureRetry?.retryScheduledFor || null,
        });
        const retrySuffix = failureRetry?.retryScheduledFor
          ? `; retry scheduled ${failureRetry.retryScheduledFor}`
          : (failureRetry?.deliveryOutcome ? `; retry halted (${failureRetry.deliveryOutcome})` : "");
        log(`❌ Failed delivery to ${user.email || user.chatId}: ${err.message}${retrySuffix}`);
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
