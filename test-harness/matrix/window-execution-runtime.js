const {
  executeMatrixWindows: executeMatrixWindowsCore,
  buildMatrixSummary: buildMatrixSummaryCore,
} = require("./window-execution-core-runtime");

async function executeMatrixWindows(args) {
  return executeMatrixWindowsCore(args || {});
}

function buildMatrixSummary(args) {
  return buildMatrixSummaryCore(args || {});
}

module.exports = {
  buildMatrixSummary,
  executeMatrixWindows,
};
