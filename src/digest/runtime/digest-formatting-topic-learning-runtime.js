"use strict";

const { formatTopicDisplay } = require("./digest-formatting-topic-display-runtime");

function createDigestFormattingTopicLearningRuntime() {
  function buildLearningSummary(adjustments, maxTopics = 2) {
    const rows = (Array.isArray(adjustments) ? adjustments : [])
      .map((adjustment) => ({
        topic: formatTopicDisplay(adjustment?.topic),
        delta: Number(adjustment?.delta),
      }))
      .filter((row) => row.topic && Number.isFinite(row.delta) && row.delta !== 0);

    if (!rows.length) return "";

    const shown = rows.slice(0, Math.max(1, Number(maxTopics) || 2));
    const parts = shown.map((row) => `${row.topic} ${row.delta > 0 ? `+${row.delta}` : row.delta}`);
    const remaining = rows.length - shown.length;
    const suffix = remaining > 0 ? ` · +${remaining} more` : "";
    return `Applied from your recent saves, clicks, and skips: ${parts.join(" · ")}${suffix}.`;
  }

  return {
    buildLearningSummary,
  };
}

module.exports = {
  createDigestFormattingTopicLearningRuntime,
};
