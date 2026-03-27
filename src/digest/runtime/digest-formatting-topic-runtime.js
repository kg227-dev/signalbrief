"use strict";

const { createDigestFormattingTopicVisualRuntime } = require("./digest-formatting-topic-visual-runtime");
const { createDigestFormattingTopicLearningRuntime } = require("./digest-formatting-topic-learning-runtime");

function createDigestFormattingTopicRuntime(deps) {
  const topicVisualRuntime = createDigestFormattingTopicVisualRuntime({
    normalizeTopicToken: deps.normalizeTopicToken,
  });
  const topicLearningRuntime = createDigestFormattingTopicLearningRuntime();

  const { topicVisual, formatTopicDisplay } = topicVisualRuntime;
  const { buildLearningSummary } = topicLearningRuntime;

  return {
    topicVisual,
    formatTopicDisplay,
    buildLearningSummary,
  };
}

module.exports = {
  createDigestFormattingTopicRuntime,
};
