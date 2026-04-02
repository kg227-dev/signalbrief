"use strict";

const {
  handleUserByEmailRoute,
  handleAuditRoute,
} = require("./admin-api-users-query-actions-runtime");
const {
  handleRegenerateDigestRoute,
  handleResendDigestRoute,
} = require("./admin-api-users-digest-actions-runtime");
const {
  handleUpdateDeliveryTimeRoute,
  handleSetUserStatusRoute,
  handleDeleteUserRoute,
  handleRestartSchedulerWorkerRoute,
} = require("./admin-api-users-lifecycle-actions-runtime");

module.exports = {
  handleUserByEmailRoute,
  handleRegenerateDigestRoute,
  handleResendDigestRoute,
  handleAuditRoute,
  handleUpdateDeliveryTimeRoute,
  handleSetUserStatusRoute,
  handleDeleteUserRoute,
  handleRestartSchedulerWorkerRoute,
};
