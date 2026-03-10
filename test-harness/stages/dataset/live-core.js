const { toEtDateKey } = require("../../config");
const { maxRequestedItems } = require("./shared");
const {
  fetchStandardTopicItems,
  fetchCustomTopicItems,
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
  const selectionTarget = maxRequestedItems(personas, Number(digestConfig.itemCount || 7));

  const standardItemsByTopic = await fetchStandardTopicItems({
    topics,
    dateKey,
    appConfig,
    budget,
    args,
  });

  const customItemsByTopic = await fetchCustomTopicItems({
    digestConfig,
    personas,
    dateKey,
    appConfig,
    budget,
    args,
  });

  const {
    standardRawItems,
    customRawItems,
    allRawItems,
    dedupRes,
    dedupedRawItems,
    selectionPolicy,
    selectedItems,
  } = selectLiveDatasetItems({
    standardItemsByTopic,
    customItemsByTopic,
    personas,
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
    customRawItems,
    dedupRes,
    selectedItems,
    selectionPolicy,
    enrichResult,
  });

  return buildLiveDatasetResult({
    args,
    dateKey,
    standardItemsByTopic,
    customItemsByTopic,
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
