const {
  buildRuntimeSafetyChecks: buildRuntimeSafetyChecksCore,
} = require("./checks-core-runtime");

function buildRuntimeSafetyChecks(check) {
  return buildRuntimeSafetyChecksCore(check);
}

module.exports = {
  buildRuntimeSafetyChecks,
};
