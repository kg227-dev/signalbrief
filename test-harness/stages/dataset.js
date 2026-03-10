const path = require("path");
const { ROOT_DIR } = require("../config");
const { loadArchiveDigests } = require("../cache");
const {
  standardTopicUniverse,
  buildRecentRepeatIndexFromArchives,
} = require("./dataset/shared");
const { buildOfflineDatasetFromArchives } = require("./dataset/offline");
const { buildLiveOrCachedDataset } = require("./dataset/live");

/**
 * Dataset stage interface.
 * @returns {Promise<{dataset: object, archives: Array, recentRepeatIndex: object}>}
 */
async function runDatasetStage({ appConfig, personas, args, budget }) {
  const archiveDir = path.join(ROOT_DIR, "archive");
  const archives = loadArchiveDigests(archiveDir);

  let dataset;
  try {
    dataset = await buildLiveOrCachedDataset({
      appConfig,
      personas,
      args,
      budget,
      archives,
    });
  } catch (err) {
    if (!args.offline_fallback) throw err;
    dataset = buildOfflineDatasetFromArchives(appConfig, archives);
  }

  const dedupDays = Math.max(1, Number(appConfig?.digest?.crossDayDedupDays || 3));
  const recentRepeatIndex = buildRecentRepeatIndexFromArchives(archives, dedupDays);

  return {
    dataset,
    archives,
    recentRepeatIndex,
  };
}

module.exports = {
  runDatasetStage,
  standardTopicUniverse,
};
