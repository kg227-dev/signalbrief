function createSelectionPolicy(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const maxItems = Math.max(1, Number(src.maxItems ?? src.itemCount ?? 7) || 7);
  const perTagCap = Math.max(1, Number(src.perTagCap ?? src.maxItemsPerTag ?? 2) || 2);
  const perSourceCandidate = Number(src.perSourceCap ?? src.maxItemsPerSourceDomain);
  const perSourceCap = Number.isFinite(perSourceCandidate) ? Math.max(1, perSourceCandidate) : Infinity;
  const tagPriority = src.tagPriority && typeof src.tagPriority === "object" ? src.tagPriority : {};
  return {
    maxItems,
    perTagCap,
    perSourceCap,
    tagPriority,
  };
}

function createRankingPolicy(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const repeatPenalty = Math.max(0, Number(src.repeatPenalty ?? src.repeat_penalty ?? src.crossDayRepeatPenalty ?? 0) || 0);
  const minBaseScoreRaw = Number(src.minBaseScoreForFinal ?? src.min_base_score_for_final ?? 6.5);
  return {
    repeatIndex: src.repeatIndex || src.repeat_index || null,
    repeatPenalty,
    minBaseScoreForFinal: Number.isFinite(minBaseScoreRaw) ? minBaseScoreRaw : 6.5,
  };
}

function createDepthPolicy(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const minFilteredItems = Math.max(1, Number(src.minFilteredItems ?? src.min_filtered_items ?? 3) || 3);
  const defaultItemCount = Math.max(1, Number(src.defaultItemCount ?? src.default_item_count ?? src.itemCount ?? 5) || 5);
  return {
    minFilteredItems,
    defaultItemCount,
  };
}

function createDigestPolicies(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const rankingInput = src.rankingPolicy && typeof src.rankingPolicy === "object"
    ? src.rankingPolicy
    : src;
  const depthInput = src.depthPolicy && typeof src.depthPolicy === "object"
    ? src.depthPolicy
    : src;
  return {
    rankingPolicy: createRankingPolicy(rankingInput),
    depthPolicy: createDepthPolicy(depthInput),
  };
}

module.exports = {
  createSelectionPolicy,
  createRankingPolicy,
  createDepthPolicy,
  createDigestPolicies,
};
