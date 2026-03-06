function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTopicToken(value) {
  return normalizeMatchText(String(value || "").replace(/^custom_/i, "").replace(/×/g, " "));
}

function normalizeCustomKeyword(topic) {
  return String(topic || "")
    .replace(/^custom_/, "")
    .replace(/_/g, " ")
    .trim();
}

const CUSTOM_TOPIC_ALIASES = {
  "rate cuts": [
    "federal reserve rate cut",
    "interest rate cuts",
    "fed rate decision",
    "fomc rate decision",
  ],
  "sec rulemaking": [
    "sec proposed rules",
    "securities and exchange commission rules",
    "sec disclosure rule",
    "sec rule proposal",
  ],
  "semicap": [
    "semiconductor equipment",
    "chip equipment",
    "wafer fab equipment",
    "asml applied materials lam research",
  ],
  "agentic ai": [
    "ai agents",
    "enterprise ai agents",
    "autonomous ai agent",
    "openai anthropic microsoft agent",
  ],
  "quantum computing": ["quantum hardware", "quantum platform", "quantum commercial deployment"],
  "glp 1": ["obesity drugs", "weight loss drug", "novo nordisk eli lilly"],
  "doge": ["dogecoin", "crypto regulation", "crypto market"],
};

module.exports = {
  normalizeMatchText,
  normalizeTopicToken,
  normalizeCustomKeyword,
  CUSTOM_TOPIC_ALIASES,
};
