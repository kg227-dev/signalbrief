const { COSTS } = require("../../config");
const { fetchTopicNewsCached } = require("../../cache");
const { buildCustomTopicQueries } = require("../../utils/topic-utils");
const { syncBudget, collectCustomTopics } = require("./shared");

async function fetchStandardTopicItems({ topics, dateKey, appConfig, budget, args }) {
  const standardItemsByTopic = [];
  for (const topic of topics) {
    const query = Array.isArray(topic.queries) && topic.queries.length ? topic.queries[0] : topic.tag;
    const fetchResult = await fetchTopicNewsCached({
      topicTag: topic.tag,
      query,
      dateKey,
      appConfig,
      budget,
      allowLiveApi: args.allow_live_api,
      refreshCache: args.refresh_cache,
      costs: COSTS,
    });
    if (fetchResult.budget) syncBudget(budget, fetchResult.budget);
    standardItemsByTopic.push({
      tag: topic.tag,
      from_cache: fetchResult.from_cache,
      cache_file: fetchResult.cache_file,
      item_count: (fetchResult.items || []).length,
      items: fetchResult.items || [],
    });
  }
  return standardItemsByTopic;
}

async function fetchCustomTopicItems({
  digestConfig,
  personas,
  dateKey,
  appConfig,
  budget,
  args,
}) {
  const customFetchCap = Number(digestConfig.maxCustomFetchPerRun || 12);
  const customKeywords = collectCustomTopics(personas, customFetchCap);
  const customItemsByTopic = [];

  for (const keyword of customKeywords) {
    const topicTag = keyword.toUpperCase();
    const query = buildCustomTopicQueries(keyword)[0]
      || `${keyword} business strategy market policy developments last 72 hours`;
    try {
      const fetchResult = await fetchTopicNewsCached({
        topicTag,
        query,
        dateKey,
        appConfig,
        budget,
        allowLiveApi: args.allow_live_api,
        refreshCache: args.refresh_cache,
        costs: COSTS,
      });
      if (fetchResult.budget) syncBudget(budget, fetchResult.budget);
      customItemsByTopic.push({
        keyword,
        tag: topicTag,
        from_cache: fetchResult.from_cache,
        cache_file: fetchResult.cache_file,
        item_count: (fetchResult.items || []).length,
        items: fetchResult.items || [],
        skipped_cache_miss: false,
      });
    } catch (error) {
      const isCacheMiss = /cache miss/i.test(String(error?.message || ""));
      if (!args.allow_live_api && isCacheMiss) {
        customItemsByTopic.push({
          keyword,
          tag: topicTag,
          from_cache: false,
          cache_file: null,
          item_count: 0,
          items: [],
          skipped_cache_miss: true,
        });
        continue;
      }
      throw error;
    }
  }

  return customItemsByTopic;
}

module.exports = {
  fetchStandardTopicItems,
  fetchCustomTopicItems,
};
