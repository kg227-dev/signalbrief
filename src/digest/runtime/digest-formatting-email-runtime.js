"use strict";

const { createDigestEmailStyleRuntime } = require("./digest-formatting-email-style-runtime");
const { createDigestEmailSectionsRuntime } = require("./digest-formatting-email-sections-runtime");
const { createDigestEmailItemsRuntime } = require("./digest-formatting-email-items-runtime");
const { createDigestEmailTemplateRuntime } = require("./digest-formatting-email-template-runtime");

function createDigestEmailFormattingRuntime(deps) {
  const {
    BASE_URL,
    EMAIL_TEMPLATE,
    topicVisual,
    formatTopicDisplay,
  } = deps;

  const styleRuntime = createDigestEmailStyleRuntime();
  const templateRuntime = createDigestEmailTemplateRuntime();
  const sectionsRuntime = createDigestEmailSectionsRuntime({
    BASE_URL,
    formatTopicDisplay,
    escapeHtml: styleRuntime.escapeHtml,
  });
  const itemsRuntime = createDigestEmailItemsRuntime({
    BASE_URL,
    topicVisual,
    scoreColor: styleRuntime.scoreColor,
    escapeHtml: styleRuntime.escapeHtml,
  });

  function buildEmail(
    items,
    dateStr,
    quickScan,
    userToken = "",
    isFirstDigest = false,
    wasFiltered = true,
    depth = "headline_plus_why",
    user = null,
    digestDateKey = "",
    digestId = "",
    opts = {}
  ) {
    const filterNote = wasFiltered
      ? "filtered to your selected topics"
      : "today's top signals across all areas";
    const learningSummary = String(opts.learningSummary || "").trim();
    const editorialNoteText = String(opts.editorialNote || "").trim();
    const headerMeta = styleRuntime.buildEmailHeaderMeta(items.length, opts.digestQuality);
    const itemsHtml = items
      .map((item, index) => itemsRuntime.renderDigestItemHtml(item, index, { userToken, digestId, depth }))
      .join("\n");

    return templateRuntime.applyTemplateSlots(EMAIL_TEMPLATE, {
      dateStr,
      headerMeta,
      quickScan,
      welcomeBanner: sectionsRuntime.buildWelcomeBanner(isFirstDigest, filterNote, userToken),
      personalizationNote: sectionsRuntime.buildPersonalizationNote(learningSummary),
      editorialNote: sectionsRuntime.buildEditorialNote(editorialNoteText),
      settingsFooter: sectionsRuntime.renderSettingsFooter(user, userToken),
      baseUrl: BASE_URL,
      userToken,
      digestDateKey: digestDateKey || "",
      itemsHtml,
    });
  }

  return {
    scoreColor: styleRuntime.scoreColor,
    escapeHtml: styleRuntime.escapeHtml,
    buildEmailHeaderMeta: styleRuntime.buildEmailHeaderMeta,
    renderDigestItemHtml: itemsRuntime.renderDigestItemHtml,
    applyTemplateSlots: templateRuntime.applyTemplateSlots,
    buildEmail,
  };
}

module.exports = {
  createDigestEmailFormattingRuntime,
};
