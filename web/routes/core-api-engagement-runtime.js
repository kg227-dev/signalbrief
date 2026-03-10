const {
  handleTrackingPixelRoute,
  handleClickRedirectRoute,
} = require("./core-api-engagement-actions-runtime");

async function handleCoreEngagementRoutes(ctx, deps) {
  if (handleTrackingPixelRoute({ ctx, deps })) return true;
  if (handleClickRedirectRoute({ ctx, deps })) return true;

  return false;
}

module.exports = {
  handleCoreEngagementRoutes,
};
