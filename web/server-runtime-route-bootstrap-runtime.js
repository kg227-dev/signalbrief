"use strict";

function createRouteBootstrapHandler({
  handleCoreApiRoute,
  handleAdminApiRoute,
  handlePublicStaticRoute,
}) {
  if (typeof handleCoreApiRoute !== "function") {
    throw new TypeError("handleCoreApiRoute must be a function");
  }
  if (typeof handleAdminApiRoute !== "function") {
    throw new TypeError("handleAdminApiRoute must be a function");
  }
  if (typeof handlePublicStaticRoute !== "function") {
    throw new TypeError("handlePublicStaticRoute must be a function");
  }

  return async function routeBootstrapHandler(routeCtx) {
    const coreHandled = await handleCoreApiRoute(routeCtx);
    if (coreHandled !== false) return coreHandled;

    const adminHandled = await handleAdminApiRoute(routeCtx);
    if (adminHandled !== false) return adminHandled;

    const publicHandled = await handlePublicStaticRoute(routeCtx);
    if (publicHandled !== false) return publicHandled;

    return false;
  };
}

module.exports = {
  createRouteBootstrapHandler,
};
