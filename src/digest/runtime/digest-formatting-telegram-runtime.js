"use strict";

const { formatTelegram } = require("./digest-formatting-telegram-content-runtime");
const { buildDigestInlineKeyboard } = require("./digest-formatting-telegram-keyboard-runtime");

function createDigestFormattingTelegramRuntime() {
  return {
    formatTelegram,
    buildDigestInlineKeyboard,
  };
}

module.exports = {
  createDigestFormattingTelegramRuntime,
};
