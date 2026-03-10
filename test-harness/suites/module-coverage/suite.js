const {
  check,
  buildModuleCoverageResult,
} = require("./common");
const {
  buildTopicAndPipelineChecks,
} = require("./checks-topic");
const {
  buildRuntimeSafetyChecks,
} = require("./checks-runtime");

function runModuleCoverageSuite({ id, name }) {
  const checks = [
    ...buildTopicAndPipelineChecks(check),
    ...buildRuntimeSafetyChecks(check),
  ];

  return buildModuleCoverageResult({
    suiteId: id,
    suiteName: name,
    checks,
  });
}

module.exports = {
  runModuleCoverageSuite,
};
