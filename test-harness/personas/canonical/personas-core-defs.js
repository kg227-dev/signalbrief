const {
  buildCoreCanonicalPersonaSpecs: buildCoreCanonicalPersonaSpecsCore,
} = require("./personas-core-defs-core");

function buildCoreCanonicalPersonaSpecs(allTopics) {
  return buildCoreCanonicalPersonaSpecsCore(Array.isArray(allTopics) ? allTopics : []);
}

module.exports = {
  buildCoreCanonicalPersonaSpecs,
};
