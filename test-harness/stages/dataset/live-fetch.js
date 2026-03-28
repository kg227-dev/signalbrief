const { COSTS } = require("../../config");
const { fetchTopicNewsCached } = require("../../cache");
const { syncBudget } = require("./shared");

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

module.exports = {
  fetchStandardTopicItems,
};
