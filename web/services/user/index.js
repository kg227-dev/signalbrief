"use strict";

const adminActionsRuntime = require("../web-user-admin-actions-runtime");
const adminRuntime = require("../web-user-admin-runtime");
const handlers = require("../web-user-handlers");
const settingsRuntime = require("../web-user-settings-runtime");
const signupActionsRuntime = require("../web-user-signup-actions-runtime");
const signupRuntime = require("../web-user-signup-runtime");

module.exports = {
  ...adminActionsRuntime,
  ...adminRuntime,
  ...handlers,
  ...settingsRuntime,
  ...signupActionsRuntime,
  ...signupRuntime,
  adminActionsRuntime,
  adminRuntime,
  handlers,
  settingsRuntime,
  signupActionsRuntime,
  signupRuntime,
};
