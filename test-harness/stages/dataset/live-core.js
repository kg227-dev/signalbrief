const { toEtDateKey } = require("../../config");
const { fixedSelectionTarget } = require("./shared");
const {
  fetchStandardTopicItems,
} = require("./live-fetch");
const { selectLiveDatasetItems } = require("./live-selection");
const { enrichLiveDatasetItems } = require("./live-enrichment");
const {
  buildLiveDatasetMetadata,
  buildLiveDatasetResult,
} = require("./live-summary");

async function buildLiveOrCachedDataset({
  appConfig,
  personas,
  args,
  budget,
  archives,
}) {
  const digestConfig = appConfig.digest || {};
  const topics = appConfig.topics || [];
  const dateKey = String(args?.date_key || toEtDateKey());
  const selectionTarget = fixedSelectionTarget(Number(digestConfig.itemCount || 5));

  const standardItemsByTopic = await fetchStandardTopicItems({
    topics,
    dateKey,
    appConfig,
    budget,
    args,
  });

  const {
    standardRawItems,
    allRawItems,
    dedupRes,
    dedupedRawItems,
    selectionPolicy,
    selectedItems,
  } = selectLiveDatasetItems({
    standardItemsByTopic,
    digestConfig,
    selectionTarget,
    archives,
    dateKey,
  });

  const enrichResult = await enrichLiveDatasetItems({
    selectedItems,
    appConfig,
    budget,
    args,
  });
  const metadata = buildLiveDatasetMetadata({
    standardRawItems,
    dedupRes,
    selectedItems,
    selectionPolicy,
    enrichResult,
  });

  return buildLiveDatasetResult({
    args,
    dateKey,
    standardItemsByTopic,
    allRawItems,
    dedupedRawItems,
    selectedItems,
    enrichResult,
    metadata,
  });
}

module.exports = {
  buildLiveOrCachedDataset,
};
