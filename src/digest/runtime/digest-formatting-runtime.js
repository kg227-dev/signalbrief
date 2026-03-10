"use strict";

const { createDigestAiFormattingRuntime } = require("./digest-formatting-ai-runtime");
const { createDigestEmailFormattingRuntime } = require("./digest-formatting-email-runtime");
const { createDigestFormattingTopicRuntime } = require("./digest-formatting-topic-runtime");
const { createDigestFormattingTelegramRuntime } = require("./digest-formatting-telegram-runtime");

function createDigestFormattingRuntime(deps) {
  const {
    CONFIG,
    EMAIL_TEMPLATE,
    BASE_URL,
    httpsPostWithRetry,
    buildPublicDigestUrl,
    normalizeTopicToken,
    customKeywordMatches,
    normalizeMatchText,
    headlineFingerprint,
    normalizeUrlForDedup,
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
    customKeywordMatches,
    normalizeMatchText,
    headlineFingerprint,
    normalizeUrlForDedup,
  });

  const {
    topicVisual,
    formatTopicDisplay,
    buildCustomRescueItemsFromStandard,
    buildLearningSummary,
  } = topicRuntime;

  const telegramRuntime = createDigestFormattingTelegramRuntime();
  const {
    formatTelegram,
    buildDigestInlineKeyboard,
  } = telegramRuntime;

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
    buildCustomRescueItemsFromStandard,
    escapeHtml,
    buildLearningSummary,
    formatTelegram,
    buildDigestInlineKeyboard,
    buildEmailHeaderMeta,
    renderDigestItemHtml,
    applyTemplateSlots,
    buildEmail,
  };
}

module.exports = {
  createDigestFormattingRuntime,
};
