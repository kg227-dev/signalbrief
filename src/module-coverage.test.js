"use strict";

const runtime = require("./module-coverage-runtime");

function runModuleCoverageTests() {
  return runtime.runModuleCoverageTests();
}

module.exports = {
  runModuleCoverageTests,
};
