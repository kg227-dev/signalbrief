"use strict";

const { createDigestOrchestratorDeliveryRankingRuntime } = require("./digest-orchestrator-delivery-ranking-runtime");

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
      baseScore: Number.isFinite(Number(item?.baseScore)) ? Number(item.baseScore) : null,
      topicMatch: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
      relevanceScore: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
      why_shown: Array.isArray(item?.why_shown) ? item.why_shown.slice() : [],
      entity_keys: Array.isArray(item?.entity_keys) ? item.entity_keys.slice() : [],
      storyline_id: item?.storyline_id || null,
      storyline_key: item?.storyline_key || null,
      storyline_size: Number.isFinite(Number(item?.storyline_size)) ? Number(item.storyline_size) : null,
      supporting_sources: Array.isArray(item?.supporting_sources) ? item.supporting_sources.slice() : [],
      supporting_headlines: Array.isArray(item?.supporting_headlines) ? item.supporting_headlines.slice() : [],
      cross_source_count: Number.isFinite(Number(item?.cross_source_count)) ? Number(item.cross_source_count) : null,
      content_flags: Array.isArray(item?.content_flags) ? item.content_flags.slice() : [],
      source_tier: item?.source_tier || null,
      source_authority: Number.isFinite(Number(item?.source_authority)) ? Number(item.source_authority) : null,
      strategic_value: Number.isFinite(Number(item?.strategic_value)) ? Number(item.strategic_value) : null,
      routine_item_score: Number.isFinite(Number(item?.routine_item_score)) ? Number(item.routine_item_score) : null,
      score_breakdown: item?.score_breakdown && typeof item.score_breakdown === "object"
        ? { ...item.score_breakdown }
        : null,
    }));
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
    } = params;

    const deliveredUsers = [];
    const failedUsers = [];

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
            limit: Math.max(1, Number(CONFIG.digest.perUserEntityHistoryDigests || 3)),
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
        const learningSummary = autoLearning.changed
          ? buildLearningSummary(autoLearning.adjustments, 2)
          : "";

        const ranked = rankingRuntime.rankAndSuppressUserItems({
          user,
          enriched,
          repeatIndex,
          repeatPenalty,
          depthPolicy,
          rankingPolicy,
          recentDigestRecords,
          nowIso: now.toISOString(),
        });
        let userItems = ranked.userItems;
        const wasFiltered = ranked.wasFiltered;
        const prefs = user.preferences || {};

        const depth = prefs.depth || "full";
        userItems = applyDigestDepth(userItems, depth);

        const previousDigestItems = Array.isArray(user.last_digest_items) ? user.last_digest_items : [];
        const digestQuality = computeDigestQualityScore({
          items: userItems,
          user,
          previous_items: previousDigestItems,
        });
        selectedSnapshotItems = buildDigestSnapshotItems(userItems);
        quickScan = buildQuickScanText(userItems);
        const eventItems = selectedSnapshotItems.map((item) => ({
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
            quality_score: digestQuality.score,
            quality_band: digestQuality.band,
            items: selectedSnapshotItems,
          });
        }

        const userQuickScan = buildUserQuickScanRows(userItems);
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
            items: selectedSnapshotItems,
          });
        }

        if (user.chatId && !user.chatId.startsWith("email-") && prefs.telegram_enabled !== false) {
          const userTelegram = formatTelegram(userItems, shortDate, user, {
            digestQuality,
            learningSummary,
            publicDigestUrl,
          });
          const userKeyboard = buildDigestInlineKeyboard(userItems);
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
                item_count: userItems.length,
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
          const subjectResult = await generateLeadSubjectLine(userItems[0] || null, now);
          claudeUsage.input_tokens += Number(subjectResult?.usage?.input_tokens || 0);
          claudeUsage.output_tokens += Number(subjectResult?.usage?.output_tokens || 0);

          const noteResult = await generateEditorialNote(userItems);
          claudeUsage.input_tokens += Number(noteResult?.usage?.input_tokens || 0);
          claudeUsage.output_tokens += Number(noteResult?.usage?.output_tokens || 0);

          let userEmailHtml = buildEmail(
            userItems,
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
                item_count: userItems.length,
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
            items: selectedSnapshotItems,
          });
        }

        const currentUrlKeys = [...new Set(
          userItems
            .map((item) => normalizeUrlForDedup(item?.url))
            .filter(Boolean)
        )];
        const priorUrlHistory = Array.isArray(user.recent_digest_url_history)
          ? user.recent_digest_url_history.slice()
          : [];
        priorUrlHistory.push({
          date_et: digestDateKey,
          digest_id: userDigestId,
          urls: currentUrlKeys,
        });
        user.recent_digest_url_history = priorUrlHistory.slice(-Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3)));
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
          digest_url: String(publicDigestUrl || ""),
          engagement_event_failures: engagementWriteFailures,
        });

        const eventWriteSuffix = engagementWriteFailures > 0
          ? `, event_writes_failed=${engagementWriteFailures}`
          : "";
        log(`✅ Delivered to ${user.email || user.chatId} (${userItems.length} items, depth=${depth}, dqs=${digestQuality.score.toFixed(1)}${eventWriteSuffix})`);
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
    };
  }

  return {
    deliverDueUsers,
  };
}

module.exports = {
  createDigestOrchestratorDeliveryRuntime,
};
