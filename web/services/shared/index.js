"use strict";

const archiveDigestStatsRuntime = require("../archive-digest-stats-runtime");
const archiveScoring = require("../archive-scoring");
const deliverySchedule = require("../delivery-schedule");
const requestMetadata = require("../request-metadata");
const runtimeStateRuntime = require("../runtime-state-runtime");
const topicNormalizationRuntime = require("../topic-normalization-runtime");
const webRateLimit = require("../web-rate-limit");

module.exports = {
  ...archiveDigestStatsRuntime,
  ...archiveScoring,
  ...deliverySchedule,
  ...requestMetadata,
  ...runtimeStateRuntime,
  ...topicNormalizationRuntime,
  ...webRateLimit,
  archiveDigestStatsRuntime,
  archiveScoring,
  deliverySchedule,
  requestMetadata,
  runtimeStateRuntime,
  topicNormalizationRuntime,
  webRateLimit,
};
