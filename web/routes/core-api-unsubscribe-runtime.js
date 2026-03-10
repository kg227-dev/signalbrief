const { createUnsubscribeActions } = require("./core-api-unsubscribe-actions-runtime");

async function handleCoreUnsubscribeRoutes(ctx, deps) {
  const { req, pathname } = ctx;
  const actions = createUnsubscribeActions(deps);

  if (pathname === "/api/unsubscribe/confirm" && req.method === "GET") {
    return actions.handleUnsubscribeConfirm(ctx);
  }

  if (pathname === "/api/unsubscribe/one-click" && req.method === "POST") {
    return actions.handleUnsubscribeOneClick(ctx);
  }

  if (pathname === "/api/unsubscribe/legacy" && (req.method === "GET" || req.method === "POST")) {
    return actions.handleUnsubscribeLegacy(ctx);
  }

  if (pathname === "/api/unsubscribe" && (req.method === "GET" || req.method === "POST")) {
    return actions.handleUnsubscribeCompat(ctx);
  }

  if (pathname === "/api/pause" && req.method === "GET") {
    return actions.handlePause(ctx);
  }

  if (pathname === "/api/reactivate" && req.method === "GET") {
    return actions.handleReactivate(ctx);
  }

  return false;
}

module.exports = {
  handleCoreUnsubscribeRoutes,
};
