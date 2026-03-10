#!/usr/bin/env node
"use strict";

const runtime = require("./reply-handler-core-runtime");

if (require.main === module) {
  const isolatedRuntime = runtime.createReplyHandlerRuntime();
  isolatedRuntime.ensureStoreReady();
  const message = process.argv[2];
  const chatId = process.argv[3] || isolatedRuntime.getConfig().user.telegramChatId;
  if (!message) {
    isolatedRuntime.replyLogger.error("Usage: node src/runtime/reply/reply-handler-runtime.js '<message>' [chat_id]");
    process.exit(1);
  }
  isolatedRuntime.handleIncomingMessage(message, chatId).catch((error) => {
    isolatedRuntime.replyLogger.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = runtime;
