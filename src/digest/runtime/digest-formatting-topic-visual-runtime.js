"use strict";

const { formatTopicDisplay } = require("./digest-formatting-topic-display-runtime");

const STANDARD_TOPIC_TOKENS = new Set([
  "healthcare",
  "financial services",
  "pe m a",
  "energy",
  "consumer",
  "life sciences",
  "technology",
  "industrials",
  "real estate",
  "public sector",
  "ai tech",
  "strategy",
  "policy regulatory",
  "sustainability",
  "digital",
  "m a advisory",
  "talent",
]);

const TOPIC_ICON_MAP = {
  ai: "🤖",
  "ai tech": "🤖",
  technology: "⚙️",
  digital: "⚙️",
  healthcare: "🏥",
  "life sciences": "🧬",
  strategy: "🧭",
  finance: "📊",
  "financial services": "📊",
  markets: "📈",
  sustainability: "🌍",
  climate: "🌍",
  energy: "⚡",
  startups: "🚀",
  policy: "🏛",
  "policy regulatory": "🏛",
  pharma: "💊",
  cybersecurity: "🔐",
  "supply chain": "🚚",
  industrials: "🏭",
  manufacturing: "🏭",
  consumer: "🛍",
  economics: "📉",
  "public sector": "🏛",
  "real estate": "🏢",
  "pe m a": "🤝",
  "m a advisory": "🤝",
  talent: "👥",
};

function inferTopicIcon(token, isCustom) {
  let icon = TOPIC_ICON_MAP[token] || "";
  if (!icon && token.includes("health")) icon = "🏥";
  if (!icon && token.includes("policy")) icon = "🏛";
  if (!icon && token.includes("energy")) icon = "⚡";
  if (!icon && token.includes("climate")) icon = "🌍";
  if (!icon && token.includes("tech")) icon = "⚙️";
  if (!icon && token.includes("finance")) icon = "📊";
  if (!icon && token.includes("market")) icon = "📈";
  if (!icon && token.includes("pharma")) icon = "💊";
  if (!icon && token.includes("bio")) icon = "🧬";
  if (!icon && token.includes("supply")) icon = "🚚";
  if (!icon && token.includes("industrial")) icon = "🏭";
  if (!icon && token.includes("consumer")) icon = "🛍";
  if (!icon && token.includes("start")) icon = "🚀";
  if (!icon && token.includes("cyber")) icon = "🔐";
  if (!icon && token.includes("econ")) icon = "📉";
  if (!icon) icon = isCustom ? "✨" : "📰";
  return icon;
}

function createDigestFormattingTopicVisualRuntime(deps) {
  const { normalizeTopicToken } = deps;

  function topicVisual(tagValue) {
    const raw = String(tagValue || "").trim();
    const token = normalizeTopicToken(raw);
    const isCustom = Boolean(token) && !STANDARD_TOPIC_TOKENS.has(token);
    return {
      icon: inferTopicIcon(token, isCustom),
      isCustom,
      chipBg: isCustom ? "rgba(139,92,246,0.14)" : "rgba(59,130,246,0.12)",
      chipText: isCustom ? "#7C3AED" : "#2563EB",
    };
  }

  return {
    topicVisual,
    formatTopicDisplay,
  };
}

module.exports = {
  createDigestFormattingTopicVisualRuntime,
};
