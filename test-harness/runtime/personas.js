const { INDUSTRY_TOPICS, CAPABILITY_TOPICS, DEFAULT_TOPICS } = require("../personas/persona-topics");
const { buildCanonicalPersonas } = require("../personas/personas-canonical");
const { buildStressPersonas } = require("../personas/personas-stress");

function buildPersonas(topicUniverse = DEFAULT_TOPICS, opts = {}) {
  const allTopics = Array.isArray(topicUniverse) && topicUniverse.length ? topicUniverse : DEFAULT_TOPICS;
  const includeStress = opts.includeStress !== false;
  const canonical = buildCanonicalPersonas(allTopics);
  const stress = includeStress ? buildStressPersonas(allTopics) : [];
  return [...canonical, ...stress];
}

module.exports = {
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  DEFAULT_TOPICS,
  buildPersonas,
};
