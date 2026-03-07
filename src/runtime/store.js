/**
 * SignalBrief — store.js
 * Simple JSON-based data store. One file per user keyed by chatId.
 * Upgrade path: swap readUser/writeUser for SQLite when multi-user hits ~20+.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_ROOT = path.resolve(__dirname, "..", "..");

function defaultDataDir() {
  return path.resolve(process.env.SIGNALBRIEF_DATA_DIR || path.join(APP_ROOT, "data"));
}

function createStoreIndex() {
  return new Map();
}

function createStoreState(opts = {}) {
  return {
    dataDir: opts.dataDir ? path.resolve(String(opts.dataDir)) : defaultDataDir(),
    initialized: false,
    tokenIndex: createStoreIndex(),
  };
}

let STORE_STATE = createStoreState();

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function currentDataDir() {
  return STORE_STATE.dataDir;
}

function currentTokenIndex() {
  return STORE_STATE.tokenIndex;
}

function initStore(opts = {}) {
  const requestedDir = opts.dataDir
    ? path.resolve(String(opts.dataDir))
    : defaultDataDir();
  const shouldRebuild =
    !STORE_STATE.initialized
    || requestedDir !== STORE_STATE.dataDir
    || opts.rebuildIndex === true;
  STORE_STATE.dataDir = requestedDir;
  if (!fs.existsSync(STORE_STATE.dataDir)) fs.mkdirSync(STORE_STATE.dataDir, { recursive: true });
  STORE_STATE.initialized = true;
  if (shouldRebuild) rebuildTokenIndex();
  return { dataDir: STORE_STATE.dataDir };
}

function resetStoreState(opts = {}) {
  STORE_STATE = createStoreState({ dataDir: opts.dataDir });
  if (opts.initialize) initStore({ dataDir: STORE_STATE.dataDir, rebuildIndex: true });
  return { dataDir: STORE_STATE.dataDir };
}

function ensureStoreInitialized() {
  if (!STORE_STATE.initialized) initStore();
}

function userFile(chatId) {
  return path.join(currentDataDir(), `user-${chatId}.json`);
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
    last_email_open_at: null,
    email_opens_total: 0,
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
    reengagement_state: {
      day4_sent_at: null,
      day8_sent_at: null,
      auto_paused_at: null,
      reactivated_at: null,
    },
    signup_referral_source: null,
    preferences: {
      delivery_time: "07:00",
      timezone: "America/New_York",
      email_enabled: true,
      telegram_enabled: true,
    },
  };
}

// ── In-memory token→chatId index (B-2) ───────────────────────────────────────
// Avoids O(n) disk scan on every authenticated request. Rebuilt during
// explicit initStore() and kept current by writeUser().

function rebuildTokenIndex() {
  const tokenIndex = currentTokenIndex();
  tokenIndex.clear();
  const dir = currentDataDir();
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter(f => f.startsWith("user-") && f.endsWith(".json"))
    .forEach(f => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (raw.token) tokenIndex.set(raw.token, raw.chatId || f.replace("user-", "").replace(".json", ""));
      } catch (err) {
        if (process.env.STORE_DEBUG === "1") {
          console.warn(`[store] skipping unreadable user file ${f}: ${err.message}`);
        }
      }
    });
}

// ── Core store functions ──────────────────────────────────────────────────────

function readUser(chatId) {
  ensureStoreInitialized();
  const tokenIndex = currentTokenIndex();
  const f = userFile(chatId);
  if (!fs.existsSync(f)) return defaultUser(chatId);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(f, "utf8")); }
  catch { return defaultUser(chatId); }
  const defaults = defaultUser(chatId);
  const user = {
    ...defaults,
    ...raw,
    preferences: { ...defaults.preferences, ...(raw.preferences || {}) },
    auto_learning: { ...defaults.auto_learning, ...(raw.auto_learning || {}) },
    reengagement_state: { ...defaults.reengagement_state, ...(raw.reengagement_state || {}) },
  };
  // Auto-generate and persist token for existing users who don't have one
  if (!raw.token) {
    user.token = generateToken();
    _writeUserFile(f, user);
    tokenIndex.set(user.token, String(chatId));
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
  ensureStoreInitialized();
  const tokenIndex = currentTokenIndex();
  _writeUserFile(userFile(chatId), data);
  // Keep token index current
  if (data.token) tokenIndex.set(data.token, String(chatId));
}

function allUsers() {
  ensureStoreInitialized();
  const dir = currentDataDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
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
  ensureStoreInitialized();
  const tokenIndex = currentTokenIndex();
  if (!token) return null;
  const hit = tokenIndex.get(token);
  if (hit) return readUser(hit);

  // Cross-process safety: another process may have written users after startup.
  rebuildTokenIndex();
  const refreshed = tokenIndex.get(token);
  if (!refreshed) return null;
  return readUser(refreshed);
}

module.exports = {
  createStoreIndex,
  createStoreState,
  initStore,
  resetStoreState,
  readUser,
  writeUser,
  allUsers,
  defaultUser,
  generateToken,
  findUserByToken,
};
