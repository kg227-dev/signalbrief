const { buildLiveOrCachedDataset: buildLiveOrCachedDatasetCore } = require("./live-core");

async function buildLiveOrCachedDataset(args) {
  return buildLiveOrCachedDatasetCore(args || {});
}

module.exports = {
  buildLiveOrCachedDataset,
};
