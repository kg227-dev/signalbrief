"use strict";

function getTopicQueries(topic) {
  if (!Array.isArray(topic?.queries) || !topic.queries.length) return [];
  return topic.queries.map((query) => String(query || "").trim()).filter(Boolean);
}

function buildSearchRequest(topicTag, query, model) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: `You are a business and strategy news researcher covering AI, technology, healthcare, financial services, private equity, M&A, energy, consumer, policy, and consulting.
Return ONLY a JSON array of up to 3 distinct news items from the last 48 hours.
Each item MUST include the direct article URL from your citations — not the homepage.
Format: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. wsj.com), "url": string (full direct article URL from your citations), "published_date": string (ISO 8601 date like "2026-03-15", best estimate from article), "tag": "${topicTag}"}]
No markdown. No explanation. JSON array only.`,
      },
      {
        role: "user",
        content: `Find the 3 most important news items from the last 48 hours about: ${query}
IMPORTANT: Use the direct article URLs from your search citations. Do not use homepage URLs.`,
      },
    ],
    max_tokens: 1000,
  };
}

module.exports = {
  getTopicQueries,
  buildSearchRequest,
};
