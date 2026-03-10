"use strict";

const path = require("path");
const { createReplyLogger, createReplyIntentTracer } = require("./reply-logging-runtime");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");

const INDUSTRY_TOPICS = [
  "HEALTHCARE", "FINANCIAL SERVICES", "PE×M&A", "ENERGY", "CONSUMER",
  "LIFE SCIENCES", "TECHNOLOGY", "INDUSTRIALS", "REAL ESTATE", "PUBLIC SECTOR",
];
const CAPABILITY_TOPICS = [
  "AI×TECH", "STRATEGY", "POLICY×REGULATORY", "SUSTAINABILITY",
  "DIGITAL", "M&A ADVISORY", "TALENT",
];
const STANDARD_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];
const LINK_VERIFY_TTL_MS = 10 * 60 * 1000;

function defaultBaseUrl() {
  return process.env.BASE_URL || "https://getsignalbrief.com";
}

function formatDeliveryTime(prefs) {
  const time = (prefs && prefs.delivery_time) || "07:00";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  const min = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  return `${hour}${min} ${ampm} ET`;
}

function isReplyHandlerDebug() {
  return process.env.REPLY_HANDLER_DEBUG === "1";
}

function resolveReplyHandlerLogLevel() {
  if (process.env.REPLY_HANDLER_LOG_LEVEL) return process.env.REPLY_HANDLER_LOG_LEVEL;
  return isReplyHandlerDebug() ? "debug" : "warn";
}

function createDefaultReplyLogger() {
  return createReplyLogger({ level: resolveReplyHandlerLogLevel() });
}

function createDefaultIntentTracer(logger) {
  return createReplyIntentTracer({
    logger,
    enabled: isReplyHandlerDebug() || process.env.REPLY_HANDLER_TRACE_INTENT === "1",
    sampleRate: isReplyHandlerDebug() ? 1 : process.env.REPLY_HANDLER_TRACE_SAMPLE_RATE,
  });
}

module.exports = {
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
};
