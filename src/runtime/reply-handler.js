#!/usr/bin/env node
/**
 * SignalBrief — reply-handler.js
 * Handles all inbound Telegram messages:
 * - /start onboarding
 * - /settings, /bookmarks, /topics, /help
 * - Natural language: "save 3", "more AI", "less pharma", "add GLP-1"
 * 
 * Usage: node src/runtime/reply-handler.js "<message>" "<chat_id>"
 * Or: called from bot-server.js polling dispatcher (default runtime)
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { loadConfig } = require("./config-provider");
const { initStore, readUser, writeUser, allUsers, generateToken } = require("./store");
const { sendEmail: sendEmailViaMailer, sendWelcomeEmail } = require("./mailer");
const { appendEngagementEvent, buildDigestId } = require("./engagement-events");
const { triggerDigest } = require("../../digest-runner");

const APP_ROOT = path.resolve(__dirname, "..", "..");

function getBaseUrl() {
  return process.env.BASE_URL || "https://getsignalbrief.com";
}

let storeReady = false;
function ensureStoreReady() {
  if (storeReady) return;
  initStore();
  storeReady = true;
}

function getConfig() {
  return loadConfig();
}

function getConfigKeys() {
  const config = getConfig();
  return config && typeof config.keys === "object" ? config.keys : {};
}

function getBotToken() {
  const keys = getConfigKeys();
  return keys.signalBriefBotToken || keys.telegramBotToken || "";
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function formatDeliveryTime(prefs) {
  const time = (prefs && prefs.delivery_time) || "07:00";
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  const min = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  return `${hour}${min} ${ampm} ET`;
}

function etDateKeyNow() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function etDateKeyFromIso(iso) {
  if (!iso) return etDateKeyNow();
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function appendEngagementEventChecked(payload, context) {
  const outcome = appendEngagementEvent(payload);
  if (!outcome.ok) {
    const code = String(outcome.error_code || outcome.code || "unknown");
    const detail = outcome.detail ? ` (${outcome.detail})` : "";
    console.warn(`[reply-handler] engagement event write failed [${context}] code=${code}${detail}`);
  }
  return outcome;
}

// ── Telegram-first onboarding state ──────────────────────────────────────────
function createReplyState() {
  return {
    awaitingEmail: new Map(),
    digestCooldown: new Map(),
    digestInflight: new Set(),
    pendingLinkVerifications: new Map(),
  };
}

let REPLY_STATE = createReplyState();

function resetReplyState() {
  REPLY_STATE = createReplyState();
  storeReady = false;
  return REPLY_STATE;
}

function isReplyHandlerDebug() {
  return process.env.REPLY_HANDLER_DEBUG === "1";
}

const INDUSTRY_TOPICS = [
  "HEALTHCARE", "FINANCIAL SERVICES", "PE×M&A", "ENERGY", "CONSUMER",
  "LIFE SCIENCES", "TECHNOLOGY", "INDUSTRIALS", "REAL ESTATE", "PUBLIC SECTOR",
];
const CAPABILITY_TOPICS = [
  "AI×TECH", "STRATEGY", "POLICY×REGULATORY", "SUSTAINABILITY",
  "DIGITAL", "M&A ADVISORY", "TALENT",
];
const STANDARD_TOPICS = [...INDUSTRY_TOPICS, ...CAPABILITY_TOPICS];
const LINK_VERIFY_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendLinkVerificationEmail(email, code) {
  const target = String(email || "").toLowerCase().trim();
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:0 auto;padding:32px 22px;color:#111;">
      <div style="font-size:22px;font-weight:700;margin-bottom:10px;">☀️ SignalBrief</div>
      <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:14px;">
        Someone requested to link a Telegram chat to your SignalBrief account.
      </div>
      <div style="font-size:14px;color:#6B7280;margin-bottom:8px;">Verification code (expires in 10 minutes):</div>
      <div style="font-size:32px;letter-spacing:0.08em;font-weight:700;color:#2563EB;margin-bottom:14px;">${code}</div>
      <div style="font-size:14px;color:#374151;line-height:1.6;">
        In Telegram, reply with: <strong>/verify ${code}</strong><br>
        If this wasn't you, ignore this email.
      </div>
    </div>`;
  const result = await sendEmailViaMailer(target, "Your SignalBrief verification code", html);
  if (!result.ok) throw new Error(`verification email failed via ${result.via || "mailer"}`);
}

async function startLinkVerification(chatId, user) {
  const email = String(user?.email || "").toLowerCase().trim();
  if (!email) {
    await send(chatId, "I couldn't start verification because this account has no email on file. Contact support.");
    return false;
  }

  const code = generateVerificationCode();
  REPLY_STATE.pendingLinkVerifications.set(String(chatId), {
    email,
    code,
    expiresAt: Date.now() + LINK_VERIFY_TTL_MS,
  });

  try {
    await sendLinkVerificationEmail(email, code);
  } catch (e) {
    REPLY_STATE.pendingLinkVerifications.delete(String(chatId));
    await send(chatId, `I couldn't send the verification code right now (${e.message}). Try again in a minute.`);
    return false;
  }

  await send(chatId,
    `🔐 I sent a 6-digit verification code to *${email}*.\n\n` +
    `Reply here with \`/verify 123456\` to link this Telegram chat to your existing account.\n\n` +
    `Code expires in 10 minutes.`
  );
  return true;
}

function relinkExistingUserToChat(existing, chatId) {
  const oldChatId = existing.chatId;
  const updated = {
    ...existing,
    chatId,
    status: "active",
    joined_at: existing.joined_at || new Date().toISOString(),
    preferences: { ...(existing.preferences || {}), telegram_enabled: true },
    last_updated: new Date().toISOString(),
  };
  writeUser(chatId, updated);
  if (oldChatId && String(oldChatId) !== String(chatId)) {
    const oldFile = path.join(APP_ROOT, "data", `user-${oldChatId}.json`);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
  return updated;
}

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
  const botToken = getBotToken();
  return httpsPost(
    "api.telegram.org", `/bot${botToken}/sendMessage`,
    { "Content-Type": "application/json" },
    { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true, ...extra }
  );
}

// ── Intent parsing via Claude ─────────────────────────────────────────────────

async function parseIntent(message) {
  // Fast-path for slash commands
  const m = message.trim().toLowerCase();
  if (m.startsWith("/start")) {
    const parts = message.trim().split(/\s+/);
    return { action: "start", email: parts[1] || null };
  }
  if (m === "/digest") return { action: "digest" };
  if (m === "/settings") return { action: "settings" };
  if (m === "/bookmarks") return { action: "bookmarks" };
  if (m === "/topics") return { action: "topics" };
  if (m === "/help") return { action: "help" };
  if (m.startsWith("/verify")) {
    const parts = message.trim().split(/\s+/);
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

  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": getConfigKeys().anthropic, "anthropic-version": "2023-06-01" },
    { model: "claude-haiku-4-5", max_tokens: 200, messages: [{ role: "user", content: prompt }] }
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
  const chatKey = String(chatId);
  const linkedUser = allUsers().find(u => String(u.chatId) === String(chatId));
  if (!linkedUser) {
    await send(chatId, `I couldn't find an account linked to this chat yet. Send /start and share your email to link your account.`);
    return;
  }
  if (linkedUser.status !== "active") {
    await send(chatId, `Your account is currently *${linkedUser.status}*. Send /start to re-link or reactivate before requesting a digest.`);
    return;
  }

  // Rate limit: 15-min cooldown between on-demand digest requests
  const now = Date.now();
  if (REPLY_STATE.digestInflight.has(chatKey)) {
    await send(chatId, `⏳ Your digest request is already in progress. I will send it as soon as it is ready.`);
    return;
  }
  const cooldownEnd = REPLY_STATE.digestCooldown.get(chatKey);
  if (cooldownEnd && cooldownEnd > now) {
    const minsLeft = Math.ceil((cooldownEnd - now) / 60000);
    await send(chatId, `⏱ Your last on-demand digest was recent. Try again in ${minsLeft} min${minsLeft !== 1 ? "s" : ""}.`);
    return;
  }

  REPLY_STATE.digestInflight.add(chatKey);
  try {
    await send(chatId, `⏳ Pulling your digest now — takes about 45 seconds...`);
    const run = await triggerDigest({
      source: "telegram:on_demand",
      trigger: "telegram_command_digest",
      chatId,
      queue: true,
      maxAdmissionWaitMs: 90 * 1000,
      serializeAdmission: false,
    });
    if (!run.ok) {
      if (run.code === "busy") {
        await send(chatId, `⏱ Another digest run is in progress right now. Try again in a minute.`);
        return;
      }
      await send(chatId, `❌ Failed to trigger digest. Please try /digest again in a moment.`);
      return;
    }
    REPLY_STATE.digestCooldown.set(chatKey, Date.now() + 15 * 60 * 1000);
    // Success confirmation is delivered by digest.js via Telegram.
  } catch (e) {
    await send(chatId, `❌ Failed to trigger digest: ${e.message}`);
  } finally {
    REPLY_STATE.digestInflight.delete(chatKey);
  }
}

async function handleVerifyLink(chatId, codeRaw) {
  const key = String(chatId);
  const pending = REPLY_STATE.pendingLinkVerifications.get(key);
  if (!pending) {
    await send(chatId, "No pending verification request. Start with `/start your@email.com`.");
    return;
  }

  if (Date.now() > pending.expiresAt) {
    REPLY_STATE.pendingLinkVerifications.delete(key);
    await send(chatId, "That verification code expired. Run `/start your@email.com` again to get a new code.");
    return;
  }

  const code = String(codeRaw || "").trim();
  if (!/^\d{6}$/.test(code)) {
    await send(chatId, "Please provide a 6-digit code, e.g. `/verify 123456`.");
    return;
  }
  if (code !== pending.code) {
    await send(chatId, "That code doesn't match. Check your email and try again.");
    return;
  }

  const existing = allUsers().find(u => (u.email || "").toLowerCase().trim() === pending.email);
  if (!existing) {
    REPLY_STATE.pendingLinkVerifications.delete(key);
    await send(chatId, "I couldn't find that account anymore. Try `/start your@email.com`.");
    return;
  }

  const updated = relinkExistingUserToChat(existing, chatId);
  REPLY_STATE.pendingLinkVerifications.delete(key);
  REPLY_STATE.awaitingEmail.delete(chatId);

  const firstName = (updated.name || "").split(" ")[0] || "there";
  await send(chatId,
    `✅ *Verified, ${firstName}!* Telegram is now linked to your SignalBrief account.\n\n` +
    `Digest arrives at *${formatDeliveryTime(updated.preferences)}*. Or get one now:\n\n` +
    `⚡ /digest · 💾 save [#] · 📊 more/less [topic] · ⚙️ /settings`
  );
}

async function handleStart(chatId, email) {
  // Always clear pending email capture state — /start resets it regardless
  REPLY_STATE.awaitingEmail.delete(chatId);
  REPLY_STATE.pendingLinkVerifications.delete(String(chatId));

  // ── /start email@example.com — link Telegram to existing web signup ──────────
  if (email) {
    const normalised = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
      await send(chatId, `❌ That doesn't look like a valid email. Try:\n\`/start you@example.com\``);
      return;
    }

    const users = allUsers();
    const match = users.find(u => (u.email || "").toLowerCase() === normalised);
    if (!match) {
      // Email unknown — create account inline (same as Telegram-first onboarding flow)
      await handleEmailCapture(chatId, normalised);
      return;
    }
    if (match.chatId === chatId) {
      const wasInactive = (match.status || "active") !== "active";
      const refreshed = {
        ...match,
        status: "active",
        joined_at: match.joined_at || new Date().toISOString(),
        preferences: { ...(match.preferences || {}), telegram_enabled: true },
        last_updated: new Date().toISOString(),
      };
      writeUser(chatId, refreshed);
      const lead = wasInactive ? "✅ Re-activated and linked." : "✅ Already linked.";
      await send(chatId, `${lead} Your digest arrives at *${formatDeliveryTime(refreshed.preferences)}* on weekdays.\n\n💾 save [#] · 📊 more/less [topic] · ⚙️ /settings`);
      return;
    }

    // Existing account is linked to a different chat — require email verification
    await startLinkVerification(chatId, match);
    return;
  }

  // ── Plain /start — existing or new user ─────────────────────────────────────
  const user = readUser(chatId);
  if (user.email) {
    const wasInactive = (user.status || "active") !== "active";
    const refreshed = {
      ...user,
      status: "active",
      joined_at: user.joined_at || new Date().toISOString(),
      preferences: { ...(user.preferences || {}), telegram_enabled: true },
      last_updated: new Date().toISOString(),
    };
    writeUser(chatId, refreshed);
    if (refreshed.digests_received > 0) {
      const intro = wasInactive ? "✅ You're active again." : "Welcome back!";
      await send(chatId, `${intro} You've received *${refreshed.digests_received}* digests so far.\n\nUse /settings to update your preferences or /bookmarks to see saved items.`);
      return;
    }
    await send(chatId,
      `☀️ *Welcome to SignalBrief*\n\n` +
      `Your daily signal across AI, strategy, and business — every morning at *${formatDeliveryTime(refreshed.preferences)}*.\n\n` +
      `📊 *more AI* · 📉 *less pharma* · ➕ *add topic* · ⚙️ /settings\n\n` +
      `First digest arrives at your scheduled time. See you then.`
    );
    return;
  }

  if (user.digests_received > 0) {
    await send(chatId, `Welcome back! You've received *${user.digests_received}* digests so far.\n\nUse /settings to update your preferences or /bookmarks to see saved items.`);
    return;
  }

  // Unknown Telegram user — prompt for email (Telegram-first onboarding)
  REPLY_STATE.awaitingEmail.set(chatId, true);
  await send(chatId,
    `☀️ *Welcome to SignalBrief*\n\n` +
    `Your daily signal across AI, strategy, and business.\n\n` +
    `What's your email address? I'll create your account and send your first digest at your chosen time.`
  );
}

// ── Telegram-first email capture ──────────────────────────────────────────────
async function handleEmailCapture(chatId, text) {
  // Extract email from prose ("my email is foo@bar.com" → "foo@bar.com")
  const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  const email = emailMatch ? emailMatch[0].toLowerCase().replace(/[.,;!?]+$/, "") : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await send(chatId, `That doesn't look like a valid email. Try again — e.g. *you@gmail.com*`);
    return;
  }

  REPLY_STATE.awaitingEmail.delete(chatId);

  // Check if already signed up via web — link instead of creating duplicate
  const existing = allUsers().find(u => (u.email || "").toLowerCase() === email);
  if (existing) {
    const oldChatId = existing.chatId;
    if (oldChatId !== chatId) {
      await startLinkVerification(chatId, existing);
      return;
    } else {
      existing.status = "active";
      existing.preferences = { ...(existing.preferences || {}), telegram_enabled: true };
      existing.last_updated = new Date().toISOString();
      writeUser(chatId, existing);
    }
    const firstName = (existing.name || "").split(" ")[0] || "there";
    await send(chatId,
      `✅ *Linked, ${firstName}!* Your existing account is now connected to Telegram.\n\n` +
      `Digest arrives at *${formatDeliveryTime(existing.preferences)}*. Or:\n⚡ /digest · 💾 save [#] · ⚙️ /settings`
    );
    return;
  }

  // New user — create account with smart defaults
  const userToken = generateToken();
  const user = {
    chatId,
    email,
    name: email.split("@")[0],
    telegram: null,
    token: userToken,
    topics: (getConfig().topics || []).slice(0, 5).map(t => t.tag), // first 5 topics as default
    status: "active",
    joined_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    digests_received: 0,
    bookmarks: [],
    topic_weights: {},
    custom_topics: [],
    digest_dates: [],
    last_digest_items: [],
    preferences: {
      depth: "headline_plus_why",
      delivery_time: "07:00",
      frequency: "daily_weekday",
      days_of_week: [1, 2, 3, 4, 5],
      items_per_digest: 5,
      timezone: "America/New_York",
      email_enabled: true,
      telegram_enabled: true,
    },
  };
  writeUser(chatId, user);

  // Send full welcome email (same template as web signups)
  sendWelcomeEmail(user).catch(e => console.error("[welcome email]", e));

  // Queue an immediate welcome digest so the user sees content right away.
  triggerDigest({
    source: "telegram:signup_welcome",
    trigger: "telegram_signup_welcome",
    chatId,
    queue: true,
    maxAdmissionWaitMs: 10 * 60 * 1000,
    env: { BASE_URL: getBaseUrl() },
  }).then((run) => {
    if (!run.ok && isReplyHandlerDebug()) {
      console.warn(`[reply-handler] welcome digest skipped for ${chatId}: ${run.code || "unknown"}`);
    }
  }).catch((err) => {
    console.error(`[reply-handler] welcome digest failed for ${chatId}: ${err.message}`);
  });

  const settingsUrl = `${getBaseUrl()}/settings?token=${userToken}`;
  await send(chatId,
    `✅ *You're in!*\n\n` +
    `Sending your first digest now — 7 signals across strategy, AI, and business.\n\n` +
    `🔗 [Manage preferences](${settingsUrl})\n\n` +
    `💾 save [#] · 📊 more/less [topic] · ⚙️ /settings`
  );
}

async function handleSave(chatId, items) {
  const user = readUser(chatId);
  const lastItems = user.last_digest_items || [];
  if (!Array.isArray(items) || items.length === 0) {
    await send(chatId, `Tell me which items to save — for example: *save 2* or *save 1, 3*.`);
    return;
  }
  if (lastItems.length === 0) {
    await send(chatId, `I don't have a recent digest to save from yet. After your next digest, reply *save 3*.`);
    return;
  }

  const saved = [];
  const already = [];
  const outOfBounds = [];
  const digestDateKey = etDateKeyFromIso(user.last_digest_at);
  const digestId = buildDigestId(digestDateKey, chatId);

  items.forEach(n => {
    // Bounds check: item numbers must be 1–10, and within the actual last digest size
    if (n < 1 || n > 10 || (lastItems.length > 0 && n > lastItems.length)) {
      outOfBounds.push(n);
      return;
    }

    const existing = user.bookmarks.find(b => {
      const today = etDateKeyNow();
      return b.date === today && b.item_num === n;
    });
    if (existing) { already.push(n); return; }

    const digestItem = lastItems[n - 1];
    const today = etDateKeyNow();
    user.bookmarks.push({
      date: today,
      item_num: n,
      headline: digestItem?.headline || `Item ${n}`,
      url: digestItem?.url || null,
      tag: digestItem?.tag || null,
    });
    appendEngagementEventChecked({
      event_type: "item_saved",
      event_key: `item_saved:${digestId}:${n}`,
      date_et: digestDateKey,
      user_chat_id: String(chatId),
      user_email: user.email || null,
      digest_id: digestId,
      channel: "telegram",
      source: "bot-command",
      item: {
        index: n,
        headline: digestItem?.headline || null,
        url: digestItem?.url || null,
        tag: digestItem?.tag || null,
      },
      metadata: {
        command: "save",
      },
    }, `item_saved:${digestId}:${n}`);
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
  if (outOfBounds.length > 0) {
    reply += `${reply ? "\n" : ""}❓ Item${outOfBounds.length > 1 ? "s" : ""} ${outOfBounds.map(n => `#${n}`).join(", ")} not found in your last digest.`;
  }
  if (saved.length === 1) {
    reply += `\n\nWant to save any others from today? Just reply with the numbers.`;
  }

  await send(chatId, reply || "Nothing to save.");
}

async function handleTopicMore(chatId, topic) {
  const user = readUser(chatId);
  const prev = Number(user.topic_weights[topic] || 0);
  const dateKey = etDateKeyNow();
  // Cap at +5 to prevent unbounded drift
  user.topic_weights[topic] = Math.min(5, (user.topic_weights[topic] || 0) + 1);
  writeUser(chatId, user);
  const next = Number(user.topic_weights[topic] || 0);
  appendEngagementEventChecked({
    event_type: "topic_weight_adjusted",
    event_key: `weight:${dateKey}:${chatId}:${topic}:manual:${next}:${Date.now()}`,
    date_et: dateKey,
    user_chat_id: String(chatId),
    user_email: user.email || null,
    digest_id: buildDigestId(dateKey, chatId),
    channel: "telegram",
    source: "bot-command",
    topic: {
      key: topic,
      delta: next - prev,
      mode: "manual",
      reason: "more command",
    },
  }, `topic_weight_adjusted:more:${chatId}:${topic}`);
  await send(chatId, `📊 Got it — more *${topic}* stories starting tomorrow.`);
}

async function handleTopicLess(chatId, topic) {
  const user = readUser(chatId);
  const prev = Number(user.topic_weights[topic] || 0);
  const dateKey = etDateKeyNow();
  // Floor at -5 to prevent unbounded drift
  user.topic_weights[topic] = Math.max(-5, (user.topic_weights[topic] || 0) - 1);
  writeUser(chatId, user);
  const next = Number(user.topic_weights[topic] || 0);
  appendEngagementEventChecked({
    event_type: "topic_weight_adjusted",
    event_key: `weight:${dateKey}:${chatId}:${topic}:manual:${next}:${Date.now()}`,
    date_et: dateKey,
    user_chat_id: String(chatId),
    user_email: user.email || null,
    digest_id: buildDigestId(dateKey, chatId),
    channel: "telegram",
    source: "bot-command",
    topic: {
      key: topic,
      delta: next - prev,
      mode: "manual",
      reason: "less command",
    },
  }, `topic_weight_adjusted:less:${chatId}:${topic}`);
  await send(chatId, `📉 Got it — fewer *${topic}* stories starting tomorrow.`);
}

function getTopicFromLastDigestItem(user, itemIndex) {
  const idx = Number(itemIndex || 0);
  if (!Number.isFinite(idx) || idx < 1) return null;
  const items = Array.isArray(user?.last_digest_items) ? user.last_digest_items : [];
  const item = items[idx - 1];
  const tag = String(item?.tag || "").trim();
  return tag || null;
}

async function handleDigestFeedback(chatId, reactionKey) {
  const FEEDBACK = {
    great: { label: "great", emoji: "🔥", score: 2, ack: "Love it — keep those coming." },
    fine:  { label: "fine",  emoji: "👍", score: 1, ack: "Noted — we will keep tuning." },
    meh:   { label: "meh",   emoji: "👎", score: 0, ack: "Thanks — we will sharpen tomorrow's brief." },
  };
  const chosen = FEEDBACK[String(reactionKey || "").toLowerCase()];
  if (!chosen) {
    await send(chatId, "I couldn't record that reaction. Try one of the digest feedback buttons again.");
    return { ok: false, notice: "Invalid feedback" };
  }

  const user = readUser(chatId);
  if (!user.last_digest_at) {
    await send(chatId, "I don't have a recent digest to score yet.");
    return { ok: false, notice: "No recent digest" };
  }

  const dateKey = etDateKeyFromIso(user.last_digest_at);
  const digestId = buildDigestId(dateKey, chatId);
  if (!Array.isArray(user.digest_feedback)) user.digest_feedback = [];

  const existing = user.digest_feedback.find((row) => String(row?.digest_id || "") === digestId);
  if (existing) {
    await send(chatId, `Feedback already recorded for this digest (${existing.emoji || existing.label || "saved"}).`);
    return { ok: false, notice: "Already recorded" };
  }

  const nowIso = new Date().toISOString();
  const entry = {
    digest_id: digestId,
    date_et: dateKey,
    ts_utc: nowIso,
    label: chosen.label,
    emoji: chosen.emoji,
    score: chosen.score,
    channel: "telegram",
  };
  user.digest_feedback.push(entry);
  if (user.digest_feedback.length > 120) {
    user.digest_feedback.splice(0, user.digest_feedback.length - 120);
  }
  writeUser(chatId, user);

  appendEngagementEventChecked({
    event_type: "digest_feedback_submitted",
    event_key: `feedback:${digestId}`,
    date_et: dateKey,
    user_chat_id: String(chatId),
    user_email: user.email || null,
    digest_id: digestId,
    channel: "telegram",
    source: "inline-keyboard",
    feedback: {
      label: chosen.label,
      score: chosen.score,
      emoji: chosen.emoji,
    },
  }, `digest_feedback_submitted:${digestId}`);

  await send(chatId, `${chosen.emoji} Feedback saved. ${chosen.ack}`);
  return { ok: true, notice: "Feedback saved" };
}

async function handleTopicAdd(chatId, topic) {
  if (!topic) return;
  const user = readUser(chatId);

  // Normalize: if it matches a standard topic (case-insensitive), use the canonical tag.
  // Otherwise normalize to custom_<slug> — matches how web/settings.js stores custom topics.
  const matchStandard = STANDARD_TOPICS.find(t => t.toLowerCase() === topic.toLowerCase());
  const topicKey = matchStandard || ('custom_' + topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
  const displayLabel = matchStandard || topic.replace(/[_]/g, ' ');

  // Add to custom_topics (for display in /topics and settings) — only for non-standard topics
  if (!matchStandard) {
    if (!user.custom_topics.includes(topicKey)) user.custom_topics.push(topicKey);
  }
  // Also add to topics[] so digest.js includes it in relevance filtering
  if (!user.topics) user.topics = [];
  if (!user.topics.includes(topicKey)) user.topics.push(topicKey);
  writeUser(chatId, user);
  await send(chatId, `➕ Added *${displayLabel}* to your topics. You'll see it in tomorrow's digest.`);
}

async function handleSettings(chatId) {
  const user = readUser(chatId);
  const topics = Array.isArray(user.topics) ? user.topics : [];
  const industries = topics.filter(t => INDUSTRY_TOPICS.includes(t));
  const capabilities = topics.filter(t => CAPABILITY_TOPICS.includes(t));
  const weights = Object.entries(user.topic_weights || {});
  const adjustments = weights.length
    ? weights.map(([k, v]) => `${v > 0 ? "↑".repeat(Math.min(v,3)) : "↓".repeat(Math.min(-v,3))} ${k}`).join(" · ")
    : "none";
  const customTopics = user.custom_topics?.length
    ? user.custom_topics.map(t => t.replace(/^custom_/, "").replace(/_/g, " ")).join(", ")
    : "none";

  // Include tokenized settings link if user has a token
  const settingsLine = user.token
    ? `\n🔗 [Manage preferences](${getBaseUrl()}/settings?token=${user.token})`
    : "";

  await send(chatId,
    `⚙️ *Your SignalBrief Settings*\n\n` +
    `📬 Digests received: *${user.digests_received}*\n` +
    `📅 Delivery: *${formatDeliveryTime(user.preferences)}*\n` +
    `💾 Bookmarks saved: *${user.bookmarks?.length || 0}*\n\n` +
    `🏭 Industries: ${industries.length ? industries.join(", ") : "none"}\n` +
    `🧰 Capabilities: ${capabilities.length ? capabilities.join(", ") : "none"}\n` +
    `📊 Topic adjustments: ${adjustments}\n` +
    `➕ Custom topics: ${customTopics}` +
    settingsLine + `\n\n` +
    `_To tune:_ more/less [topic] · add [topic] · /bookmarks`
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
  const defaultTopics = (getConfig().topics || []).map(t => t.tag);
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
  const user = readUser(chatId);
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
    `• /verify 123456 — confirm Telegram account linking\n` +
    `• /bookmarks — view saved items\n` +
    `• /topics — view tracked topics\n` +
    `• /settings — view all preferences\n\n` +
    `Digest arrives at *${formatDeliveryTime(user.preferences)}* on your scheduled days.\n` +
    `Questions? Just ask.`
  );
}

async function handleQuestion(chatId, question) {
  // Lightweight fallback — answer via Claude with healthcare context
  const res = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "Content-Type": "application/json", "x-api-key": getConfigKeys().anthropic, "anthropic-version": "2023-06-01" },
    {
      model: "claude-haiku-4-5",
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

function parseInlineCallbackData(data) {
  const raw = String(data || "").trim();
  const parts = raw.split(":");
  if (parts.length < 3) return null;
  if (parts[0] !== "sb") return null;

  const action = parts[1];
  if (action === "save" || action === "more" || action === "less") {
    const item = Number(parts[2]);
    if (!Number.isFinite(item) || item < 1 || item > 10) return null;
    return { action, item };
  }
  if (action === "fb") {
    return { action, reaction: parts[2] || "" };
  }
  return null;
}

async function handleCallback(data, chatId) {
  ensureStoreReady();
  const parsed = parseInlineCallbackData(data);
  if (!parsed) return { ok: false, notice: "Unsupported action" };

  if (parsed.action === "save") {
    await handleSave(chatId, [parsed.item]);
    return { ok: true, notice: `Saved #${parsed.item}` };
  }

  if (parsed.action === "more" || parsed.action === "less") {
    const user = readUser(chatId);
    const topic = getTopicFromLastDigestItem(user, parsed.item);
    if (!topic) {
      await send(chatId, `I couldn't resolve item #${parsed.item} from your last digest.`);
      return { ok: false, notice: "Item unavailable" };
    }
    if (parsed.action === "more") {
      await handleTopicMore(chatId, topic);
      return { ok: true, notice: `More ${topic}` };
    }
    await handleTopicLess(chatId, topic);
    return { ok: true, notice: `Less ${topic}` };
  }

  if (parsed.action === "fb") {
    const result = await handleDigestFeedback(chatId, parsed.reaction);
    return result || { ok: false, notice: "Feedback failed" };
  }

  return { ok: false, notice: "Unsupported action" };
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

async function handle(message, chatId) {
  ensureStoreReady();
  // Telegram-first onboarding: intercept email reply before intent parsing
  if (REPLY_STATE.awaitingEmail.has(chatId) && !message.trim().startsWith("/")) {
    return handleEmailCapture(chatId, message);
  }

  const intent = await parseIntent(message);
  const action = String(intent?.action || "unknown");
  const messageLen = String(message || "").length;
  console.log(`[reply-handler] action=${action} message_len=${messageLen}`);
  if (isReplyHandlerDebug()) {
    console.log(`[reply-handler] debug intent=${JSON.stringify(intent)}`);
  }

  switch (intent.action) {
    case "start":     return handleStart(chatId, intent.email);
    case "verify_link": return handleVerifyLink(chatId, intent.code);
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
  ensureStoreReady();
  const message = process.argv[2];
  const chatId = process.argv[3] || getConfig().user.telegramChatId;
  if (!message) { console.error("Usage: node src/runtime/reply-handler.js '<message>' [chat_id]"); process.exit(1); }
  handle(message, chatId).catch(e => { console.error(e); process.exit(1); });
}

module.exports = {
  createReplyState,
  resetReplyState,
  handle,
  handleCallback,
};
