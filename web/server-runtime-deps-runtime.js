"use strict";

const { createCoreApiRouteHandler } = require("./routes/core/core-api");
const { createAdminApiRouteHandler } = require("./routes/admin/admin-api");
const { createPublicStaticRouteHandler } = require("./routes/public-static");
const { createSharedRouteHandlers } = require("./server-runtime-shared-handlers-runtime");
const { createCoreRouteDependencies } = require("./server-runtime-core-registry-runtime");
const { createAdminRouteDependencies } = require("./server-runtime-admin-registry-runtime");
const { createPublicRouteDependencies } = require("./server-runtime-public-registry-runtime");

function createServerRouteDependencies(deps) {
  const sharedHandlers = createSharedRouteHandlers(deps);
  const coreRouteDeps = createCoreRouteDependencies({ deps, sharedHandlers });
  const adminRouteDeps = createAdminRouteDependencies({ deps, sharedHandlers });
  const publicRouteDeps = createPublicRouteDependencies(deps);

  return {
    handleCoreApiRoute: createCoreApiRouteHandler(coreRouteDeps),
    handleAdminApiRoute: createAdminApiRouteHandler(adminRouteDeps),
    handlePublicStaticRoute: createPublicStaticRouteHandler(publicRouteDeps),
  };
}

module.exports = {
  createServerRouteDependencies,
};
