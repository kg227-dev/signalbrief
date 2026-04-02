"use strict";

/**
 * @module src/platform/store
 * Canonical platform store surface for persistence, user contracts, and URL normalization helpers.
 * Import this module for store access instead of mixing direct runtime store and contract imports.
 */
const storeGateway = require("../../runtime/store");
const userContract = require("../../runtime/user-contract-runtime");
const urlNormalization = require("../../runtime/url-normalization-runtime");
const runtimeTypes = require("../../runtime/runtime-types");

module.exports = {
  ...storeGateway,
  ...userContract,
  ...urlNormalization,
  runtimeTypes,
  storeGateway,
  userContract,
  urlNormalization,
};
