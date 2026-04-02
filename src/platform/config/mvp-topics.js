"use strict";

const MVP_TOPIC_TAGS = Object.freeze([
  "HEALTHCARE",
  "LIFE SCIENCES",
  "TECHNOLOGY",
  "ENERGY",
  "FINANCIAL SERVICES",
  "CONSUMER & RETAIL",
  "INDUSTRIALS",
]);

const MVP_TOPIC_TAG_SET = new Set(MVP_TOPIC_TAGS);

function isMvpTopic(tag) {
  return MVP_TOPIC_TAG_SET.has(String(tag || "").trim().toUpperCase());
}

module.exports = {
  MVP_TOPIC_TAGS,
  MVP_TOPIC_TAG_SET,
  isMvpTopic,
};
