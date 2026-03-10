"use strict";

const configGateway = require("../../runtime/config-provider");

module.exports = {
  ...configGateway,
  configGateway,
};
