const { selectItems, createSelectionPolicy } = require("../../runtime/pipeline");
const { normalizeTopicToken } = require("../../utils/topic-utils");
const { dedupAgainstRecentArchivesForDataset } = require("./shared");

function buildTagPriority(personas) {
  const tagPriority = {};
  for (const persona of personas || []) {
    for (const topic of persona.topics || []) {
      const key = normalizeTopicToken(topic);
      if (!key) continue;
      tagPriority[key] = (tagPriority[key] || 0) + 1;
    }
  }
  return tagPriority;
}

function selectLiveDatasetItems({
  standardItemsByTopic,
  customItemsByTopic,
  personas,
  digestConfig,
  selectionTarget,
  archives,
  dateKey,
}) {
  const standardRawItems = standardItemsByTopic.flatMap((row) => row.items || []);
  const customRawItems = customItemsByTopic.flatMap((row) => row.items || []);
  const allRawItems = [...customRawItems, ...standardRawItems];

  const dedupRes = dedupAgainstRecentArchivesForDataset(allRawItems, archives, {
    days: Math.max(1, Number(digestConfig.crossDayDedupDays || 3)),
    minBackfillItems: Math.max(1, Number(digestConfig.minBackfillItemsAfterDedup || 3)),
    targetCount: selectionTarget,
    dateKey,
  });

  const dedupedRawItems = dedupRes.items;
  const customTags = customItemsByTopic.map((row) => row.tag);
  const configuredMaxCustom = Number(digestConfig.maxCustomItemsPerRun);
  const defaultMaxCustom = customTags.length > 0 ? Math.max(1, Math.floor(selectionTarget * 0.4)) : 0;
  const maxCustomItems = Number.isFinite(configuredMaxCustom) && configuredMaxCustom >= 0
    ? configuredMaxCustom
    : defaultMaxCustom;
  const tagPriority = buildTagPriority(personas);

  const selectionPolicy = createSelectionPolicy({
    itemCount: selectionTarget,
    maxItemsPerTag: Number(digestConfig.maxItemsPerTag || 2),
    maxItemsPerSourceDomain: Number(digestConfig.maxItemsPerSourceDomain || 2),
    customTags,
    maxCustomItems,
    tagPriority,
  });
  const selectedItems = selectItems(dedupedRawItems, selectionPolicy);

  return {
    standardRawItems,
    customRawItems,
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
