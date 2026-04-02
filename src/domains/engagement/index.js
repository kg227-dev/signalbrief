"use strict";

/**
 * @module src/domains/engagement
 * Canonical engagement event surface for web and digest orchestration callers.
 * Import this barrel instead of reaching into `src/runtime/engagement` directly.
 */
const engagementService = require("../../runtime/engagement/engagement-events-runtime");

module.exports = {
  ...engagementService,
  engagementService,
};
