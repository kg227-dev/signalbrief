"use strict";

const replyService = require("../../runtime/reply/reply-handler-runtime");
const intent = require("../../runtime/reply/intent-service");
const commandRouter = require("../../runtime/reply/command-router");
const onboarding = require("../../runtime/reply/onboarding-service-runtime");
const onboardingCompat = require("../../runtime/reply/onboarding-service");
const transport = require("../../runtime/reply/transport");
const logging = require("../../runtime/reply/reply-logging-runtime");
const session = require("../../runtime/reply/reply-session-runtime");
const commands = require("../../runtime/reply/reply-command-handlers-runtime");

module.exports = {
  ...replyService,
  ...intent,
  ...commandRouter,
  ...onboarding,
  ...onboardingCompat,
  ...transport,
  ...logging,
  ...session,
  ...commands,
  replyService,
  intent,
  commandRouter,
  onboarding,
  onboardingCompat,
  transport,
  logging,
  session,
  commands,
};
