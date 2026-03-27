const { selectItems, createSelectionPolicy } = require("../../runtime/pipeline");
const { dedupAgainstRecentArchivesForDataset } = require("./shared");

function selectLiveDatasetItems({
  standardItemsByTopic,
  digestConfig,
  selectionTarget,
  archives,
  dateKey,
}) {
  const standardRawItems = standardItemsByTopic.flatMap((row) => row.items || []);
  const allRawItems = [...standardRawItems];

  const dedupRes = dedupAgainstRecentArchivesForDataset(allRawItems, archives, {
    days: Math.max(1, Number(digestConfig.crossDayDedupDays || 3)),
    minBackfillItems: Math.max(1, Number(digestConfig.minBackfillItemsAfterDedup || 3)),
    targetCount: selectionTarget,
    dateKey,
  });

  const dedupedRawItems = dedupRes.items;

  const selectionPolicy = createSelectionPolicy({
    itemCount: selectionTarget,
    maxItemsPerTag: Number(digestConfig.maxItemsPerTag || 2),
    maxItemsPerSourceDomain: Number(digestConfig.maxItemsPerSourceDomain || 2),
  });
  const selectedItems = selectItems(dedupedRawItems, selectionPolicy);

  return {
    standardRawItems,
    allRawItems,
    dedupRes,
    dedupedRawItems,
    selectionPolicy,
    selectedItems,
  };
}

module.exports = {
  selectLiveDatasetItems,
};
