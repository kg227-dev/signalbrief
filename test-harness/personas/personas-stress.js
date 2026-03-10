const { basePersona } = require("./persona-factory");
const { DEFAULT_TOPICS } = require("./persona-topics");
const { buildStressPersonaSpecs } = require("./personas-stress-defs");

function buildStressPersonas(allTopics) {
  const fallback = allTopics.length ? allTopics : DEFAULT_TOPICS;
  const specs = buildStressPersonaSpecs(fallback);
  return specs.map((spec) => basePersona(spec.id, spec.name, spec.description, spec.overrides));
}

module.exports = {
  buildStressPersonas,
};
