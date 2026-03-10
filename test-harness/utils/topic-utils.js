const {
  normalizeMatchText,
  normalizeTopicToken,
  normalizeCustomKeyword,
  CUSTOM_TOPIC_ALIASES,
  buildCustomTopicQueries,
} = require("../../src/digest/domain/topic-domain-runtime");

module.exports = {
  buildCustomTopicQueries,
  normalizeMatchText,
  normalizeTopicToken,
  normalizeCustomKeyword,
  CUSTOM_TOPIC_ALIASES,
};
