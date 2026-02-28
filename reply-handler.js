#!/usr/bin/env node
/**
 * SignalBrief — reply-handler.js
 * Handles all inbound Telegram messages:
 * - /start onboarding
 * - /settings, /bookmarks, /topics, /help
 * - Natural language: "save 3", "more AI", "less pharma", "add GLP-1"
 * 
 * Usage: node reply-handler.js "<message>" "<chat_id>"
 * Or: called from bot-server.js webhook
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { readUser, writeUser } = require("./store");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const BOT_TOKEN = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;

// ── HTTP ─────────────────────────────────────────────────────────────────────

function httpsPost(hostname, path_, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path: path_, method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let out = "";
        res.on("data", c => out += c);
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
          catch { resolve({ status: res.statusCode, body: out }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function send(chatId, text, extra = {}) {
  return httpsPost(
    "api.telegram.org", `/bot${BOT_TOKEN}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true, ...extra }
  );
}

// ── Intent parsing via Claude ─────────────────────────────────────────────────

async function parseIntent(message) {
  // Fast-path for slash commands
  const m = message.trim().toLowerCase();
  if (m === "/start") return { action: "start" };
  if (m === "/digest") return { action: "digest" };
  if (m === "/settings") return { action: "settings" };
  if (m === "/bookmarks") return { action: "bookmarks" };
  if (m === "/topics") return { action: "topics" };
  if (m === "/help") return { action: "help" };

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

  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-sonnet-4-6", max_tokens: 200, messages: [{ role: "user", content: prompt }] }
  );

  try {
    let text = res.body?.content?.[0]?.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(text);
  } catch { return { action: "unknown" }; }
}

// ── Command menu ──────────────────────────────────────────────────────────────

function commandMenu(user) {
  if (user.digests_received < 5) {
    return [
      "───",
      "📧 Deeper takes in your email",
      "",
      "💾 save 3 → bookmarks item 3",
      "💾 save 1,4,6 → bookmarks multiple",
      "📊 more AI → see more AI stories",
      "📉 less M&A → see fewer M&A stories",
      "➕ add GLP-1 → track a new topic",
      "⚙️ settings → view/change all preferences",
    ].join("\n");
  }
  return "───\n📧 Deeper takes in your email\n💾 save [#] · 📊 more/less [topic] · ⚙️ settings";
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleDigest(chatId) {
  await send(chatId, `⏳ Pulling your digest now — takes about 45 seconds...`);
  try {
    // Spawn digest.js as a child process, scoped to this user
    const { spawn } = require("child_process");
    const proc = spawn("node", [
      require("path").join(__dirname, "digest.js"),
      "--chatId", chatId
    ], { cwd: __dirname });

    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", async (code) => {
      if (code !== 0) {
        console.error("digest error:", stderr);
        await send(chatId, `❌ Something went wrong pulling the digest. Check /tmp/signalbrief.log.`);
      }
      // Success message already delivered by digest.js via Telegram
    });
  } catch (e) {
    await send(chatId, `❌ Failed to trigger digest: ${e.message}`);
  }
}

async function handleStart(chatId) {
  const user = readUser(chatId);
  if (user.digests_received > 0) {
    await send(chatId, `Welcome back! You've received *${user.digests_received}* digests so far.\n\nUse /settings to update your preferences or /bookmarks to see saved items.`);
    return;
  }

  writeUser(chatId, { ...user, status: "active", joined_at: new Date().toISOString() });

  await send(chatId,
    `☀️ *Welcome to SignalBrief*\n\n` +
    `Your daily signal across AI, strategy, and business — delivered every morning at 7 AM ET.\n\n` +
    `*What you'll get:*\n` +
    `• 7 curated stories from the last 24 hours\n` +
    `• Sharp "why it matters" analysis for each\n` +
    `• Direct links to full articles\n` +
    `• A deeper email version in your inbox\n\n` +
    `*Industries:* HEALTHCARE · FINANCIAL SERVICES · PE×M&A · ENERGY · CONSUMER · LIFE SCIENCES · TECHNOLOGY · INDUSTRIALS · REAL ESTATE · PUBLIC SECTOR\n` +
    `*Capabilities:* AI×TECH · STRATEGY · POLICY×REGULATORY · SUSTAINABILITY · DIGITAL · M&A ADVISORY · TALENT\n\n` +
    `You can tune these anytime — just reply with:\n` +
    `📊 *more AI* · 📉 *less pharma* · ➕ *add GLP-1*\n\n` +
    `First digest arrives tomorrow at 7 AM ET. See you then.`
  );
}

async function handleSave(chatId, items) {
  const user = readUser(chatId);
  const lastItems = user.last_digest_items || [];

  const saved = [];
  const already = [];

  items.forEach(n => {
    const existing = user.bookmarks.find(b => {
      const today = new Date().toISOString().slice(0, 10);
      return b.date === today && b.item_num === n;
    });
    if (existing) { already.push(n); return; }

    const digestItem = lastItems[n - 1];
    const today = new Date().toISOString().slice(0, 10);
    user.bookmarks.push({
      date: today,
      item_num: n,
      headline: digestItem?.headline || `Item ${n}`,
      url: digestItem?.url || null,
      tag: digestItem?.tag || null,
    });
    saved.push(n);
  });

  writeUser(chatId, user);

  const savedList = saved.map(n => `#${n}`).join(", ");
  const alreadyList = already.map(n => `#${n}`).join(", ");

  let reply = "";
  if (saved.length > 0) {
    reply += `✅ Saved ${saved.length === 1 ? "item" : "items"} ${savedList} to your bookmarks.`;
  }
  if (already.length > 0) {
    reply += `${reply ? "\n" : ""}ℹ️ ${alreadyList} already bookmarked.`;
  }
  if (saved.length === 1) {
    reply += `\n\nWant to save any others from today? Just reply with the numbers.`;
  }

  await send(chatId, reply || "Nothing to save.");
}

async function handleTopicMore(chatId, topic) {
  const user = readUser(chatId);
  user.topic_weights[topic] = (user.topic_weights[topic] || 0) + 1;
  writeUser(chatId, user);
  await send(chatId, `📊 Got it — more *${topic}* stories starting tomorrow.`);
}

async function handleTopicLess(chatId, topic) {
  const user = readUser(chatId);
  user.topic_weights[topic] = (user.topic_weights[topic] || 0) - 1;
  writeUser(chatId, user);
  await send(chatId, `📉 Got it — fewer *${topic}* stories starting tomorrow.`);
}

async function handleTopicAdd(chatId, topic) {
  const user = readUser(chatId);
  if (!user.custom_topics.includes(topic)) user.custom_topics.push(topic);
  writeUser(chatId, user);
  await send(chatId, `➕ Added *${topic}* to your topics. You'll see it in tomorrow's digest.`);
}

async function handleSettings(chatId) {
  const user = readUser(chatId);
  const weights = Object.entries(user.topic_weights || {});
  const adjustments = weights.length
    ? weights.map(([k, v]) => `${v > 0 ? "↑".repeat(Math.min(v,3)) : "↓".repeat(Math.min(-v,3))} ${k}`).join(" · ")
    : "none";
  const customTopics = user.custom_topics?.length
    ? user.custom_topics.join(", ")
    : "none";

  await send(chatId,
    `⚙️ *Your SignalBrief Settings*\n\n` +
    `📬 Digests received: *${user.digests_received}*\n` +
    `📅 Delivery: *7:00 AM ET, Mon–Sat*\n` +
    `💾 Bookmarks saved: *${user.bookmarks?.length || 0}*\n\n` +
    `📊 Topic adjustments: ${adjustments}\n` +
    `➕ Custom topics: ${customTopics}\n\n` +
    `_To change anything:_\n` +
    `more/less [topic] · add [topic] · /bookmarks`
  );
}

async function handleBookmarks(chatId) {
  const user = readUser(chatId);
  const bm = user.bookmarks || [];
  if (bm.length === 0) {
    await send(chatId, `💾 No bookmarks yet.\n\nAfter your next digest, reply *save 3* to bookmark item 3.`);
    return;
  }

  // Group by date, show last 10
  const recent = bm.slice(-10).reverse();
  const lines = [`💾 *Your Bookmarks* (last ${recent.length})`, ""];
  recent.forEach(b => {
    const tag = b.tag ? `[${b.tag}] ` : "";
    const link = b.url ? `\n→ ${b.url}` : "";
    lines.push(`*${b.date} · #${b.item_num}*\n${tag}${b.headline}${link}`);
    lines.push("");
  });

  await send(chatId, lines.join("\n"));
}

async function handleTopics(chatId) {
  const user = readUser(chatId);
  const defaultTopics = CONFIG.topics.map(t => t.tag);
  const custom = user.custom_topics || [];
  const weights = user.topic_weights || {};

  const topicLines = defaultTopics.map(t => {
    const w = weights[t] || 0;
    const adj = w > 0 ? ` ↑` : w < 0 ? ` ↓` : "";
    return `• ${t}${adj}`;
  });
  if (custom.length) custom.forEach(t => topicLines.push(`• ${t} _(custom)_`));

  await send(chatId,
    `📋 *Your Tracked Topics*\n\n` +
    topicLines.join("\n") + "\n\n" +
    `_To tune:_ more [topic] · less [topic] · add [keyword]`
  );
}

async function handleHelp(chatId) {
  await send(chatId,
    `☀️ *SignalBrief Help*\n\n` +
    `*Saving items:*\n` +
    `• \`save 3\` — bookmark item 3\n` +
    `• \`save 1, 4, 6\` — bookmark multiple\n\n` +
    `*Tuning topics:*\n` +
    `• \`more AI\` — see more AI stories\n` +
    `• \`less pharma\` — fewer pharma stories\n` +
    `• \`add GLP-1\` — track a new topic\n\n` +
    `*Other commands:*\n` +
    `• /bookmarks — view saved items\n` +
    `• /topics — view tracked topics\n` +
    `• /settings — view all preferences\n\n` +
    `Digest arrives Mon–Sat at 7 AM ET.\n` +
    `Questions? Just ask.`
  );
}

async function handleQuestion(chatId, question) {
  // Lightweight fallback — answer via Claude with healthcare context
  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": CONFIG.keys.anthropic, "anthropic-version": "2023-06-01" },
    {
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You are SignalBrief, a business and strategy news assistant covering AI, healthcare, financial services, PE/M&A, energy, consumer, policy, and consulting. Answer this question concisely (2-3 sentences max, plain text, no markdown headers): ${question}`
      }]
    }
  );
  const answer = res.body?.content?.[0]?.text || "I'm not sure — try asking again.";
  await send(chatId, answer);
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

async function handle(message, chatId) {
  const intent = await parseIntent(message);
  console.log(`[${chatId}] "${message}" → ${JSON.stringify(intent)}`);

  switch (intent.action) {
    case "start":     return handleStart(chatId);
    case "digest":    return handleDigest(chatId);
    case "save":      return handleSave(chatId, intent.items);
    case "topic_more": return handleTopicMore(chatId, intent.topic);
    case "topic_less": return handleTopicLess(chatId, intent.topic);
    case "topic_add": return handleTopicAdd(chatId, intent.topic);
    case "settings":  return handleSettings(chatId);
    case "bookmarks": return handleBookmarks(chatId);
    case "topics":    return handleTopics(chatId);
    case "help":      return handleHelp(chatId);
    case "question":  return handleQuestion(chatId, intent.question);
    default:          return handleHelp(chatId);
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const message = process.argv[2];
  const chatId = process.argv[3] || CONFIG.user.telegramChatId;
  if (!message) { console.error("Usage: node reply-handler.js '<message>' [chat_id]"); process.exit(1); }
  handle(message, chatId).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { handle };
