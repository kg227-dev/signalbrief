const {
  buildDefaultUserCheck,
  buildEngagementEventsCheck,
  buildNormalizeUserRecordCheck,
} = require("./checks-runtime-cases");

function buildRuntimeSafetyChecks(check) {
  return [
    buildDefaultUserCheck(check),
    buildEngagementEventsCheck(check),
    buildNormalizeUserRecordCheck(check),
  ];
}

module.exports = {
  buildRuntimeSafetyChecks,
};
