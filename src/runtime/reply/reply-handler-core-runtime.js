#!/usr/bin/env node
/**
 * SignalBrief — reply-handler.js
 * Handles inbound Telegram messages and callback actions.
 */
"use strict";

const path = require("path");
const { loadConfig } = require("../config-provider");
const { createTelegramTransport, createAnthropicTransport } = require("./transport");
const { createIntentService } = require("./intent-service");
const { createCommandRouter } = require("./command-router");
const { createReplyState, createReplySessionController } = require("./reply-session-runtime");
const { createInfoHandlers } = require("./info-handlers-runtime");
const { createReplyCommandHandlers } = require("./reply-command-handlers-runtime");
const { createReplyOnboardingService } = require("./reply-handler-onboarding-runtime");
const {
  APP_ROOT,
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
  STANDARD_TOPICS,
  LINK_VERIFY_TTL_MS,
  defaultBaseUrl,
  formatDeliveryTime,
  isReplyHandlerDebug,
  createDefaultReplyLogger,
  createDefaultIntentTracer,
} = require("./reply-handler-defaults-runtime");
const { createStore } = require("../store");
const { USER_STATUS } = require("../user-contract-runtime");
const { sendWelcomeEmail } = require("../mailer/mailer-runtime");

function createReplyHandlerRuntime(options = {}) {
  const runtimeStore = options.store || createStore();
  const replySession = options.replySession || createReplySessionController({ store: runtimeStore });
  const loadRuntimeConfig = typeof options.loadConfig === "function" ? options.loadConfig : loadConfig;
  const getBaseUrl = typeof options.getBaseUrl === "function" ? options.getBaseUrl : defaultBaseUrl;
  const appRoot = options.appRoot ? path.resolve(String(options.appRoot)) : APP_ROOT;
  const linkVerifyTtlMs = Math.max(60_000, Number(options.linkVerifyTtlMs || LINK_VERIFY_TTL_MS));

  const { readUser, writeUser, allUsers, generateToken } = runtimeStore;

  function ensureStoreReady() {
    replySession.ensureStoreReady();
  }

  function getConfig() {
    return loadRuntimeConfig();
  }

  function getConfigKeys() {
    const config = getConfig();
    return config && typeof config.keys === "object" ? config.keys : {};
  }

  function getBotToken() {
    const keys = getConfigKeys();
    return keys.signalBriefBotToken || "";
  }

  const telegramTransport = options.telegramTransport || createTelegramTransport(getBotToken);
  const anthropicTransport = options.anthropicTransport || createAnthropicTransport(() => getConfigKeys().anthropic || "");
  const intentService = options.intentService || createIntentService((payload) => anthropicTransport.requestMessage(payload));
  const replyLogger = options.replyLogger || createDefaultReplyLogger();
  const replyIntentTracer = options.replyIntentTracer || createDefaultIntentTracer(replyLogger);

  function send(chatId, text, extra = {}) {
    return telegramTransport.sendMessage(chatId, text, extra);
  }

  const onboardingService = createReplyOnboardingService({
    options,
    state: replySession.getState,
    appRoot,
    linkVerifyTtlMs,
    send,
    allUsers,
    writeUser,
    USER_STATUS,
    formatDeliveryTime,
  });

  const infoHandlers = createInfoHandlers({
    userStore: {
      readUser,
    },
    runtimeConfig: {
      getConfig,
      getBaseUrl,
      formatDeliveryTime,
    },
    messaging: {
      send,
      anthropicTransport,
    },
    topicCatalog: {
      INDUSTRY_TOPICS,
      CAPABILITY_TOPICS,
    },
  });

  const commandHandlers = createReplyCommandHandlers({
    state: replySession.getState,
    send,
    userStore: {
      readUser,
      writeUser,
      allUsers,
      generateToken,
    },
    runtimeConfig: {
      getConfig,
      getBaseUrl,
      formatDeliveryTime,
      sendWelcomeEmail,
      isReplyHandlerDebug,
    },
    onboarding: {
      onboardingService,
    },
    taxonomy: {
      standardTopics: STANDARD_TOPICS,
    },
  });

  const routeCommand = createCommandRouter({
    start: (intent, chatId) => commandHandlers.handleStart(chatId, intent.email),
    verify_link: (intent, chatId) => onboardingService.handleVerifyLink(chatId, intent.code),
    digest: (_intent, chatId) => commandHandlers.handleDigest(chatId),
    save: (intent, chatId) => commandHandlers.handleSave(chatId, intent.items),
    topic_more: (intent, chatId) => commandHandlers.handleTopicMore(chatId, intent.topic),
    topic_less: (intent, chatId) => commandHandlers.handleTopicLess(chatId, intent.topic),
    topic_add: (intent, chatId) => commandHandlers.handleTopicAdd(chatId, intent.topic),
    source_block: (intent, chatId) => commandHandlers.handleSourceBlock(chatId, intent.source || intent.topic),
    source_trust: (intent, chatId) => commandHandlers.handleSourceTrust(chatId, intent.source || intent.topic),
    source_unblock: (intent, chatId) => commandHandlers.handleSourceUnblock(chatId, intent.source || intent.topic),
    settings: (_intent, chatId) => infoHandlers.handleSettings(chatId),
    bookmarks: (_intent, chatId) => infoHandlers.handleBookmarks(chatId),
    topics: (_intent, chatId) => infoHandlers.handleTopics(chatId),
    help: (_intent, chatId) => infoHandlers.handleHelp(chatId),
    question: (intent, chatId) => infoHandlers.handleQuestion(chatId, intent.question),
    default: (_intent, chatId) => infoHandlers.handleHelp(chatId),
  });

  function resetReplyState() {
    return replySession.resetReplyState();
  }

  function resetReplyRuntimeState() {
    return replySession.resetRuntimeState();
  }

  async function parseIntent(message) {
    return intentService.parseIntent(message);
  }

  async function handleIncomingMessage(message, chatId) {
    ensureStoreReady();
    if (onboardingService.isAwaitingEmail(chatId) && !message.trim().startsWith("/")) {
      return commandHandlers.handleEmailCapture(chatId, message);
    }

    const intent = await parseIntent(message);
    const action = String(intent?.action || "unknown");
    const messageLen = String(message || "").length;
    replyLogger.info(`action=${action} message_len=${messageLen}`);
    replyIntentTracer.traceIntent(intent, { action, messageLen, chatId });
    return routeCommand(intent, chatId);
  }

  function handleCallbackQuery(data, chatId) {
    ensureStoreReady();
    return commandHandlers.handleCallback(data, chatId);
  }

  return {
    ensureStoreReady,
    getConfig,
    getConfigKeys,
    getBotToken,
    parseIntent,
    handleIncomingMessage,
    handleCallbackQuery,
    handle: handleIncomingMessage,
    handleCallback: handleCallbackQuery,
    resetReplyState,
    resetReplyRuntimeState,
    replyLogger,
    replyIntentTracer,
    replySession,
    store: runtimeStore,
  };
}

let defaultReplyRuntime = null;

function getDefaultReplyRuntime() {
  if (!defaultReplyRuntime) {
    defaultReplyRuntime = createReplyHandlerRuntime();
  }
  return defaultReplyRuntime;
}

function resetReplyState() {
  return getDefaultReplyRuntime().resetReplyState();
}

function resetReplyRuntimeState() {
  return getDefaultReplyRuntime().resetReplyRuntimeState();
}

function handleIncomingMessage(message, chatId) {
  return getDefaultReplyRuntime().handleIncomingMessage(message, chatId);
}

function handleCallbackQuery(data, chatId) {
  return getDefaultReplyRuntime().handleCallbackQuery(data, chatId);
}

function handle(message, chatId) {
  return handleIncomingMessage(message, chatId);
}

function handleCallback(data, chatId) {
  return handleCallbackQuery(data, chatId);
}

if (require.main === module) {
  const runtime = getDefaultReplyRuntime();
  runtime.ensureStoreReady();
  const message = process.argv[2];
  const chatId = process.argv[3] || runtime.getConfig().user.telegramChatId;
  if (!message) {
    runtime.replyLogger.error("Usage: node src/runtime/reply/reply-handler-runtime.js '<message>' [chat_id]");
    process.exit(1);
  }
  runtime.handleIncomingMessage(message, chatId).catch((error) => {
    runtime.replyLogger.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  createReplyState,
  createReplyHandlerRuntime,
  resetReplyState,
  resetReplyRuntimeState,
  handleIncomingMessage,
  handleCallbackQuery,
  handle,
  handleCallback,
};
