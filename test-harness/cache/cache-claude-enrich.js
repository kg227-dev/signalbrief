const { enrichItemsCached: enrichItemsCachedCore } = require("./cache-claude-enrich-core");

async function enrichItemsCached(args) {
  return enrichItemsCachedCore(args || {});
}

module.exports = {
  enrichItemsCached,
};
