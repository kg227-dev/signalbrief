"use strict";

const { createDigestAiFormattingRuntime } = require("./digest-formatting-ai-runtime");
const { createDigestEmailFormattingRuntime } = require("./digest-formatting-email-runtime");
const { createDigestFormattingTopicRuntime } = require("./digest-formatting-topic-runtime");

function createDigestFormattingRuntime(deps) {
  const {
    CONFIG,
    EMAIL_TEMPLATE,
    BASE_URL,
    httpsPostWithRetry,
    buildPublicDigestUrl,
    normalizeTopicToken,
  } = deps;

  const aiRuntime = createDigestAiFormattingRuntime({
    CONFIG,
    httpsPostWithRetry,
  });

  const {
    stripInlineHtml,
    generateLeadSubjectLine,
    generateEditorialNote,
  } = aiRuntime;

  const topicRuntime = createDigestFormattingTopicRuntime({
    normalizeTopicToken,
  });

  const {
    topicVisual,
    formatTopicDisplay,
    buildLearningSummary,
  } = topicRuntime;

  const emailRuntime = createDigestEmailFormattingRuntime({
    BASE_URL,
    EMAIL_TEMPLATE,
    buildPublicDigestUrl,
    topicVisual,
    formatTopicDisplay,
  });

  const {
    scoreColor,
    escapeHtml,
    buildEmailHeaderMeta,
    renderDigestItemHtml,
    applyTemplateSlots,
    buildEmail,
  } = emailRuntime;

  return {
    scoreColor,
    stripInlineHtml,
    generateLeadSubjectLine,
    generateEditorialNote,
    topicVisual,
    escapeHtml,
    buildLearningSummary,
    buildEmailHeaderMeta,
    renderDigestItemHtml,
    applyTemplateSlots,
    buildEmail,
  };
}

module.exports = {
  createDigestFormattingRuntime,
};
