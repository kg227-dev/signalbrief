"use strict";

const mailerGateway = require("../../runtime/mailer/mailer-runtime");
const mailerLifecycle = require("../../runtime/mailer-lifecycle-runtime");

module.exports = {
  ...mailerGateway,
  ...mailerLifecycle,
  mailerGateway,
  mailerLifecycle,
};
