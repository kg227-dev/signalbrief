"use strict";

function readItemScore(item) {
  const directScore = item?.relevanceScore == null || item?.relevanceScore === ""
    ? null
    : Number(item.relevanceScore);
  if (Number.isFinite(directScore)) return directScore;

  const legacyScore = item?.relevance_score == null || item?.relevance_score === ""
    ? null
    : Number(item.relevance_score);
  if (Number.isFinite(legacyScore)) return legacyScore;

  return null;
}

function sortDigestItemsByScoreDescending(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      item,
      index,
      score: readItemScore(item),
    }))
    .sort((left, right) => {
      const leftHasScore = Number.isFinite(left.score);
      const rightHasScore = Number.isFinite(right.score);
      if (leftHasScore && rightHasScore && left.score !== right.score) {
        return right.score - left.score;
      }
      if (leftHasScore !== rightHasScore) {
        return rightHasScore ? 1 : -1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

module.exports = {
  readItemScore,
  sortDigestItemsByScoreDescending,
};
