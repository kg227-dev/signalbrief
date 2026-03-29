"use strict";

/**
 * Strategic Relevance Scoring — pre-score filter and post-score boost
 * integrated per topic bucket.
 *
 * filterLowRelevance: drops LOW-relevance candidates before scoring
 * boostHighRelevance: boosts HIGH-relevance candidates after scoring
 *
 * Both operate per-topic, not on the global candidate pool.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const THIN_POOL_THRESHOLD = 15;       // < 15 candidates → thin pool, keep all LOW
const LARGE_POOL_THRESHOLD = 20;      // >= 20 candidates → drop all LOW
const MIN_NON_LOW_AFTER_DROP = 5;     // 15-19 range: keep LOW if dropping would leave < 5 non-LOW
const DEFAULT_BOOST_AMOUNT = 0.12;

// ─── filterLowRelevance ───────────────────────────────────────────────────────

/**
 * Pre-score filter: drop LOW-relevance candidates per topic.
 *
 * Adaptive thresholds per topic:
 *   >= 20 candidates:        drop all LOW
 *   >= 15 and <= 19:         drop LOW unless it would leave < 5 non-LOW for that topic
 *   < 15 (thin pool):        keep all LOW
 *
 * @param {object[]} candidates
 * @param {{ log?: Function }} [opts]
 * @returns {{ filtered: object[], dropped: object[], diagnostics: object }}
 */
function filterLowRelevance(candidates, opts) {
  const { log } = opts || {};

  if (!candidates || candidates.length === 0) {
    return { filtered: [], dropped: [], diagnostics: {} };
  }

  // Group candidates by topic tag (uppercase)
  const byTopic = new Map();
  for (const candidate of candidates) {
    const topic = String(candidate.tag || "UNKNOWN").toUpperCase();
    if (!byTopic.has(topic)) {
      byTopic.set(topic, []);
    }
    byTopic.get(topic).push(candidate);
  }

  const filtered = [];
  const dropped = [];
  const diagnostics = {};

  for (const [topic, topicCandidates] of byTopic) {
    const total = topicCandidates.length;

    const highItems = topicCandidates.filter(c => c.strategic_relevance === "HIGH");
    const mediumItems = topicCandidates.filter(c => c.strategic_relevance === "MEDIUM");
    const lowItems = topicCandidates.filter(c => c.strategic_relevance === "LOW");

    const countHigh = highItems.length;
    const countMedium = mediumItems.length;
    const countLow = lowItems.length;
    const countNonLow = countHigh + countMedium;

    let lowDropped = 0;
    let thinPoolMode = false;

    if (total < THIN_POOL_THRESHOLD) {
      // Thin pool: keep all LOW
      thinPoolMode = true;
      for (const c of topicCandidates) {
        filtered.push(c);
      }
    } else if (total >= LARGE_POOL_THRESHOLD) {
      // Large pool: drop all LOW
      for (const c of topicCandidates) {
        if (c.strategic_relevance === "LOW") {
          dropped.push(c);
          lowDropped++;
        } else {
          filtered.push(c);
        }
      }
    } else {
      // Mid-range (15-19): drop LOW only if safe (non-LOW count would remain >= 5)
      if (countNonLow >= MIN_NON_LOW_AFTER_DROP) {
        for (const c of topicCandidates) {
          if (c.strategic_relevance === "LOW") {
            dropped.push(c);
            lowDropped++;
          } else {
            filtered.push(c);
          }
        }
      } else {
        // Dropping would leave < 5 non-LOW: keep all
        for (const c of topicCandidates) {
          filtered.push(c);
        }
      }
    }

    diagnostics[topic] = {
      topic,
      total_candidates: total,
      count_high: countHigh,
      count_medium: countMedium,
      count_low: countLow,
      low_dropped: lowDropped,
      thin_pool_mode: thinPoolMode,
    };

    if (typeof log === "function") {
      log(`[filterLowRelevance] ${topic}: total=${total} high=${countHigh} medium=${countMedium} low=${countLow} dropped=${lowDropped} thin_pool=${thinPoolMode}`);
    }
  }

  return { filtered, dropped, diagnostics };
}

// ─── boostHighRelevance ───────────────────────────────────────────────────────

/**
 * Post-score boost: increase _score for HIGH-relevance candidates per topic.
 *
 * @param {object[]} candidates
 * @param {{
 *   boostAmount?: number,    default 0.12
 *   boostInThinPool?: boolean, default true
 *   log?: Function
 * }} [opts]
 * @returns {{ boosted: object[], diagnostics: object }}
 */
function boostHighRelevance(candidates, opts) {
  const {
    boostAmount = DEFAULT_BOOST_AMOUNT,
    boostInThinPool = true,
    log,
  } = opts || {};

  if (!candidates || candidates.length === 0) {
    return { boosted: [], diagnostics: {} };
  }

  // Determine thin-pool topics by counting candidates per topic
  const topicCounts = new Map();
  for (const candidate of candidates) {
    const topic = String(candidate.tag || "UNKNOWN").toUpperCase();
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }

  // Track diagnostics per topic
  const diagnostics = {};
  for (const [topic] of topicCounts) {
    diagnostics[topic] = { high_boosted: 0 };
  }

  const boosted = [];

  for (const candidate of candidates) {
    const topic = String(candidate.tag || "UNKNOWN").toUpperCase();
    const topicCount = topicCounts.get(topic) || 0;
    const isThinPool = topicCount < THIN_POOL_THRESHOLD;

    // Record original score for all candidates
    const originalScore = candidate._score;
    candidate._score_before_strategic = originalScore;

    const isHigh = candidate.strategic_relevance === "HIGH";
    const shouldBoost = isHigh && (boostInThinPool || !isThinPool);

    if (shouldBoost) {
      // Apply boost capped at 1.0
      const rawBoosted = originalScore + boostAmount;
      const cappedScore = Math.min(1.0, rawBoosted);
      const actualBoost = Math.round((cappedScore - originalScore) * 1e6) / 1e6;
      const finalScore = Math.round(cappedScore * 1e6) / 1e6;

      candidate._strategic_boost_applied = actualBoost;
      candidate._score_final = finalScore;
      candidate._score = finalScore;

      diagnostics[topic].high_boosted++;
    } else {
      candidate._strategic_boost_applied = 0;
      candidate._score_final = originalScore;
    }

    boosted.push(candidate);
  }

  if (typeof log === "function") {
    for (const [topic, d] of Object.entries(diagnostics)) {
      log(`[boostHighRelevance] ${topic}: high_boosted=${d.high_boosted}`);
    }
  }

  return { boosted, diagnostics };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  filterLowRelevance,
  boostHighRelevance,
};
