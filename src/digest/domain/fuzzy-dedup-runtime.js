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
 */
function isFuzzyDuplicateHeadline(tokenSet, seenTokenSets, threshold = 0.7) {
  for (const seen of seenTokenSets) {
    if (jaccardSimilarity(tokenSet, seen) >= threshold) return true;
  }
  return false;
}

module.exports = {
  tokenizeHeadline,
  jaccardSimilarity,
  isFuzzyDuplicateHeadline,
};
