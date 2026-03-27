"use strict";

function createDigestEmailTemplateRuntime() {
  function applyTemplateSlots(template, slots = {}) {
    return template
      .replace(/\{\{DATE\}\}/g, slots.dateStr || "")
      .replace("{{ITEM_COUNT}}", slots.headerMeta || "")
      .replace("{{QUICK_SCAN}}", slots.quickScan || "")
      .replace("{{WELCOME_BANNER}}", slots.welcomeBanner || "")
      .replace("{{PERSONALIZATION_NOTE}}", slots.personalizationNote || "")
      .replace("{{EDITORIAL_NOTE}}", slots.editorialNote || "")
      .replace("{{SETTINGS_FOOTER}}", slots.settingsFooter || "")
      .replace(/\{\{BASE_URL\}\}/g, slots.baseUrl || "")
      .replace(/\{\{SETTINGS_TOKEN\}\}/g, slots.userToken || "")
      .replace(/\{\{CURRENT_DIGEST_DATE\}\}/g, slots.digestDateKey || "")
      .replace(
        /<!-- Items -->[\s\S]*<!-- Footer -->/,
        `<!-- Items -->\n    <div class="items" style="padding:0;background:#FFFFFF;">\n${slots.itemsHtml || ""}\n    </div>\n\n    <!-- Footer -->`
      );
  }

  return {
    applyTemplateSlots,
  };
}

module.exports = {
  createDigestEmailTemplateRuntime,
};
