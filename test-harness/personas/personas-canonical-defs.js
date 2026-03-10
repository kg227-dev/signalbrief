const { buildCoreCanonicalPersonaSpecs } = require("./canonical/personas-core-defs");
const { buildDepthCanonicalPersonaSpecs } = require("./canonical/personas-depth-defs");

function buildCanonicalPersonaSpecs(allTopics) {
  return [
    ...buildCoreCanonicalPersonaSpecs(allTopics),
    ...buildDepthCanonicalPersonaSpecs(),
  ];
}

module.exports = {
  buildCanonicalPersonaSpecs,
};
