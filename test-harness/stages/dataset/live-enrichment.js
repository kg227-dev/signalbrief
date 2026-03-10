const { COSTS } = require("../../config");
const { enrichItemsCached } = require("../../cache");
const { syncBudget } = require("./shared");

async function enrichLiveDatasetItems({
  selectedItems,
  appConfig,
  budget,
  args,
}) {
  try {
    const enrichResult = await enrichItemsCached({
      items: selectedItems,
      appConfig,
      budget,
      allowLiveApi: args.allow_live_api,
      refreshCache: args.refresh_cache,
      costs: COSTS,
    });
    if (enrichResult.budget) syncBudget(budget, enrichResult.budget);
    return enrichResult;
  } catch (error) {
    const isCacheMiss = /cache miss/i.test(String(error?.message || ""));
    if (!args.allow_live_api && isCacheMiss) {
      return {
        items: (selectedItems || []).map((item) => ({
          ...item,
          wim_brief: item.wim_brief || null,
          wim: item.wim || null,
          implications: item.implications || null,
          watch_next: item.watch_next || null,
          baseScore: typeof item.baseScore === "number" ? item.baseScore : 5,
        })),
        usage: { input_tokens: 0, output_tokens: 0 },
        from_cache: false,
        degraded_no_enrichment_cache: true,
      };
    }
    throw error;
  }
}

module.exports = {
  enrichLiveDatasetItems,
};
