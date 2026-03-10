const {
  computeTopicMatch,
  matchWeightToTag,
  normalizeMatchText,
  normalizeTopicToken,
  topicsRelated,
} = require("../../src/domains/digest");

function archiveTopicMatch(itemTag, itemHeadline, itemSummary, userTopics) {
  const tag = normalizeTopicToken(itemTag);
  const headline = normalizeMatchText(itemHeadline);
  const summary = normalizeMatchText(itemSummary);
  const topics = (userTopics || []).map(normalizeTopicToken).filter(Boolean);
  if (topics.length === 0) return 3;

  if (computeTopicMatch({ tag, headline, summary }, topics) >= 10) return 10;
  for (const topic of topics) {
    if (topicsRelated(tag, topic)) return 7;
  }
  for (const topic of topics) {
    if (headline.includes(topic) || summary.includes(topic)) return 7;
  }
  return 3;
}

function archiveRelevanceScore(item, userTopics, topicWeights) {
  const base = typeof item?.baseScore === "number" ? item.baseScore : 5;
  const topicMatch = archiveTopicMatch(item?.tag, item?.headline, item?.summary, userTopics);
  const weightBonus = matchWeightToTag(item?.tag, topicWeights) * 0.5;
  const raw = base * 0.6 + topicMatch * 0.4 + weightBonus;
  return Math.min(10, Math.max(0, Math.round(raw * 10) / 10));
}

module.exports = {
  archiveTopicMatch,
  archiveRelevanceScore,
};
