"use strict";

const { isWeakSourceItem } = require("../../digest/domain/storyline-domain-runtime");
const {
  SOURCE_EVAL_BANDS,
  SOURCE_EVAL_FORMULA,
  sourceEvalBand,
} = require("./constants-runtime");

function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function mean(values = []) {
  const numbers = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function ageHoursForItem(item) {
  const publishedTs = Date.parse(String(item?.published_date || ""));
  const retrievedTs = Date.parse(String(item?.retrieved_at || ""));
  const bestTs = Number.isFinite(publishedTs) ? publishedTs : retrievedTs;
  if (!Number.isFinite(bestTs)) return null;
  return Math.max(0, (Date.now() - bestTs) / (60 * 60 * 1000));
}

function freshnessScore(item) {
  const ageHours = ageHoursForItem(item);
  if (ageHours == null) return SOURCE_EVAL_FORMULA.freshness_buckets.unknown;
  if (ageHours <= 24) return SOURCE_EVAL_FORMULA.freshness_buckets.le_24h;
  if (ageHours <= 48) return SOURCE_EVAL_FORMULA.freshness_buckets.le_48h;
  if (ageHours <= 72) return SOURCE_EVAL_FORMULA.freshness_buckets.le_72h;
  return SOURCE_EVAL_FORMULA.freshness_buckets.gt_72h;
}

function preferredScore(item) {
  return String(item?.preferred_source_match || "").trim().toLowerCase() !== "none" ? 100 : 0;
}

function relevanceScore(item) {
  return clamp((Math.min(10, Math.max(0, Number(item?.topicMatch || 0))) / 10) * 100, 0, 100);
}

function credibilityScore(item) {
  return clamp(Number(item?.source_authority || 0) * 100, 0, 100);
}

function itemSourceScore(item) {
  const weights = SOURCE_EVAL_FORMULA.item;
  const weakPenalty = isWeakSourceItem(item) ? 100 : 0;
  const score = (
    weights.credibility_weight * credibilityScore(item)
    + weights.relevance_weight * relevanceScore(item)
    + weights.freshness_weight * freshnessScore(item)
    + weights.preferred_weight * preferredScore(item)
    - weights.weak_penalty_weight * weakPenalty
  );
  return clamp(score, 0, 100);
}

function rate(values, predicate) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return 0;
  const hits = rows.filter((value) => predicate(value)).length;
  return clamp((hits / rows.length) * 100, 0, 100);
}

function domainCounts(items = []) {
  const counts = {};
  for (const item of (Array.isArray(items) ? items : [])) {
    const domain = String(item?.source_domain || item?.source || "").trim().toLowerCase();
    if (!domain) continue;
    counts[domain] = (counts[domain] || 0) + 1;
  }
  return counts;
}

function topDomainShare(items = []) {
  const counts = Object.values(domainCounts(items));
  const total = (Array.isArray(items) ? items : []).length;
  if (!total || !counts.length) return 0;
  return clamp((Math.max(...counts) / total) * 100, 0, 100);
}

function fillRate(itemCount, requestedCount) {
  const requested = Math.max(1, Number(requestedCount || 0));
  const count = Math.max(0, Number(itemCount || 0));
  return clamp((count / requested) * 100, 0, 100);
}

function describeScarcity({ itemCount = 0, requestedCount = 0, score = 0, selectionLift = 0 } = {}) {
  if (Number(itemCount || 0) <= 0) return "fail_closed_no_relevant_candidates";
  const rate = fillRate(itemCount, requestedCount);
  if (rate < 100) {
    return Number(score || 0) >= SOURCE_EVAL_BANDS.decent ? "short_but_precise" : "short_and_thin";
  }
  if (Number(selectionLift || 0) < -5) return "full_but_diluted";
  return "full_and_precise";
}

function computeSetQuality(items = [], opts = {}) {
  const rows = Array.isArray(items) ? items : [];
  const weights = SOURCE_EVAL_FORMULA.set_quality;
  const requestedCount = Math.max(1, Number(opts?.requestedCount || rows.length || 1));
  const itemScores = rows.map(itemSourceScore);
  const relevanceScores = rows.map(relevanceScore);
  const freshnessScores = rows.map(freshnessScore);
  const preferredHitRate = rate(rows, (item) => preferredScore(item) > 0);
  const weakSourceRate = rate(rows, (item) => isWeakSourceItem(item));
  const score = (
    weights.item_score_weight * mean(itemScores)
    + weights.relevance_weight * mean(relevanceScores)
    + weights.freshness_weight * mean(freshnessScores)
    + weights.preferred_hit_rate_weight * preferredHitRate
    + weights.inverse_weak_source_rate_weight * (100 - weakSourceRate)
  );
  return {
    score: clamp(score, 0, 100),
    band: sourceEvalBand(score),
    avg_item_score: Number(mean(itemScores).toFixed(2)),
    avg_relevance: Number(mean(relevanceScores).toFixed(2)),
    avg_freshness: Number(mean(freshnessScores).toFixed(2)),
    preferred_hit_rate: Number(preferredHitRate.toFixed(2)),
    weak_source_rate: Number(weakSourceRate.toFixed(2)),
    unique_domain_count: Object.keys(domainCounts(rows)).length,
    top_domain_share: Number(topDomainShare(rows).toFixed(2)),
    stale_item_share: Number(rate(rows, (item) => freshnessScore(item) <= SOURCE_EVAL_FORMULA.freshness_buckets.le_72h && freshnessScore(item) > 0 && freshnessScore(item) < 75).toFixed(2)),
    item_count: rows.length,
    requested_count: requestedCount,
    fill_rate: Number(fillRate(rows.length, requestedCount).toFixed(2)),
  };
}

function rankItemsBySourceScore(items = []) {
  return (Array.isArray(items) ? items : []).slice().sort((left, right) => itemSourceScore(right) - itemSourceScore(left));
}

function buildSourceLevelSummary(items = []) {
  const counts = domainCounts(items);
  return Object.entries(counts)
    .map(([domain, count]) => ({
      domain,
      count,
      top_domain_share: Number((count / Math.max(1, items.length) * 100).toFixed(2)),
    }))
    .sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain));
}

function buildManualReviewQueue(personaResults = [], count = 8) {
  const rows = (Array.isArray(personaResults) ? personaResults : []).slice();
  const sortedByFinal = rows.slice().sort((left, right) => Number(right?.final_selected_quality?.score || 0) - Number(left?.final_selected_quality?.score || 0));
  const sortedByLift = rows.slice().sort((left, right) => Number(left?.selection_lift || 0) - Number(right?.selection_lift || 0));
  const strongest = sortedByFinal.slice(0, 2);
  const weakest = sortedByFinal.slice(-2);
  const negativeLift = sortedByLift.filter((row) => Number(row?.selection_lift || 0) < 0).slice(0, 2);
  const suspicious = rows.filter((row) => String(row?.group || "").includes("custom") || String(row?.group || "").includes("adversarial")).slice(0, 2);
  const seen = new Set();
  const queue = [];
  for (const row of [...strongest, ...weakest, ...negativeLift, ...suspicious]) {
    const key = `${row?.scenario_id || ""}:${row?.persona_id || ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queue.push({
      scenario_id: row.scenario_id,
      persona_id: row.persona_id,
      persona_label: row.persona_label,
      group: row.group,
      final_score: row?.final_selected_quality?.score || 0,
      selection_lift: Number(row?.selection_lift || 0),
      review_focus: [
        "source quality",
        "relevance",
        "freshness",
        "better source available",
      ],
    });
    if (queue.length >= Math.max(1, Number(count || 8))) break;
  }
  return queue;
}

module.exports = {
  ageHoursForItem,
  buildManualReviewQueue,
  buildSourceLevelSummary,
  computeSetQuality,
  describeScarcity,
  credibilityScore,
  fillRate,
  freshnessScore,
  itemSourceScore,
  preferredScore,
  rankItemsBySourceScore,
  relevanceScore,
  sourceEvalBand,
  topDomainShare,
};
