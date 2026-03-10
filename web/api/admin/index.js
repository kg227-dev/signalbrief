"use strict";

const adminRoutes = require("../../routes/admin-api");

module.exports = {
  ...adminRoutes,
  adminRoutes,
};
