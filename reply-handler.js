#!/usr/bin/env node
/**
 * SignalBrief — reply-handler.js
 * Parses user replies to the digest using Claude for fuzzy intent detection.
 * Called with: node reply-handler.js "<user message>" "<chat_id>"
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const STATE_FILE = path.join(__dirname, "user-state.json");

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { digests_received: 0, bookmarks: [], topic_weights: {} };
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

function httpsPost(hostname, path_, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path: path_, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
      (res) => { let out = ""; res.on("data", c => out += c); res.on("end", () => { try { resolve(JSON.parse(out)); } catch { resolve(out); } }); }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function parseIntent(userMessage) {
  const prompt = `The user replied to their SignalBrief news digest with: "${userMessage}"

Parse the intent. Return ONLY a JSON object:
{
  "action": "save" | "topic_more" | "topic_less" | "topic_add" | "settings" | "question" | "unknown",
  "items": [1, 3, 6],          // item numbers if action=save (empty array if not applicable)
  "topic": "AI",               // topic string if action=topic_* (null if not applicable)
  "question": "string"         // if action=question, the cleaned question text
}

Examples:
- "save 3" → {"action":"save","items":[3],"topic":null}
- "Save #3" → {"action":"save","items":[3],"topic":null}
- "bookmark 1, 4, 6" → {"action":"save","items":[1,4,6],"topic":null}
- "save 1 4 6" → {"action":"save","items":[1,4,6],"topic":null}
- "save item 3" → {"action":"save","items":[3],"topic":null}
- "more AI" → {"action":"topic_more","items":[],"topic":"AI"}
- "more AI stories" → {"action":"topic_more","items":[],"topic":"AI"}
- "I want more AI" → {"action":"topic_more","items":[],"topic":"AI"}
- "less pharma" → {"action":"topic_less","items":[],"topic":"PHARMA"}
- "fewer M&A stories" → {"action":"topic_less","items":[],"topic":"M&A"}
- "add GLP-1" → {"action":"topic_add","items":[],"topic":"GLP-1"}
- "track biosimilars" → {"action":"topic_add","items":[],"topic":"biosimilars"}
- "settings" → {"action":"settings","items":[],"topic":null}
- "what does 340B mean?" → {"action":"question","items":[],"topic":null,"question":"what does 340B mean?"}

Return ONLY the JSON object. No explanation.`;

  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-sonnet-4-6", max_tokens: 200, messages: [{ role: "user", content: prompt }] }
  );

  try {
    let text = res?.content?.[0]?.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(text);
  } catch { return { action: "unknown" }; }
}

async function sendReply(chatId, text) {
  const token = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;
  await httpsPost(
    "api.telegram.org", `/bot${token}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: chatId, text, parse_mode: "Markdown" }
  );
}

async function handleIntent(intent, chatId) {
  const state = loadState();

  if (intent.action === "save" && intent.items.length > 0) {
    if (!state.bookmarks) state.bookmarks = [];
    const today = new Date().toISOString().slice(0, 10);
    intent.items.forEach(n => {
      if (!state.bookmarks.find(b => b.date === today && b.item === n)) {
        state.bookmarks.push({ date: today, item: n });
      }
    });
    saveState(state);
    const itemList = intent.items.map(n => `#${n}`).join(", ");
    const plural = intent.items.length > 1 ? "items" : "item";
    let reply = `✅ Saved ${plural} ${itemList} to your bookmarks.`;
    if (intent.items.length === 1) reply += `\n\nWant to save any others from today? Just reply with the numbers.`;
    await sendReply(chatId, reply);

  } else if (intent.action === "topic_more") {
    if (!state.topic_weights) state.topic_weights = {};
    state.topic_weights[intent.topic] = (state.topic_weights[intent.topic] || 0) + 1;
    saveState(state);
    await sendReply(chatId, `📊 Got it — more *${intent.topic}* stories starting tomorrow.`);

  } else if (intent.action === "topic_less") {
    if (!state.topic_weights) state.topic_weights = {};
    state.topic_weights[intent.topic] = (state.topic_weights[intent.topic] || 0) - 1;
    saveState(state);
    await sendReply(chatId, `📉 Got it — fewer *${intent.topic}* stories starting tomorrow.`);

  } else if (intent.action === "topic_add") {
    if (!state.custom_topics) state.custom_topics = [];
    if (!state.custom_topics.includes(intent.topic)) state.custom_topics.push(intent.topic);
    saveState(state);
    await sendReply(chatId, `➕ Added *${intent.topic}* to your topics. You'll see it in tomorrow's digest.`);

  } else if (intent.action === "settings") {
    const topics = CONFIG.topics.map(t => t.tag).join(", ");
    const bookmarkCount = (state.bookmarks || []).length;
    const adjustments = Object.entries(state.topic_weights || {})
      .map(([k, v]) => `${v > 0 ? "↑" : "↓"} ${k}`)
      .join(", ") || "none";
    await sendReply(chatId,
      `⚙️ *Your SignalBrief Settings*\n\n` +
      `📋 Topics: ${topics}\n` +
      `🔧 Adjustments: ${adjustments}\n` +
      `💾 Bookmarks saved: ${bookmarkCount}\n` +
      `📬 Digests received: ${state.digests_received || 0}\n\n` +
      `Reply with *more/less [topic]*, *add [topic]*, or anything else to tune.`
    );

  } else {
    await sendReply(chatId,
      `Not sure what you meant — here's what I can do:\n\n` +
      `💾 *save 3* → bookmark item 3\n` +
      `📊 *more AI* → see more AI stories\n` +
      `📉 *less pharma* → fewer pharma stories\n` +
      `➕ *add GLP-1* → track a new topic\n` +
      `⚙️ *settings* → view your preferences`
    );
  }
}

async function main() {
  const userMessage = process.argv[2];
  const chatId = process.argv[3] || CONFIG.user.telegramChatId;

  if (!userMessage) {
    console.error("Usage: node reply-handler.js '<message>' '<chat_id>'");
    process.exit(1);
  }

  console.log(`Parsing: "${userMessage}"`);
  const intent = await parseIntent(userMessage);
  console.log("Intent:", JSON.stringify(intent));
  await handleIntent(intent, chatId);
}

main().catch(e => { console.error(e); process.exit(1); });
