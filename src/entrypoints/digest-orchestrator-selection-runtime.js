"use strict";

function computeMaxCustomItems({ configuredMaxCustom, selectionTarget, customTags }) {
  const defaultMaxCustom = (Array.isArray(customTags) && customTags.length > 0)
    ? Math.max(1, Math.floor(selectionTarget * 0.4))
    : 0;
  return Number.isFinite(configuredMaxCustom) && configuredMaxCustom >= 0
    ? configuredMaxCustom
    : defaultMaxCustom;
}

function createDigestOrchestratorSelectionRuntime(deps) {
  const {
    CONFIG,
    log,
    createDigestPolicies,
    dedupAgainstRecentArchives,
    buildRecentRepeatIndex,
    selectItems,
    loadRecentArchiveItems,
    loadRecentArchiveByDate,
    buildRepeatHistory,
    filterItemsAgainstHistory,
    buildRepetitionNote,
    emitDigestIncident,
    articleAgeTooOld,
  } = deps;

  async function selectForEnrichment(params) {
    const {
      allItems,
      selectionTarget,
      customTags,
      tagPriority,
      runMode,
      digestDateKey,
      dueUsersCount,
      standardFetchCallsPlanned,
    } = params;

    const crossDayDedupDays = Math.max(1, Number(CONFIG.digest.crossDayDedupDays || 3));
    const digestPolicies = createDigestPolicies(CONFIG.digest || {});
    const rankingPolicy = digestPolicies.rankingPolicy;
    const depthPolicy = digestPolicies.depthPolicy;
    const dedupRes = dedupAgainstRecentArchives(allItems, {
      days: crossDayDedupDays,
      targetCount: selectionTarget,
      minBackfillItems: Math.max(1, Number(CONFIG.digest.minBackfillItemsAfterDedup || depthPolicy.defaultItemCount || 5)),
    });
    const scheduledDefaultMaxAgeHours = runMode === "scheduled" ? 48 : 72;
    const maxArticleAgeHours = Number(CONFIG.digest.maxArticleAgeHours || scheduledDefaultMaxAgeHours);
    const ageFilter = typeof articleAgeTooOld === "function" ? articleAgeTooOld : () => false;
    const freshItems = dedupRes.items.filter((item) => !ageFilter(item, maxArticleAgeHours));
    const staleRemoved = dedupRes.items.length - freshItems.length;
    if (staleRemoved > 0) {
      log(`Freshness gate removed ${staleRemoved} stale item(s) older than ${maxArticleAgeHours}h`);
    }
    const repeatIndex = buildRecentRepeatIndex(crossDayDedupDays);
    const repeatPenalty = Number(rankingPolicy.repeatPenalty || 0);

    if (dedupRes.removed > 0) {
      log(`Cross-day dedup removed ${dedupRes.removed} repeat item(s) using last ${dedupRes.archive_days_used} day(s) of archive history${dedupRes.backfilled > 0 ? ` (backfilled ${dedupRes.backfilled} to minimum)` : ""}`);
    }
    if ((repeatIndex.urlKeys.size > 0 || repeatIndex.headlineKeys.size > 0) && repeatPenalty > 0) {
      log(`Freshness penalty active (days=${repeatIndex.days}, penalty=${repeatPenalty.toFixed(2)})`);
    }

    // Longitudinal history filter: suppress same storylines seen in past 7 days
    // unless the item introduces new entities or content flags (materially new).
    const historyLookbackDays = Math.max(4, Number(CONFIG.digest?.historyLookbackDays || 7));
    const archiveByDate = typeof loadRecentArchiveByDate === "function"
      ? loadRecentArchiveByDate(historyLookbackDays)
      : [];
    const repeatHistoryMap = typeof buildRepeatHistory === "function"
      ? buildRepeatHistory(archiveByDate)
      : new Map();
    const historyResult = typeof filterItemsAgainstHistory === "function"
      ? filterItemsAgainstHistory(freshItems, repeatHistoryMap, String(digestDateKey || ""), {
        suppressWithinDays: 3,
        frequentThreshold: 3,
      })
      : { items: freshItems, suppressedCount: 0, suppressedFrequentCount: 0, streaks: [] };

    if (historyResult.suppressedCount > 0) {
      log(`Longitudinal history filter suppressed ${historyResult.suppressedCount} repeat item(s) from last ${historyLookbackDays} days (streaks: ${historyResult.streaks.length})`);
    }
    const dedupedItems = historyResult.items;
    const repetitionNote = typeof buildRepetitionNote === "function"
      ? buildRepetitionNote(historyResult.streaks, historyResult.suppressedCount)
      : "";

    const configuredMaxCustom = Number(CONFIG.digest.maxCustomItemsPerRun);
    const maxCustomItems = computeMaxCustomItems({
      configuredMaxCustom,
      selectionTarget,
      customTags,
    });

    let selected = selectItems(dedupedItems, {
      maxItems: selectionTarget,
      maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
      customTags,
      maxCustomItems,
      tagPriority,
      maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
    });

    if (selected.length === 0) {
      const fallbackPool = loadRecentArchiveItems(5);
      if (fallbackPool.length > 0) {
        selected = selectItems(fallbackPool, {
          maxItems: selectionTarget,
          maxItemsPerTag: CONFIG.digest.maxItemsPerTag,
          customTags: [],
          maxCustomItems: 0,
          tagPriority,
          maxItemsPerSourceDomain: CONFIG.digest.maxItemsPerSourceDomain,
        });
        log(`⚠️ Live fetch produced no selectable items; using archive fallback pool (${fallbackPool.length} items, selected=${selected.length})`);
        await emitDigestIncident(
          "archive-fallback-engaged",
          `Live fetch produced zero selectable items; archive fallback selected ${selected.length}`,
          {
            mode: runMode,
            due_users: dueUsersCount,
            standard_topics: standardFetchCallsPlanned,
            selected_items: selected.length,
          }
        );
      }
    }

    if (selected.length === 0) {
      await emitDigestIncident(
        "no-selectable-items",
        "No selectable items after archive fallback; digest run aborted",
        {
          mode: runMode,
          due_users: dueUsersCount,
          standard_topics: standardFetchCallsPlanned,
          selected_items: 0,
        }
      );
      throw new Error("No items available from live fetch or archive fallback; digest aborted");
    }

    log(`Selected ${selected.length} items (target=${selectionTarget}, customCap=${maxCustomItems}, sourceCap=${Number(CONFIG.digest.maxItemsPerSourceDomain || 2)})`);

    return {
      selected,
      repeatIndex,
      repeatPenalty,
      rankingPolicy,
      depthPolicy,
      repetitionNote,
      selectionDiagnostics: {
        candidate_pool_before_dedup: Array.isArray(allItems) ? allItems.length : 0,
        candidate_pool_after_dedup: dedupedItems.length,
        archive_repeat_block_count: Math.max(0, Number(dedupRes.removed || 0)),
        stale_removed_count: Math.max(0, Number(staleRemoved || 0)),
        history_suppressed_count: Math.max(0, Number(historyResult.suppressedCount || 0)),
        history_lookback_days: historyLookbackDays,
        history_streaks_detected: historyResult.streaks.length,
      },
    };
  }

  return {
    selectForEnrichment,
  };
}

module.exports = {
  createDigestOrchestratorSelectionRuntime,
  computeMaxCustomItems,
};
