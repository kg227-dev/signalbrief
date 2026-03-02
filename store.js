/**
 * SignalBrief — store.js
 * Simple JSON-based data store. One file per user keyed by chatId.
 * Upgrade path: swap readUser/writeUser for SQLite when multi-user hits ~20+.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function userFile(chatId) {
  return path.join(DATA_DIR, `user-${chatId}.json`);
}

function defaultUser(chatId) {
  return {
    chatId: String(chatId),
    email: null,
    status: "active",          // active | paused | unsubscribed
    token: null,               // 64-char hex; generated on signup or auto-generated on first readUser
    digests_received: 0,
    joined_at: new Date().toISOString(),
    last_digest_at: null,
    topic_weights: {},          // { "AI": 1, "PHARMA": -1 }
    custom_topics: [],          // ["GLP-1", "biosimilars"]
    digest_dates: [],           // ["2026-03-01", ...] — dates user received a digest (for archive scoping)
    bookmarks: [],              // [{ date, item_num, headline, url, tag }]
    last_digest_items: [],      // snapshot of last digest for save-by-number
    preferences: {
      delivery_time: "07:00",
      timezone: "America/New_York",
      email_enabled: true,
      telegram_enabled: true,
    },
  };
}

function readUser(chatId) {
  const f = userFile(chatId);
  if (!fs.existsSync(f)) return defaultUser(chatId);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch { return defaultUser(chatId); }
  const defaults = defaultUser(chatId);
  const user = { ...defaults, ...raw, preferences: { ...defaults.preferences, ...(raw.preferences || {}) } };
  // Auto-generate and persist token for existing users who don't have one
  if (!raw.token) {
    user.token = generateToken();
    fs.writeFileSync(f, JSON.stringify(user, null, 2));
    console.log(`[store] Auto-generated token for ${chatId}`);
  }
  return user;
}

function writeUser(chatId, data) {
  fs.writeFileSync(userFile(chatId), JSON.stringify(data, null, 2));
}

function allUsers() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith("user-") && f.endsWith(".json"))
    .map(f => {
      // Use readUser() so each user gets full default-merging and auto-token generation
      const chatId = f.replace("user-", "").replace(".json", "");
      try { return readUser(chatId); }
      catch { return null; }
    })
    .filter(Boolean);
}

module.exports = { readUser, writeUser, allUsers, defaultUser, generateToken };
