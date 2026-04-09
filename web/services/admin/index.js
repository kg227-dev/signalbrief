"use strict";

const digestInsightsRuntime = require("../admin-digest-insights-runtime");
const opsAnalytics = require("../admin-ops-analytics");
const opsIo = require("../admin-ops-io");
const opsScheduler = require("../admin-ops-scheduler");
const opsUtils = require("../admin-ops-utils");
const ops = require("../admin-ops");
const recentDigestsExport = require("../admin-recent-digests-export-runtime");
const sourceRegistry = require("../admin-source-registry-runtime");
const sourceRegistryMetrics = require("../admin-source-registry-metrics-runtime");
const sourceRegistrySummary = require("../admin-source-registry-summary-runtime");
const statsCosts = require("../admin-stats-costs");
const statsDelivery = require("../admin-stats-delivery");
const statsDeliveryRuntime = require("../admin-stats-delivery-runtime");
const statsQuality = require("../admin-stats-quality");
const statsReferrals = require("../admin-stats-referrals");
const statsRoster = require("../admin-stats-roster");
const statsRuns = require("../admin-stats-runs");

module.exports = {
  ...digestInsightsRuntime,
  ...opsAnalytics,
  ...opsIo,
  ...opsScheduler,
  ...opsUtils,
  ...ops,
  ...recentDigestsExport,
  ...sourceRegistry,
  ...statsCosts,
  ...statsDelivery,
  ...statsDeliveryRuntime,
  ...statsQuality,
  ...statsReferrals,
  ...statsRoster,
  ...statsRuns,
  digestInsightsRuntime,
  opsAnalytics,
  opsIo,
  opsScheduler,
  opsUtils,
  ops,
  recentDigestsExport,
  sourceRegistry,
  sourceRegistryMetrics,
  sourceRegistrySummary,
  statsCosts,
  statsDelivery,
  statsDeliveryRuntime,
  statsQuality,
  statsReferrals,
  statsRoster,
  statsRuns,
};
