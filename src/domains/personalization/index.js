"use strict";

const personalizationService = require("../../runtime/personalization/personalization-runtime");

module.exports = {
  ...personalizationService,
  personalizationService,
};
