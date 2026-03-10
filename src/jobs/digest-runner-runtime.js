"use strict";

const runtime = require("./digest-runner-core-runtime");

function confirmQueuedRunStarted(...args) {
  return runtime.confirmQueuedRunStarted(...args);
}

module.exports = {
  ...runtime,
  confirmQueuedRunStarted,
};
