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
    digest_feedback: [],        // [{ digest_id, date_et, ts_utc, label, score, channel }]
    quality_history: [],        // [{ digest_id, date_et, score, band, components }]
    last_quality_score: null,   // latest entry from quality_history for quick reads
    auto_learning: {
      enabled: true,
      last_processed_ts: null,
      last_checked_at: null,
      last_applied_at: null,
      total_auto_adjustments: 0,
    },
    preferences: {
      delivery_time: "07:00",
      timezone: "America/New_York",
      email_enabled: true,
      telegram_enabled: true,
    },
  };
}

// ── In-memory token→chatId index (B-2) ───────────────────────────────────────
// Avoids O(n) disk scan on every authenticated request. Rebuilt at startup,
// kept current by writeUser(). Each process maintains its own index.

const tokenIndex = new Map(); // token → chatId (string)

function rebuildTokenIndex() {
  tokenIndex.clear();
  if (!fs.existsSync(DATA_DIR)) return;
  fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith("user-") && f.endsWith(".json"))
    .forEach(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
        if (raw.token) tokenIndex.set(raw.token, raw.chatId || f.replace("user-", "").replace(".json", ""));
      } catch { /* skip corrupt files */ }
    });
}

rebuildTokenIndex();

// ── Core store functions ──────────────────────────────────────────────────────

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
    _writeUserFile(f, user);
    tokenIndex.set(user.token, String(chatId));
    console.log(`[store] Auto-generated token for ${chatId}`);
  } else {
    // Keep index hydrated even when records are loaded ad-hoc from disk.
    tokenIndex.set(raw.token, String(chatId));
  }
  return user;
}

// Atomic write: write to .tmp then rename — prevents partial-write corruption (B-7).
// fs.renameSync is atomic on POSIX (macOS/Linux) when src and dst are on the same fs.
function _writeUserFile(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function writeUser(chatId, data) {
  _writeUserFile(userFile(chatId), data);
  // Keep token index current
  if (data.token) tokenIndex.set(data.token, String(chatId));
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

// O(1) token lookup via in-memory index (B-2).
function findUserByToken(token) {
  if (!token) return null;
  const hit = tokenIndex.get(token);
  if (hit) return readUser(hit);

  // Cross-process safety: another process may have written users after startup.
  rebuildTokenIndex();
  const refreshed = tokenIndex.get(token);
  if (!refreshed) return null;
  return readUser(refreshed);
}

module.exports = { readUser, writeUser, allUsers, defaultUser, generateToken, findUserByToken };
