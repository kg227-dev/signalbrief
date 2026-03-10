"use strict";

function createDigestOrchestratorDeliveryRuntime(deps) {
  const {
    CONFIG,
    log,
    applyAutoTopicLearning,
    writeUser,
    buildLearningSummary,
    filterItemsByTopics,
    applyTopicRelevanceScores,
    suppressRecentlySentForUser,
    isRecentRepeatItem,
    parseSourceDomain,
    reserveCustomKeywordSlot,
    applyDigestDepth,
    computeDigestQualityScore,
    buildDigestId,
    appendEngagementEventChecked,
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
      claudeUsage,
      engagementEvents,
    } = params;

    const deliveredUsers = [];
    const failedUsers = [];

    for (let user of dueUsers) {
      try {
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

        const prefs = user.preferences || {};

        let wasFiltered = false;
        let userItems = enriched;
        let customKeywords = [];
        let specialistMode = false;
        const filteredResult = filterItemsByTopics(enriched, user.topics || [], {
          minItems: depthPolicy.minFilteredItems,
          strictZeroFallback: "specialist",
        });
        customKeywords = filteredResult.customKeywords || [];
        specialistMode = Boolean(filteredResult.specialistMode);
        userItems = filteredResult.items;
        wasFiltered = filteredResult.wasFiltered;

        const weights = user.topic_weights || {};
        const hasWeights = Object.values(weights).some((value) => value !== 0);

        if (hasWeights) {
          log(`  [weights] ${user.email || user.chatId}: ${JSON.stringify(weights)}`);
          log(`  [pre-sort] ${userItems.map((item) => `${item.tag}(${item.baseScore})`).join(", ")}`);
        }

        userItems = applyTopicRelevanceScores(userItems, user.topics || [], weights, {
          specialistMode,
          repeatPenalty,
          isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
          sourceDomainForItem: parseSourceDomain,
        });
        userItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

        const minBaseScoreForFinal = Number(rankingPolicy.minBaseScoreForFinal || 6.5);
        const requestedCount = Number(prefs.items_per_digest || depthPolicy.defaultItemCount || 5);
        const perUserFreshnessMin = Math.max(1, Math.min(requestedCount, Number(CONFIG.digest.perUserFreshnessMinItems || 3)));
        const suppression = suppressRecentlySentForUser(userItems, user, {
          maxDigests: Math.max(1, Number(CONFIG.digest.perUserFreshnessDigests || 3)),
          minItems: perUserFreshnessMin,
        });
        if (suppression.removed > 0) {
          userItems = suppression.items;
          log(`  [freshness-user] ${user.email || user.chatId}: removed ${suppression.removed} recent URL repeat(s)${suppression.backfilled > 0 ? `, backfilled ${suppression.backfilled}` : ""}`);
        }

        const minStrongItems = Math.max(2, Math.min(requestedCount, 4));
        const stronger = userItems.filter((item) =>
          Number(item?.baseScore || 0) >= minBaseScoreForFinal
          || (Array.isArray(item?.why_shown) && item.why_shown.includes("custom_keyword"))
        );
        if (stronger.length >= minStrongItems) {
          userItems = stronger;
        }

        if (hasWeights) {
          log(`  [post-sort] ${userItems.map((item) => `${item.tag}(${item.relevanceScore})`).join(", ")}`);
        }

        const count = requestedCount;
        userItems = reserveCustomKeywordSlot(userItems, count, customKeywords);

        if (userItems.length === 0) {
          const emergencyCount = Math.max(1, Math.min(3, count));
          const emergency = applyTopicRelevanceScores(enriched, user.topics || [], weights, {
            specialistMode: false,
            repeatPenalty,
            isRecentRepeat: (item) => isRecentRepeatItem(item, repeatIndex),
            sourceDomainForItem: parseSourceDomain,
          })
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, emergencyCount);
          if (emergency.length > 0) {
            userItems = emergency;
            wasFiltered = false;
            log(`⚠️ Emergency fallback items used for ${user.email || user.chatId} (count=${emergency.length})`);
          }
        }
        if (userItems.length === 0) {
          throw new Error("No deliverable items after emergency fallback");
        }

        const depth = prefs.depth || "full";
        userItems = applyDigestDepth(userItems, depth);

        const previousDigestItems = Array.isArray(user.last_digest_items) ? user.last_digest_items : [];
        const digestQuality = computeDigestQualityScore({
          items: userItems,
          user,
          previous_items: previousDigestItems,
        });
        const userDigestId = buildDigestId(digestDateKey, user.chatId);
        const eventItems = userItems.map((item, idx) => ({
          index: idx + 1,
          headline: item?.headline || null,
          url: item?.url || null,
          tag: item?.tag || null,
          base_score: Number.isFinite(Number(item?.baseScore)) ? Number(item.baseScore) : null,
          topic_match: Number.isFinite(Number(item?.topicMatch)) ? Number(item.topicMatch) : null,
          relevance_score: Number.isFinite(Number(item?.relevanceScore)) ? Number(item.relevanceScore) : null,
        }));

        const userQuickScan = buildUserQuickScanRows(userItems);
        const isFirstDigest = !user.welcome_email_sent && !suppressWelcome;

        let delivered = false;
        let engagementWriteFailures = 0;

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
              event_key: `digest_sent:${userDigestId}:telegram`,
              date_et: digestDateKey,
              user_chat_id: String(user.chatId),
              user_email: user.email || null,
              digest_id: userDigestId,
              run_id: runId,
              channel: "telegram",
              source: targetChatId ? "on-demand" : "scheduled-job",
              metadata: {
                item_count: userItems.length,
                depth,
                quality_score: digestQuality.score,
                quality_band: digestQuality.band,
                quality_components: digestQuality.components,
                items: eventItems,
              },
            }, { scope: "digest", context: `digest_sent:telegram:${user.email || user.chatId}`, log });
            if (!eventOutcome.ok) engagementWriteFailures += 1;
            delivered = true;
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
              event_key: `digest_sent:${userDigestId}:email`,
              date_et: digestDateKey,
              user_chat_id: String(user.chatId),
              user_email: user.email || null,
              digest_id: userDigestId,
              run_id: runId,
              channel: "email",
              source: targetChatId ? "on-demand" : "scheduled-job",
              metadata: {
                item_count: userItems.length,
                depth,
                quality_score: digestQuality.score,
                quality_band: digestQuality.band,
                quality_components: digestQuality.components,
                items: eventItems,
              },
            }, { scope: "digest", context: `digest_sent:email:${user.email || user.chatId}`, log });
            if (!eventOutcome.ok) engagementWriteFailures += 1;
            delivered = true;
            if (isFirstDigest || suppressWelcome) user.welcome_email_sent = true;
          } catch (err) {
            log(`⚠️ Email delivery failed for ${user.email || user.chatId}: ${err.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 600));
        }

        if (!delivered) throw new Error("no channels succeeded");

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
        user.last_digest_items = userItems.map((item) => ({
          headline: item.headline,
          url: item.url,
          tag: item.tag,
          source: item.source,
          source_domain: item.source_domain || parseSourceDomain(item),
          why_shown: Array.isArray(item.why_shown) ? item.why_shown : [],
        }));

        const todayDateKey = formatEtDateKey(now);
        if (!user.digest_dates) user.digest_dates = [];
        if (!user.digest_dates.includes(todayDateKey)) user.digest_dates.push(todayDateKey);

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
          engagement_event_failures: engagementWriteFailures,
        });

        const eventWriteSuffix = engagementWriteFailures > 0
          ? `, event_writes_failed=${engagementWriteFailures}`
          : "";
        log(`✅ Delivered to ${user.email || user.chatId} (${userItems.length} items, depth=${depth}, dqs=${digestQuality.score.toFixed(1)}${eventWriteSuffix})`);
      } catch (err) {
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
