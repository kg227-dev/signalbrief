"use strict";

const { createServerRouteDependencies } = require("./server-runtime-deps-runtime");
const { createRouteBootstrapHandler } = require("./server-runtime-route-bootstrap-runtime");

function isIterable(value) {
  return value != null && typeof value[Symbol.iterator] === "function";
}

function buildWebRouteDependencies({
  request = {},
  auth = {},
  mail = {},
  digest = {},
  archive = {},
  registry = {},
  public: publicDeps = {},
  admin = {},
  runtime = {},
  files = {},
  render = {},
  topics = {},
} = {}) {
  return {
    ...request,
    ...auth,
    ...mail,
    ...digest,
    ...archive,
    ...registry,
    ...publicDeps,
    ...admin,
    ...runtime,
    ...files,
    ...render,
    ...topics,
  };
}

function createWebRequestHandler({
  routeDependencies,
  ensureStoreInitialized,
  getServerPort,
  applyCanonicalHostPolicy,
  applyResponseCorsPolicy,
  handleCorsPreflightPolicy,
  handleRequestErrorPolicy,
  getRequestHost,
  getRequestScheme,
  canonicalHost,
  publicHosts,
  trustedCorsOrigins,
  onError = () => {},
}) {
  if (!routeDependencies || typeof routeDependencies !== "object") {
    throw new TypeError("routeDependencies are required");
  }
  if (typeof ensureStoreInitialized !== "function") {
    throw new TypeError("ensureStoreInitialized must be a function");
  }
  if (typeof getServerPort !== "function") {
    throw new TypeError("getServerPort must be a function");
  }
  if (typeof applyCanonicalHostPolicy !== "function") {
    throw new TypeError("applyCanonicalHostPolicy must be a function");
  }
  if (typeof applyResponseCorsPolicy !== "function") {
    throw new TypeError("applyResponseCorsPolicy must be a function");
  }
  if (typeof handleCorsPreflightPolicy !== "function") {
    throw new TypeError("handleCorsPreflightPolicy must be a function");
  }
  if (typeof handleRequestErrorPolicy !== "function") {
    throw new TypeError("handleRequestErrorPolicy must be a function");
  }
  if (typeof getRequestHost !== "function") {
    throw new TypeError("getRequestHost must be a function");
  }
  if (typeof getRequestScheme !== "function") {
    throw new TypeError("getRequestScheme must be a function");
  }
  if (!canonicalHost) {
    throw new TypeError("canonicalHost is required");
  }
  if (!Array.isArray(publicHosts) && !isIterable(publicHosts)) {
    throw new TypeError("publicHosts must be iterable");
  }
  if (!Array.isArray(trustedCorsOrigins) && !isIterable(trustedCorsOrigins)) {
    throw new TypeError("trustedCorsOrigins must be iterable");
  }

  const { handleCoreApiRoute, handleAdminApiRoute, handlePublicStaticRoute } = createServerRouteDependencies(routeDependencies);
  const handleDomainRoute = createRouteBootstrapHandler({
    handleCoreApiRoute,
    handleAdminApiRoute,
    handlePublicStaticRoute,
  });

  return async function handleWebRequest(req, res) {
    try {
      ensureStoreInitialized();
      const port = getServerPort();
      const url = new URL(req.url, `http://localhost:${port}`);
      const pathname = url.pathname;

      const redirected = applyCanonicalHostPolicy({
        req,
        res,
        url,
        pathname,
        getRequestHost,
        getRequestScheme,
        canonicalHost,
        publicHosts,
      });
      if (redirected) return;

      applyResponseCorsPolicy({
        req,
        res,
        trustedCorsOrigins,
      });

      const preflightHandled = handleCorsPreflightPolicy({
        req,
        res,
        trustedCorsOrigins,
      });
      if (preflightHandled) return;

      const routeCtx = { req, res, url, pathname };
      const routeHandled = await handleDomainRoute(routeCtx);
      if (routeHandled !== false) return;

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      onError(err, req, res);
      handleRequestErrorPolicy({ req, res, error: err, logger: () => {} });
    }
  };
}

module.exports = {
  buildWebRouteDependencies,
  createWebRequestHandler,
};
