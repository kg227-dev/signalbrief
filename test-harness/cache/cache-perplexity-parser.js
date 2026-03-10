const { qaDebug } = require("./cache-common");

function parseUrlOrNull(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch (err) {
    return null;
  }
}

function selectCitationForHostname(citations, hostname) {
  for (const citation of citations) {
    const parsed = parseUrlOrNull(citation);
    if (parsed && parsed.hostname === hostname) return citation;
  }
  return null;
}

function parsePerplexityItems(responseBody, topicTag) {
  const citations = Array.isArray(responseBody?.citations) ? responseBody.citations : [];
  const content = String(responseBody?.choices?.[0]?.message?.content || "[]")
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let items = [];
  try {
    items = JSON.parse(content);
  } catch (err) {
    qaDebug(`Perplexity JSON parsing failed for ${topicTag}: ${err.message}`);
    items = [];
  }

  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const base = {
      headline: item?.headline || "",
      summary: item?.summary || "",
      source: item?.source || "unknown",
      url: item?.url || "#",
      tag: topicTag,
    };

    const parsedUrl = parseUrlOrNull(base.url);
    if (!parsedUrl) return base;

    if (parsedUrl.pathname === "/" || parsedUrl.pathname === "") {
      const citationUrl = selectCitationForHostname(citations, parsedUrl.hostname);
      if (citationUrl) base.url = citationUrl;
    }
    return base;
  });
}

function buildPerplexityPayload(topicTag, query) {
  return {
    model: "sonar",
    messages: [
      {
        role: "system",
        content: `You are a business and strategy news researcher covering AI, technology, healthcare, financial services, private equity, M&A, energy, consumer, policy, and consulting.\nReturn ONLY a JSON array of up to 3 distinct news items from the last 48 hours.\nEach item MUST include the direct article URL from your citations — not the homepage.\nFormat: [{"headline": string, "summary": string (1 sentence, max 20 words, factual lede only — no analysis), "source": string (domain, e.g. wsj.com), "url": string (full direct article URL from your citations), "tag": "${topicTag}"}]\nNo markdown. No explanation. JSON array only.`,
      },
      {
        role: "user",
        content: `Find the 3 most important news items from the last 48 hours about: ${query}\nIMPORTANT: Use the direct article URLs from your search citations. Do not use homepage URLs.`,
      },
    ],
    max_tokens: 1000,
  };
}

module.exports = {
  parsePerplexityItems,
  buildPerplexityPayload,
};
