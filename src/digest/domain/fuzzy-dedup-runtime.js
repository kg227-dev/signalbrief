"use strict";

/**
 * Tokenize a headline for fuzzy similarity comparison.
 * Returns a Set of lowercase words with >= 3 characters.
 * Strips punctuation and normalizes whitespace before splitting.
 */
function tokenizeHeadline(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

/**
 * Jaccard similarity between two token Sets.
 * Returns a value in [0, 1]. Two empty sets → 1. One empty → 0.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Returns true if `tokenSet` is a fuzzy duplicate of any set in `seenTokenSets`.
 * Default threshold: 0.7 (70% token overlap = same story).
 * O(n) scan over seenTokenSets — acceptable for MVP candidate pools (< 200 items per topic).
 */
function isFuzzyDuplicateHeadline(tokenSet, seenTokenSets, threshold = 0.7) {
  for (const seen of seenTokenSets) {
    if (jaccardSimilarity(tokenSet, seen) >= threshold) return true;
  }
  return false;
}

/**
 * Classify an item's story relationship against a pool of past items.
 *
 * Returns:
 *   'continuation' — Jaccard >= continuationThreshold with any past item.
 *                    Same story, no meaningful update — should be suppressed.
 *   'follow_up'    — Jaccard >= followUpThreshold with any past item (but < continuationThreshold).
 *                    Same event, distinct new development — allow through but flag.
 *   'new'          — Jaccard < followUpThreshold. Genuinely new story.
 *
 * @param {{ headline?: string }} item
 * @param {Array<{ headline?: string }>} pastItems
 * @param {number} followUpThreshold   default 0.70
 * @param {number} continuationThreshold default 0.85
 * @returns {'new' | 'follow_up' | 'continuation'}
 */
function classifyStoryRelationship(item, pastItems, followUpThreshold = 0.7, continuationThreshold = 0.85) {
  const headline = String(item?.headline || "").trim();
  if (!headline) return "new";
  if (!Array.isArray(pastItems) || pastItems.length === 0) return "new";

  const itemTokens = tokenizeHeadline(headline);
  if (itemTokens.size === 0) return "new";

  let maxSimilarity = 0;
  for (const pastItem of pastItems) {
    const pastHeadline = String(pastItem?.headline || "").trim();
    if (!pastHeadline) continue;
    const pastTokens = tokenizeHeadline(pastHeadline);
    if (pastTokens.size === 0) continue;
    const similarity = jaccardSimilarity(itemTokens, pastTokens);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
    // Short-circuit: once we exceed the highest threshold, no need to scan further
    if (maxSimilarity >= continuationThreshold) break;
  }

  if (maxSimilarity >= continuationThreshold) return "continuation";
  if (maxSimilarity >= followUpThreshold) return "follow_up";
  return "new";
}

module.exports = {
  tokenizeHeadline,
  jaccardSimilarity,
  isFuzzyDuplicateHeadline,
  classifyStoryRelationship,
};
