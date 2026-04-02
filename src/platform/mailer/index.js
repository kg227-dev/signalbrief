"use strict";

/**
 * @module src/platform/mailer
 * Canonical mailer surface that combines provider access with lifecycle helpers.
 * Import this barrel from application code instead of reaching into runtime mailer modules directly.
 */
const mailerGateway = require("../../runtime/mailer/mailer-runtime");
const mailerLifecycle = require("../../runtime/mailer-lifecycle-runtime");

module.exports = {
  ...mailerGateway,
  ...mailerLifecycle,
  mailerGateway,
  mailerLifecycle,
};
