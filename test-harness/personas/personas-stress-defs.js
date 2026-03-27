const { buildStressFocusPersonaSpecs } = require("./stress/personas-stress-focus-defs");
const { buildStressDistributionPersonaSpecs } = require("./stress/personas-stress-distribution-defs");

function buildStressPersonaSpecs(fallbackTopics) {
  return [
    ...buildStressFocusPersonaSpecs(),
    ...buildStressDistributionPersonaSpecs(fallbackTopics),
  ];
}

module.exports = {
  buildStressPersonaSpecs,
};
