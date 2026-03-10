"use strict";

const { createDigestFormattingTopicVisualRuntime } = require("./digest-formatting-topic-visual-runtime");
const { createDigestFormattingTopicRescueRuntime } = require("./digest-formatting-topic-rescue-runtime");
const { createDigestFormattingTopicLearningRuntime } = require("./digest-formatting-topic-learning-runtime");

function createDigestFormattingTopicRuntime(deps) {
  const topicVisualRuntime = createDigestFormattingTopicVisualRuntime({
    normalizeTopicToken: deps.normalizeTopicToken,
  });
  const topicRescueRuntime = createDigestFormattingTopicRescueRuntime(deps);
  const topicLearningRuntime = createDigestFormattingTopicLearningRuntime();

  const { topicVisual, formatTopicDisplay } = topicVisualRuntime;
  const { buildCustomRescueItemsFromStandard } = topicRescueRuntime;
  const { buildLearningSummary } = topicLearningRuntime;

  return {
    topicVisual,
    formatTopicDisplay,
    buildCustomRescueItemsFromStandard,
    buildLearningSummary,
  };
}

module.exports = {
  createDigestFormattingTopicRuntime,
};
