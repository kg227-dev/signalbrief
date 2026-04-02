"use strict";

/**
 * @module src/platform/config
 * Canonical config gateway surface for application and web runtime consumers.
 * Import this module instead of reading environment variables directly in feature code.
 */
const configGateway = require("../../runtime/config-provider");

module.exports = {
  ...configGateway,
  configGateway,
};
