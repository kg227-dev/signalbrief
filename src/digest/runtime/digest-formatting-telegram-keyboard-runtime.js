"use strict";

function buildDigestInlineKeyboard(items) {
  const inlineKeyboard = [];
  const safeItems = Array.isArray(items) ? items : [];

  safeItems.slice(0, 10).forEach((_, idx) => {
    const itemNum = idx + 1;
    inlineKeyboard.push([
      { text: `💾 ${itemNum}`, callback_data: `sb:save:${itemNum}` },
      { text: `➕ ${itemNum}`, callback_data: `sb:more:${itemNum}` },
      { text: `➖ ${itemNum}`, callback_data: `sb:less:${itemNum}` },
    ]);
  });

  inlineKeyboard.push([
    { text: "🔥 Great", callback_data: "sb:fb:great" },
    { text: "👍 Fine", callback_data: "sb:fb:fine" },
    { text: "👎 Meh", callback_data: "sb:fb:meh" },
  ]);

  return { inline_keyboard: inlineKeyboard };
}

module.exports = {
  buildDigestInlineKeyboard,
};
