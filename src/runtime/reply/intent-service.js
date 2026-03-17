const ALLOWED_ACTIONS = new Set([
  "start",
  "verify_link",
  "digest",
  "save",
  "topic_more",
  "topic_less",
  "topic_add",
  "source_block",
  "source_trust",
  "source_unblock",
  "settings",
  "bookmarks",
  "topics",
  "help",
  "question",
  "unknown",
]);

function createBaseIntent(action = "unknown") {
  return {
    action,
    items: [],
    topic: null,
    source: null,
    question: null,
    email: null,
    code: null,
  };
}

function normalizeIntentAction(rawAction) {
  const action = String(rawAction || "").trim().toLowerCase();
  return ALLOWED_ACTIONS.has(action) ? action : "unknown";
}

function normalizeIntentItems(rawItems, opts = {}) {
  const maxItems = Math.max(1, Number(opts.maxItems || 12));
  const maxItemValue = Math.max(1, Number(opts.maxItemValue || 50));
  let values = [];

  if (Array.isArray(rawItems)) {
    values = rawItems;
  } else if (typeof rawItems === "string") {
    values = rawItems.split(/[^0-9]+/).filter(Boolean);
  } else if (Number.isFinite(Number(rawItems))) {
    values = [rawItems];
  }

  const out = [];
  for (const value of values) {
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > maxItemValue) continue;
    if (out.includes(n)) continue;
    out.push(n);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeIntentTopic(rawTopic, maxLen = 80) {
  if (typeof rawTopic !== "string") return null;
  const topic = rawTopic.trim().replace(/\s+/g, " ");
  if (!topic) return null;
  return topic.slice(0, Math.max(8, Number(maxLen || 80)));
}

function normalizeIntentQuestion(rawQuestion, maxLen = 500) {
  if (typeof rawQuestion !== "string") return null;
  const question = rawQuestion.trim().replace(/\s+/g, " ");
  if (!question) return null;
  return question.slice(0, Math.max(32, Number(maxLen || 500)));
}

function normalizeOptionalText(rawValue, maxLen = 160) {
  const value = String(rawValue == null ? "" : rawValue).trim();
  if (!value) return null;
  return value.slice(0, Math.max(8, Number(maxLen || 160)));
}

function normalizeIntentPayload(payload, opts = {}) {
  const intent = createBaseIntent();
  const action = normalizeIntentAction(payload?.action);
  intent.action = action;

  if (action === "start") {
    intent.email = normalizeOptionalText(payload?.email, 256);
    return intent;
  }

  if (action === "verify_link") {
    intent.code = normalizeOptionalText(payload?.code, 32);
    return intent;
  }

  if (action === "save") {
    intent.items = normalizeIntentItems(payload?.items);
    return intent;
  }

  if (action === "topic_more" || action === "topic_less" || action === "topic_add") {
    intent.topic = normalizeIntentTopic(payload?.topic);
    if (!intent.topic) return createBaseIntent("unknown");
    intent.action = action;
    return intent;
  }

  if (action === "source_block" || action === "source_trust" || action === "source_unblock") {
    const raw = String(payload?.source || payload?.domain || payload?.topic || "").trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/\s]/)[0];
    intent.source = raw || null;
    if (!intent.source) return createBaseIntent("unknown");
    intent.action = action;
    return intent;
  }

  if (action === "question") {
    const fallbackQuestion = normalizeIntentQuestion(opts.fallbackQuestion);
    intent.question = normalizeIntentQuestion(payload?.question) || fallbackQuestion;
    if (!intent.question) return createBaseIntent("unknown");
    return intent;
  }

  return intent;
}

function parseCommandIntent(message) {
  const normalizedMessage = String(message || "").trim();
  const m = normalizedMessage.toLowerCase();
  if (m.startsWith("/start")) {
    const parts = normalizedMessage.split(/\s+/);
    return normalizeIntentPayload({ action: "start", email: parts[1] || null });
  }
  if (m === "/digest") return normalizeIntentPayload({ action: "digest" });
  if (m === "/settings") return normalizeIntentPayload({ action: "settings" });
  if (m === "/bookmarks") return normalizeIntentPayload({ action: "bookmarks" });
  if (m === "/topics") return normalizeIntentPayload({ action: "topics" });
  if (m === "/help") return normalizeIntentPayload({ action: "help" });
  if (m.startsWith("/verify")) {
    const parts = normalizedMessage.split(/\s+/);
    return normalizeIntentPayload({ action: "verify_link", code: parts[1] || null });
  }
  if (m.startsWith("/block ") || m.startsWith("/block\t")) {
    const source = normalizedMessage.slice(7).trim();
    return normalizeIntentPayload({ action: "source_block", source: source || null });
  }
  if (m.startsWith("/trust ") || m.startsWith("/trust\t")) {
    const source = normalizedMessage.slice(7).trim();
    return normalizeIntentPayload({ action: "source_trust", source: source || null });
  }
  if (m.startsWith("/unblock ") || m.startsWith("/unblock\t")) {
    const source = normalizedMessage.slice(9).trim();
    return normalizeIntentPayload({ action: "source_unblock", source: source || null });
  }
  return null;
}

function buildIntentPrompt(message) {
  return `The user replied to their SignalBrief news digest with: "${message}"

Parse intent. Return ONLY valid JSON:
{
  "action": "save" | "topic_more" | "topic_less" | "topic_add" | "source_block" | "source_trust" | "source_unblock" | "settings" | "bookmarks" | "topics" | "help" | "question" | "unknown",
  "items": [],
  "topic": null,
  "source": null,
  "question": null
}

Rules:
- save / bookmark / keep + numbers → action=save, items=[nums]
- more [topic] / I want more [topic] / more [topic] stories → action=topic_more, topic=normalized tag
- less/fewer [topic] → action=topic_less, topic=normalized tag
- add/track [keyword] → action=topic_add, topic=keyword
- block/hide/suppress/stop showing [domain] → action=source_block, source=domain
- trust/boost/prefer [domain] → action=source_trust, source=domain
- unblock/restore/undo block [domain] → action=source_unblock, source=domain
- settings/preferences/config → action=settings
- bookmarks/saved/my saves → action=bookmarks
- topics/what do you cover → action=topics
- help/commands/how do I → action=help
- otherwise → action=question or unknown

Normalize topics: "ai" → "AI", "pharma" → "PHARMA", "M&A" → "M&A", "digital health" → "DIGITAL HEALTH", etc.
Normalize sources: strip http(s)://, www., and any path. E.g. "https://www.reuters.com/article/x" → "reuters.com"
Item numbers: parse "1,4,6" or "1 4 6" or "#3" or "item 3" or "number 3" — all as arrays of integers.

Examples:
"save 3" → {"action":"save","items":[3],"topic":null,"source":null,"question":null}
"Save #3" → {"action":"save","items":[3],"topic":null,"source":null,"question":null}
"bookmark 1, 4, 6" → {"action":"save","items":[1,4,6],"topic":null,"source":null,"question":null}
"more AI" → {"action":"topic_more","items":[],"topic":"AI","source":null,"question":null}
"less pharma m&a" → {"action":"topic_less","items":[],"topic":"PHARMA×M&A","source":null,"question":null}
"add GLP-1" → {"action":"topic_add","items":[],"topic":"GLP-1","source":null,"question":null}
"block benzinga.com" → {"action":"source_block","items":[],"topic":null,"source":"benzinga.com","question":null}
"stop showing reuters.com" → {"action":"source_block","items":[],"topic":null,"source":"reuters.com","question":null}
"trust wsj.com" → {"action":"source_trust","items":[],"topic":null,"source":"wsj.com","question":null}
"unblock benzinga.com" → {"action":"source_unblock","items":[],"topic":null,"source":"benzinga.com","question":null}
"what does 340B mean?" → {"action":"question","items":[],"topic":null,"source":null,"question":"what does 340B mean?"}`;
}

function parseIntentModelResponse(responseBodyText) {
  let text = String(responseBodyText || "{}");
  text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(text);
}

async function parseIntentFromModel({ requestAnthropicMessage, message }) {
  const prompt = buildIntentPrompt(message);
  const res = await requestAnthropicMessage({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  try {
    const responseBody = res && res.kind === "json" && res.body && typeof res.body === "object"
      ? res.body
      : null;
    const parsed = parseIntentModelResponse(responseBody?.content?.[0]?.text);
    return normalizeIntentPayload(parsed, { fallbackQuestion: message });
  } catch {
    return createBaseIntent("unknown");
  }
}

function createIntentService(requestAnthropicMessage) {
  async function parseIntent(message) {
    const commandIntent = parseCommandIntent(message);
    if (commandIntent) return commandIntent;
    return parseIntentFromModel({ requestAnthropicMessage, message });
  }

  return {
    parseIntent,
  };
}

module.exports = {
  createIntentService,
  normalizeIntentPayload,
  normalizeIntentItems,
  parseCommandIntent,
  buildIntentPrompt,
};
