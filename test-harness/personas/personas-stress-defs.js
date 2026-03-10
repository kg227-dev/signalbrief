const { buildStressFocusPersonaSpecs } = require("./stress/personas-stress-focus-defs");
const { buildStressCustomPersonaSpecs } = require("./stress/personas-stress-custom-defs");
const { buildStressDistributionPersonaSpecs } = require("./stress/personas-stress-distribution-defs");

function buildStressPersonaSpecs(fallbackTopics) {
  return [
    ...buildStressFocusPersonaSpecs(),
    ...buildStressCustomPersonaSpecs(),
    ...buildStressDistributionPersonaSpecs(fallbackTopics),
  ];
}

module.exports = {
  buildStressPersonaSpecs,
};
