const { basePersona } = require("./persona-factory");
const { buildCanonicalPersonaSpecs } = require("./personas-canonical-defs");

function buildCanonicalPersonas(allTopics) {
  const specs = buildCanonicalPersonaSpecs(allTopics);
  return specs.map((spec) => basePersona(spec.id, spec.name, spec.description, spec.overrides));
}

module.exports = {
  buildCanonicalPersonas,
};
