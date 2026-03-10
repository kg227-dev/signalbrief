"use strict";

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
