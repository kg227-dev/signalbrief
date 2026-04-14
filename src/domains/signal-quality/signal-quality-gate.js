"use strict";

const { scoreSignalQuality } = require("./signal-quality-scorer");

const PASS_FLOOR = 6;
const BORDERLINE_FLOOR = 5;

function classifyResult(score, hardRejected) {
  if (hardRejected) return "reject";
  if (score >= PASS_FLOOR) return "pass";
  if (score >= BORDERLINE_FLOOR) return "borderline";
  return "reject";
}

function findBestReserveCandidate(item, reserveByTopic, usedUrls) {
  const tag = String(item?.tag || "").trim().toUpperCase();
  const reserveState = reserveByTopic?.[tag];
  if (!reserveState) return null;

  const allReserve = Array.isArray(reserveState.allReserve)
    ? reserveState.allReserve
    : [
        ...(Array.isArray(reserveState.strongReserve) ? reserveState.strongReserve : []),
        ...(Array.isArray(reserveState.standardReserve) ? reserveState.standardReserve : []),
      ];

  const scored = allReserve
    .filter((candidate) => !usedUrls.has(String(candidate?.url || "").trim()))
    .map((candidate) => ({ candidate, quality: scoreSignalQuality(candidate) }))
    .filter(({ quality }) => quality.total >= PASS_FLOOR && !quality.hard_rejected);

  if (scored.length === 0) return null;

  scored.sort((left, right) =>
    right.quality.total - left.quality.total ||
    Number(right.candidate?._score || 0) - Number(left.candidate?._score || 0)
  );
  return scored[0].candidate;
}

function buildTopicSummary(itemDiagnostics) {
  const summary = {};
  for (const diag of itemDiagnostics) {
    const tag = String(diag?.tag || "UNKNOWN").toUpperCase();
    if (!summary[tag]) summary[tag] = { below_floor: 0, swaps: 0, underfills: 0, drops: 0 };
    if (diag.signal_quality_result !== "pass") summary[tag].below_floor += 1;
    if (diag.signal_quality_shadow_action === "would_swap") summary[tag].swaps += 1;
    if (diag.signal_quality_shadow_action === "would_underfill") summary[tag].underfills += 1;
    if (diag.signal_quality_shadow_action === "would_drop") summary[tag].drops += 1;
  }
  return summary;
}

function computeDeltaMetrics(itemDiagnostics, items, reserveByTopic) {
  let trustedDelta = 0;
  let totalScoreDelta = 0;
  let deltaCount = 0;

  for (const diag of itemDiagnostics) {
    if (diag.signal_quality_shadow_action !== "would_swap" || !diag.signal_quality_swap_candidate_url) continue;
    const originalItem = items.find((item) => item?.url === diag.url);
    if (!originalItem) continue;

    const tag = String(originalItem?.tag || "").trim().toUpperCase();
    const reserveState = reserveByTopic?.[tag];
    const allReserve = Array.isArray(reserveState?.allReserve)
      ? reserveState.allReserve
      : [
          ...(Array.isArray(reserveState?.strongReserve) ? reserveState.strongReserve : []),
          ...(Array.isArray(reserveState?.standardReserve) ? reserveState.standardReserve : []),
        ];
    const swapCandidate = allReserve.find((candidate) => String(candidate?.url || "").trim() === diag.signal_quality_swap_candidate_url);
    if (!swapCandidate) continue;

    const swapScore = scoreSignalQuality(swapCandidate);
    totalScoreDelta += swapScore.total - diag.signal_quality_score;
    const originalTier = Number(originalItem?.source_tier) || 3;
    const swapTier = Number(swapCandidate?.source_tier) || 3;
    trustedDelta += swapTier < originalTier ? 1 : (swapTier > originalTier ? -1 : 0);
    deltaCount += 1;
  }

  return {
    signal_quality_shadow_trusted_delta: trustedDelta,
    signal_quality_shadow_avg_score_delta: deltaCount > 0 ? totalScoreDelta / deltaCount : 0,
  };
}

function runSignalQualityShadowGate(items, reserveByTopic) {
  const safeItems = Array.isArray(items) ? items : [];
  const safeReserves = reserveByTopic && typeof reserveByTopic === "object" ? reserveByTopic : {};

  const usedUrls = new Set(
    safeItems.map((item) => String(item?.url || "").trim()).filter(Boolean)
  );

  let itemsBelowFloor = 0;
  let shadowSwaps = 0;
  let shadowUnderfills = 0;
  let shadowDrops = 0;
  let passCount = 0;

  const itemDiagnostics = safeItems.map((item) => {
    const breakdown = scoreSignalQuality(item);
    const result = classifyResult(breakdown.total, breakdown.hard_rejected);

    if (result === "pass") {
      passCount += 1;
      return {
        url: item?.url || null,
        tag: item?.tag || null,
        signal_quality_score: breakdown.total,
        signal_quality_breakdown: breakdown,
        signal_quality_result: "pass",
        signal_quality_shadow_action: "keep",
        signal_quality_swap_candidate_url: null,
        hard_rejected: false,
        hard_reject_reason: null,
      };
    }

    itemsBelowFloor += 1;
    const swapCandidate = findBestReserveCandidate(item, safeReserves, usedUrls);
    let shadowAction;
    let swapCandidateUrl = null;

    if (swapCandidate) {
      shadowSwaps += 1;
      shadowAction = "would_swap";
      swapCandidateUrl = String(swapCandidate.url || "").trim() || null;
    } else if (result === "reject") {
      shadowDrops += 1;
      shadowAction = "would_drop";
    } else {
      shadowUnderfills += 1;
      shadowAction = "would_underfill";
    }

    return {
      url: item?.url || null,
      tag: item?.tag || null,
      signal_quality_score: breakdown.total,
      signal_quality_breakdown: { ...breakdown },
      signal_quality_result: result,
      signal_quality_shadow_action: shadowAction,
      signal_quality_swap_candidate_url: swapCandidateUrl,
      hard_rejected: breakdown.hard_rejected,
      hard_reject_reason: breakdown.hard_reject_reason,
    };
  });

  const total = safeItems.length;
  const deltaMetrics = computeDeltaMetrics(itemDiagnostics, safeItems, safeReserves);

  const shadowDiagnostics = {
    signal_quality_items_below_floor: itemsBelowFloor,
    signal_quality_shadow_swaps: shadowSwaps,
    signal_quality_shadow_underfills: shadowUnderfills,
    signal_quality_shadow_drops: shadowDrops,
    signal_quality_pass_rate: total > 0 ? passCount / total : 1,
    signal_quality_shadow_trusted_delta: deltaMetrics.signal_quality_shadow_trusted_delta,
    signal_quality_shadow_avg_score_delta: deltaMetrics.signal_quality_shadow_avg_score_delta,
    signal_quality_topic_summary: buildTopicSummary(itemDiagnostics),
    item_diagnostics: itemDiagnostics,
  };

  return {
    items: safeItems,
    shadowDiagnostics,
  };
}

module.exports = { runSignalQualityShadowGate };
