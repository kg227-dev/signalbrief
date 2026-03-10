const {
  buildReengagementStateCheck,
  buildDaysSinceCheck,
  buildEngagementEventsCheck,
  buildNormalizeIntentPayloadCheck,
} = require("./checks-runtime-cases");

function buildRuntimeSafetyChecks(check) {
  return [
    buildReengagementStateCheck(check),
    buildDaysSinceCheck(check),
    buildEngagementEventsCheck(check),
    buildNormalizeIntentPayloadCheck(check),
  ];
}

module.exports = {
  buildRuntimeSafetyChecks,
};
