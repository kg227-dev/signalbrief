"use strict";

const { scoreCandidates } = require("../domains/scoring/score-candidate");

function computeItemAgeHours(item, nowMs) {
  const ts = item?.published_date || item?.published_at || item?.date || item?.timestamp;
  if (!ts) return Infinity;
  const ms = typeof ts === "number" ? ts : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return Infinity;
  return Math.max(0, (nowMs - ms) / (1000 * 60 * 60));
}

function splitByFreshnessTiers(items, nowMs) {
  const tier1 = []; // 0–24h: breaking / today
  const tier2 = []; // 24–48h: yesterday
  const tier3 = []; // 48h+: analysis / commentary
  for (const item of (Array.isArray(items) ? items : [])) {
    const age = computeItemAgeHours(item, nowMs);
    if (age <= 24) tier1.push(item);
    else if (age <= 48) tier2.push(item);
    else tier3.push(item);
  }
  return { tier1, tier2, tier3 };
}

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
      loadRecentArchiveByDate,
      buildRepeatHistory,
    filterItemsAgainstHistory,
    buildRepetitionNote,
    emitDigestIncident,
    articleAgeTooOld,
    classifyStoryRelationship,
    loadEditorialOverrides,
    editorialOverridesPath,
    isUrlExcluded,
    isDomainSuppressed,
    getPinsForDate,
  } = deps;

  async function selectForEnrichment(params) {
    const {
      selectionTarget,
      customTags,
      tagPriority,
      runMode,
      digestDateKey,
      dueUsersCount,
      standardFetchCallsPlanned,
      scoringConfig: paramScoringConfig,
    } = params;
    let allItems = params.allItems; // must be let — editorial override block reassigns it below

    const todayStr = String(digestDateKey || "").slice(0, 10);

    // Apply editorial overrides: excludes, domain suppressions, and pins.
    let editorialOverrides = { pins: [], excludes: [], source_suppressions: [] };
    if (typeof loadEditorialOverrides === "function" && editorialOverridesPath) {
      editorialOverrides = loadEditorialOverrides(editorialOverridesPath);
    }

    // Remove excluded URLs
    const excludedCount = allItems.filter((item) =>
      isUrlExcluded(String(item?.url || ""), editorialOverrides.excludes, todayStr)
    ).length;
    if (excludedCount > 0) {
      log(`Editorial overrides: excluded ${excludedCount} item(s) by URL`);
    }
    allItems = allItems.filter((item) =>
      !isUrlExcluded(String(item?.url || ""), editorialOverrides.excludes, todayStr)
    );

    // Remove domain-suppressed items
    const suppressedCount = allItems.filter((item) => {
      const domain = String(item?.source_domain || item?.source || "").toLowerCase();
      return isDomainSuppressed(domain, editorialOverrides.source_suppressions, todayStr);
    }).length;
    if (suppressedCount > 0) {
      log(`Editorial overrides: suppressed ${suppressedCount} item(s) by source domain`);
    }
    allItems = allItems.filter((item) => {
      const domain = String(item?.source_domain || item?.source || "").toLowerCase();
      return !isDomainSuppressed(domain, editorialOverrides.source_suppressions, todayStr);
    });

    // Inject pinned items (mark them so selection policy keeps them)
    const activePins = typeof getPinsForDate === "function"
      ? getPinsForDate(editorialOverrides.pins, todayStr)
      : [];
    if (activePins.length > 0) {
      const existingUrls = new Set(allItems.map((item) => String(item?.url || "").trim()));
      let injectedCount = 0;
      for (const pin of activePins) {
        const pinUrl = String(pin?.url || "").trim();
        if (!pinUrl || existingUrls.has(pinUrl)) continue;
        // Inject as a high-priority synthetic item so it survives scoring
        allItems.push({
          url: pinUrl,
          headline: pin.note || `Pinned: ${pinUrl}`,
          tag: String(pin.topic || "").trim().toUpperCase() || "__pinned__",
          _editorial_pin: true,
          _score: 1.0, // ensures it is not filtered by score
          source: "editorial-pin",
          source_domain: "editorial-pin",
          source_tier: 1,
        });
        existingUrls.add(pinUrl);
        injectedCount += 1;
      }
      if (injectedCount > 0) {
        log(`Editorial overrides: injected ${injectedCount} pinned item(s)`);
      }
    }

    const crossDayDedupDays = Math.max(1, Number(
      (paramScoringConfig && paramScoringConfig.crossDayDedupDays != null)
        ? paramScoringConfig.crossDayDedupDays
        : (CONFIG.digest.crossDayDedupDays || 3)
    ));
    const digestPolicies = createDigestPolicies(CONFIG.digest || {});
    const rankingPolicy = digestPolicies.rankingPolicy;
    const depthPolicy = digestPolicies.depthPolicy;
    const dedupRes = dedupAgainstRecentArchives(allItems, {
      days: crossDayDedupDays,
      targetCount: selectionTarget,
      minBackfillItems: Math.max(1, Number(CONFIG.digest.minBackfillItemsAfterDedup || depthPolicy.defaultItemCount || 5)),
    });
    const configuredMaxAgeHours = Number(CONFIG.digest.maxArticleAgeHours || 48);
    const maxArticleAgeHours = Number.isFinite(configuredMaxAgeHours)
      ? Math.min(48, Math.max(1, configuredMaxAgeHours))
      : 48;
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
    const historyLookbackDays = Math.max(4, Number(
      (paramScoringConfig && paramScoringConfig.historyLookbackDays != null)
        ? paramScoringConfig.historyLookbackDays
        : (CONFIG.digest?.historyLookbackDays || 7)
    ));
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

    // Cross-day story relationship annotation (§2.3)
    // Uses the same archive window as history suppression.
    // Continuation items are removed; follow_up items are annotated and kept.
    let annotatedItems = dedupedItems;
    let continuationRemovedCount = 0;
    let followUpCount = 0;

    if (typeof classifyStoryRelationship === "function") {
      // Build a flat list of past headlines from the archive-by-date result.
      const pastItems = [];
      for (const dateEntry of (Array.isArray(archiveByDate) ? archiveByDate : [])) {
        if (Array.isArray(dateEntry?.items)) {
          for (const archiveItem of dateEntry.items) {
            if (archiveItem?.headline) pastItems.push(archiveItem);
          }
        }
      }

      const classified = [];
      for (const item of dedupedItems) {
        const relationship = classifyStoryRelationship(item, pastItems);
        if (relationship === "continuation") {
          continuationRemovedCount += 1;
          // Skip: same story, no meaningful update
          continue;
        }
        classified.push({ ...item, _story_relationship: relationship });
        if (relationship === "follow_up") followUpCount += 1;
      }
      annotatedItems = classified;

      if (continuationRemovedCount > 0) {
        log(`Story classification: removed ${continuationRemovedCount} continuation item(s), ${followUpCount} follow_up item(s) passed through`);
      }
    }

    const scoringInput = annotatedItems;

    const configuredMaxCustom = Number(CONFIG.digest.maxCustomItemsPerRun);
    const maxCustomItems = computeMaxCustomItems({
      configuredMaxCustom,
      selectionTarget,
      customTags,
    });

    // MVP transparent scoring: score every candidate before selection.
    // The formula (spec §2.4): score = freshness×0.35 + source_tier×0.35 + lane_bonus×0.15 + novelty×0.15
    // Scored items are sorted by _score descending so the selection policy
    // always sees the highest-scoring items first.
    const scoringConfig = paramScoringConfig && typeof paramScoringConfig === "object"
      ? paramScoringConfig
      : (CONFIG.digest?.scoring || {});
    const nowMs = Date.now();
    const scoredItems = scoreCandidates(scoringInput, { scoringConfig, nowMs });
    if (scoredItems.length > 0) {
      const topScore = scoredItems[0]?._score?.toFixed(3) ?? "?";
      const bottomScore = scoredItems[scoredItems.length - 1]?._score?.toFixed(3) ?? "?";
      log(`Scored ${scoredItems.length} candidate(s): top=${topScore}, bottom=${bottomScore}`);
    }

    // MVP per-topic selection: group candidates by tag, select up to itemsPerTopic
    // per topic, then cap discovery-origin (Perplexity) items to at most 1 per topic.
    const itemsPerTopic = Math.max(1, Number(CONFIG.digest.itemCount || selectionTarget || 5));
    const maxDiscoveryPerTopic = Math.max(0, Number(CONFIG.digest.maxDiscoveryItemsPerTopic ?? 1));

    // Group scored+sorted candidates by topic tag.
    const byTag = new Map();
    for (const item of scoredItems) {
      const topicTag = String(item?.tag || "").trim().toUpperCase() || "__untagged__";
      if (!byTag.has(topicTag)) byTag.set(topicTag, []);
      byTag.get(topicTag).push(item);
    }

    // Select per topic with freshness-tier fallback, then apply discovery cap.
    // Spec §2.5: prefer 0-24h items first, backfill 24-48h, then 48h+ as last resort.
    const perTopicSelected = [];
    let totalDiscoveryCapped = 0;
    for (const [topicTag, topicItems] of byTag.entries()) {
      // Build tiered pool: tier1 (0-24h) first for freshness preference, then tier2, then tier3.
      // Pass the full ordered pool to selectItems so its source-domain cap can pick from the
      // widest possible set rather than a pre-truncated slice.
      const { tier1, tier2, tier3 } = splitByFreshnessTiers(topicItems, nowMs);
      const tieredPool = [...tier1, ...tier2, ...tier3];

      const topicPool = selectItems(tieredPool, {
        maxItems: itemsPerTopic,
        maxItemsPerTag: itemsPerTopic,
        customTags: [],
        maxCustomItems: 0,
        tagPriority,
        maxItemsPerSourceDomain: (paramScoringConfig && paramScoringConfig.maxItemsPerSourceDomain != null)
          ? paramScoringConfig.maxItemsPerSourceDomain
          : CONFIG.digest.maxItemsPerSourceDomain,
      });

      if (topicPool.length < itemsPerTopic) {
        log(`⚠️ Topic ${topicTag}: only ${topicPool.length}/${itemsPerTopic} items selected (t1=${tier1.length}, t2=${tier2.length}, t3=${tier3.length}, pool=${tieredPool.length})`);
      }

      let discoveryCount = 0;
      for (const item of topicPool) {
        const origin = String(item?.retrieval_origin || item?.retrieval_lane || "").toLowerCase();
        const isDiscovery = origin.includes("discovery") || origin.includes("perplexity");
        if (isDiscovery) {
          discoveryCount += 1;
          if (discoveryCount > maxDiscoveryPerTopic) {
            totalDiscoveryCapped += 1;
            continue;
          }
        }
        perTopicSelected.push(item);
      }
    }
    let selected = perTopicSelected;
    if (totalDiscoveryCapped > 0) {
      log(`Discovery cap removed ${totalDiscoveryCapped} Perplexity item(s) (max ${maxDiscoveryPerTopic} per topic)`);
    }

    if (selected.length === 0) {
      await emitDigestIncident(
        "no-selectable-items",
        "No selectable live items; digest run aborted",
        {
          mode: runMode,
          due_users: dueUsersCount,
          standard_topics: standardFetchCallsPlanned,
          selected_items: 0,
        }
      );
      throw new Error("No live items available after freshness and selection filters; digest aborted");
    }

    log(`Selected ${selected.length} items (${byTag.size} topic(s), ${itemsPerTopic}/topic, discoveryCapPerTopic=${maxDiscoveryPerTopic}, sourceCap=${Number(CONFIG.digest.maxItemsPerSourceDomain || 2)})`);

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
        candidate_pool_scored: scoredItems.length,
        archive_repeat_block_count: Math.max(0, Number(dedupRes.removed || 0)),
        stale_removed_count: Math.max(0, Number(staleRemoved || 0)),
        history_suppressed_count: Math.max(0, Number(historyResult.suppressedCount || 0)),
        history_lookback_days: historyLookbackDays,
        history_streaks_detected: historyResult.streaks.length,
        story_relationship_continuation_removed: continuationRemovedCount || 0,
        story_relationship_follow_up_count: followUpCount || 0,
        score_top: scoredItems[0]?._score ?? null,
        score_bottom: scoredItems.length > 0 ? scoredItems[scoredItems.length - 1]?._score ?? null : null,
        scored_candidates: scoredItems.map((item) => ({
          tag: String(item?.tag || "").trim().toUpperCase() || null,
          headline: String(item?.headline || "").slice(0, 80),
          url: String(item?.url || ""),
          source: String(item?.source || item?.source_domain || ""),
          source_tier: item?.source_tier ?? null,
          lane: String(item?.retrieval_origin || item?.retrieval_lane || ""),
          _score: item?._score ?? null,
          _score_components: item?._score_components ?? null,
          _story_relationship: item?._story_relationship ?? "new",
        })),
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
  computeItemAgeHours,
  splitByFreshnessTiers,
};
