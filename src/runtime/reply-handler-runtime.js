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
const { loadConfig } = require("./config-provider");
const { createTelegramTransport, createAnthropicTransport } = require("./reply/transport");
const { createIntentService } = require("./reply/intent-service");
const { createCommandRouter } = require("./reply/command-router");
const { createOnboardingService } = require("./reply/onboarding-service");
const { createInfoHandlers } = require("./reply/info-handlers-runtime");
const { initStore, readUser, writeUser, allUsers, generateToken } = require("./store");
const { sendEmail: sendEmailViaMailer, sendWelcomeEmail } = require("./mailer");
const { appendEngagementEvent, buildDigestId } = require("./engagement-events");
const {
  queueDigestTrigger,
} = require("../../digest-runner");

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

const telegramTransport = createTelegramTransport(getBotToken);
const anthropicTransport = createAnthropicTransport(() => getConfigKeys().anthropic || "");
const intentService = createIntentService((payload) => anthropicTransport.requestMessage(payload));

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

function findUserByEmail(email) {
  const lookup = String(email || "").toLowerCase().trim();
  if (!lookup) return null;
  return allUsers().find((u) => String(u.email || "").toLowerCase().trim() === lookup) || null;
}

function send(chatId, text, extra = {}) {
  return telegramTransport.sendMessage(chatId, text, extra);
}

const onboardingService = createOnboardingService({
  state: () => REPLY_STATE,
  linkVerifyTtlMs: LINK_VERIFY_TTL_MS,
  sendMessage: send,
  sendVerificationEmail: sendLinkVerificationEmail,
  findUserByEmail,
  relinkUserToChat: relinkExistingUserToChat,
  formatDeliveryTime,
});

function parseIntent(message) {
  return intentService.parseIntent(message);
}

const {
  handleSettings,
  handleBookmarks,
  handleTopics,
  handleHelp,
  handleQuestion,
} = createInfoHandlers({
  readUser,
  getConfig,
  getBaseUrl,
  formatDeliveryTime,
  send,
  anthropicTransport,
  INDUSTRY_TOPICS,
  CAPABILITY_TOPICS,
});

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
    const outcome = await queueDigestTrigger({
      source: "telegram:on_demand",
      trigger: "telegram_command_digest",
      chatId,
      maxAdmissionWaitMs: 90 * 1000,
    });
    if (!outcome.ok) {
      if (outcome.busy) {
        await send(chatId, `⏱ Another digest run is in progress right now. Try again in a minute.`);
        return;
      }
      if (outcome.lockUnhealthy) {
        await send(chatId, `⚠️ Digest delivery is temporarily paused due to a runner lock issue. Please try again shortly.`);
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

function handleVerifyLink(chatId, codeRaw) {
  return onboardingService.handleVerifyLink(chatId, codeRaw);
}

async function handleStart(chatId, email) {
  // Always clear pending email capture state — /start resets it regardless
  onboardingService.clearAllPending(chatId);

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
    await onboardingService.startLinkVerification(chatId, match);
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
  onboardingService.setAwaitingEmail(chatId, true);
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

  onboardingService.setAwaitingEmail(chatId, false);

  // Check if already signed up via web — link instead of creating duplicate
  const existing = allUsers().find(u => (u.email || "").toLowerCase() === email);
  if (existing) {
    const oldChatId = existing.chatId;
    if (oldChatId !== chatId) {
      await onboardingService.startLinkVerification(chatId, existing);
      return;
    } else {
      const refreshed = {
        ...existing,
        status: "active",
        preferences: { ...(existing.preferences || {}), telegram_enabled: true },
        last_updated: new Date().toISOString(),
      };
      writeUser(chatId, refreshed);
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
  queueDigestTrigger({
    source: "telegram:signup_welcome",
    trigger: "telegram_signup_welcome",
    chatId,
    maxAdmissionWaitMs: 10 * 60 * 1000,
    env: { BASE_URL: getBaseUrl() },
  }).then((outcome) => {
    if (!outcome.ok && isReplyHandlerDebug()) {
      console.warn(`[reply-handler] welcome digest skipped for ${chatId}: ${outcome.code || "unknown"}`);
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

const routeCommand = createCommandRouter({
  start: (intent, chatId) => handleStart(chatId, intent.email),
  verify_link: (intent, chatId) => handleVerifyLink(chatId, intent.code),
  digest: (_intent, chatId) => handleDigest(chatId),
  save: (intent, chatId) => handleSave(chatId, intent.items),
  topic_more: (intent, chatId) => handleTopicMore(chatId, intent.topic),
  topic_less: (intent, chatId) => handleTopicLess(chatId, intent.topic),
  topic_add: (intent, chatId) => handleTopicAdd(chatId, intent.topic),
  settings: (_intent, chatId) => handleSettings(chatId),
  bookmarks: (_intent, chatId) => handleBookmarks(chatId),
  topics: (_intent, chatId) => handleTopics(chatId),
  help: (_intent, chatId) => handleHelp(chatId),
  question: (intent, chatId) => handleQuestion(chatId, intent.question),
  default: (_intent, chatId) => handleHelp(chatId),
});

async function handle(message, chatId) {
  ensureStoreReady();
  // Telegram-first onboarding: intercept email reply before intent parsing
  if (onboardingService.isAwaitingEmail(chatId) && !message.trim().startsWith("/")) {
    return handleEmailCapture(chatId, message);
  }

  const intent = await parseIntent(message);
  const action = String(intent?.action || "unknown");
  const messageLen = String(message || "").length;
  console.log(`[reply-handler] action=${action} message_len=${messageLen}`);
  if (isReplyHandlerDebug()) {
    console.log(`[reply-handler] debug intent=${JSON.stringify(intent)}`);
  }
  return routeCommand(intent, chatId);
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
