"use strict";

const { normalizeTopicToken } = require("./topic-normalization-runtime");

const BROKER_TOPIC_KEYWORDS = Object.freeze({
  [normalizeTopicToken("HEALTHCARE")]: Object.freeze([
    "healthcare",
    "hospital",
    "health system",
    "medicare",
    "medicaid",
    "payer",
    "provider",
    "physician",
    "clinic",
    "patient",
    "care delivery",
    "reimbursement",
    "medical device",
  ]),
  [normalizeTopicToken("LIFE SCIENCES")]: Object.freeze([
    "life sciences",
    "biotech",
    "biopharma",
    "pharma",
    "pharmaceutical",
    "drug",
    "therapy",
    "therapeutic",
    "clinical trial",
    "trial",
    "phase 1",
    "phase 2",
    "phase 3",
    "biologic",
    "molecule",
  ]),
  [normalizeTopicToken("TECHNOLOGY")]: Object.freeze([
    "technology",
    "software",
    "artificial intelligence",
    "ai",
    "semiconductor",
    "chip",
    "cloud",
    "cyber",
    "privacy",
    "data",
    "platform",
    "app",
    "digital",
    "saas",
  ]),
  [normalizeTopicToken("ENERGY")]: Object.freeze([
    "energy",
    "oil",
    "gas",
    "utility",
    "utilities",
    "power",
    "grid",
    "solar",
    "wind",
    "battery",
    "transmission",
    "pipeline",
    "renewable",
    "nuclear",
    "electricity",
  ]),
  [normalizeTopicToken("FINANCIAL SERVICES")]: Object.freeze([
    "financial services",
    "bank",
    "banking",
    "lender",
    "lending",
    "credit",
    "payments",
    "payment",
    "capital markets",
    "securities",
    "asset manager",
    "fintech",
    "insurance",
    "brokerage",
    "consumer lending",
    "private equity",
  ]),
  [normalizeTopicToken("CONSUMER & RETAIL")]: Object.freeze([
    "consumer",
    "retail",
    "retailer",
    "grocery",
    "restaurant",
    "ecommerce",
    "e commerce",
    "apparel",
    "beauty",
    "brand",
    "shopper",
    "checkout",
    "loyalty program",
    "marketplace",
    "pricing",
  ]),
  [normalizeTopicToken("INDUSTRIALS")]: Object.freeze([
    "industrial",
    "manufacturing",
    "factory",
    "logistics",
    "freight",
    "transportation",
    "aerospace",
    "defense",
    "auto",
    "automotive",
    "airline",
    "rail",
    "supply chain",
  ]),
});

function normalizeTopicTag(value) {
  const raw = String(value || "").trim().toUpperCase();
  return raw;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBrokerWordBoundary(text, token) {
  const haystack = String(text || "").trim();
  const needle = String(token || "").trim();
  if (!haystack || !needle) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`, "i").test(haystack);
}

function matchesBrokerKeyword(text, keyword) {
  const normalizedKeyword = normalizeTopicToken(keyword);
  if (!normalizedKeyword) return false;
  if (String(text || "").includes(normalizedKeyword)) return true;
  const tokens = normalizedKeyword.split(" ").filter(Boolean);
  return tokens.length > 1 && tokens.every((token) => hasBrokerWordBoundary(text, token));
}

function scoreBestFitTopicTag(topicTag, text) {
  const topicToken = normalizeTopicToken(topicTag);
  if (!topicToken || !text) return 0;

  let score = 0;
  if (String(text).includes(topicToken)) score += 8;

  for (const token of topicToken.split(" ").filter(Boolean)) {
    if (token.length <= 2 && !["ai"].includes(token)) continue;
    if (hasBrokerWordBoundary(text, token)) score += 2;
  }

  const keywords = BROKER_TOPIC_KEYWORDS[topicToken] || [];
  for (const keyword of keywords) {
    if (!matchesBrokerKeyword(text, keyword)) continue;
    score += normalizeTopicToken(keyword).includes(" ") ? 4 : 3;
  }

  return score;
}

function chooseBestFitTopicTag(topicTags, item = {}) {
  const candidates = Array.from(new Set((Array.isArray(topicTags) ? topicTags : []).map(normalizeTopicTag).filter(Boolean)));
  if (candidates.length <= 1) return candidates[0] || "";

  const text = normalizeTopicToken([
    item?.headline,
    item?.summary,
    item?.canonical_url,
    item?.url,
  ].filter(Boolean).join(" "));

  let bestTag = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreBestFitTopicTag(candidate, text);
    if (score > bestScore) {
      bestTag = candidate;
      bestScore = score;
    }
  }
  return bestTag;
}

function assignCanonicalTopic(topicTags, item) {
  const candidates = Array.isArray(topicTags) ? topicTags : [];
  if (candidates.length === 0) return null;
  if (!item || typeof item !== "object") return candidates[0];
  return chooseBestFitTopicTag(candidates, item) || candidates[0];
}

module.exports = {
  assignCanonicalTopic,
  chooseBestFitTopicTag,
  normalizeTopicTag,
  scoreBestFitTopicTag,
};
