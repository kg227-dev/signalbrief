function createIntentService(requestAnthropicMessage) {
  async function parseIntent(message) {
    const m = String(message || "").trim().toLowerCase();
    if (m.startsWith("/start")) {
      const parts = String(message || "").trim().split(/\s+/);
      return { action: "start", email: parts[1] || null };
    }
    if (m === "/digest") return { action: "digest" };
    if (m === "/settings") return { action: "settings" };
    if (m === "/bookmarks") return { action: "bookmarks" };
    if (m === "/topics") return { action: "topics" };
    if (m === "/help") return { action: "help" };
    if (m.startsWith("/verify")) {
      const parts = String(message || "").trim().split(/\s+/);
      return { action: "verify_link", code: parts[1] || null };
    }

    const prompt = `The user replied to their SignalBrief news digest with: "${message}"

Parse intent. Return ONLY valid JSON:
{
  "action": "save" | "topic_more" | "topic_less" | "topic_add" | "settings" | "bookmarks" | "topics" | "help" | "question" | "unknown",
  "items": [],
  "topic": null,
  "question": null
}

Rules:
- save / bookmark / keep + numbers → action=save, items=[nums]
- more [topic] / I want more [topic] / more [topic] stories → action=topic_more, topic=normalized tag
- less/fewer [topic] → action=topic_less, topic=normalized tag
- add/track [keyword] → action=topic_add, topic=keyword
- settings/preferences/config → action=settings
- bookmarks/saved/my saves → action=bookmarks
- topics/what do you cover → action=topics
- help/commands/how do I → action=help
- otherwise → action=question or unknown

Normalize topics: "ai" → "AI", "pharma" → "PHARMA", "M&A" → "M&A", "digital health" → "DIGITAL HEALTH", etc.
Item numbers: parse "1,4,6" or "1 4 6" or "#3" or "item 3" or "number 3" — all as arrays of integers.

Examples:
"save 3" → {"action":"save","items":[3],"topic":null,"question":null}
"Save #3" → {"action":"save","items":[3],"topic":null,"question":null}
"bookmark 1, 4, 6" → {"action":"save","items":[1,4,6],"topic":null,"question":null}
"save 1 4 6" → {"action":"save","items":[1,4,6],"topic":null,"question":null}
"more AI" → {"action":"topic_more","items":[],"topic":"AI","question":null}
"less pharma m&a" → {"action":"topic_less","items":[],"topic":"PHARMA×M&A","question":null}
"add GLP-1" → {"action":"topic_add","items":[],"topic":"GLP-1","question":null}
"what does 340B mean?" → {"action":"question","items":[],"topic":null,"question":"what does 340B mean?"}`;

    const res = await requestAnthropicMessage({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    try {
      let text = res.body?.content?.[0]?.text || "{}";
      text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(text);
    } catch {
      return { action: "unknown" };
    }
  }

  return {
    parseIntent,
  };
}

module.exports = {
  createIntentService,
};
