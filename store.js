/**
 * SignalBrief — store.js
 * Simple JSON-based data store. One file per user keyed by chatId.
 * Upgrade path: swap readUser/writeUser for SQLite when multi-user hits ~20+.
 */

const fs = require("fs");
const path = require("path");

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
    digests_received: 0,
    joined_at: new Date().toISOString(),
    last_digest_at: null,
    topic_weights: {},          // { "AI": 1, "PHARMA": -1 }
    custom_topics: [],          // ["GLP-1", "biosimilars"]
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
  return { ...defaultUser(chatId), ...JSON.parse(fs.readFileSync(f, "utf8")) };
}

function writeUser(chatId, data) {
  fs.writeFileSync(userFile(chatId), JSON.stringify(data, null, 2));
}

function allUsers() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith("user-") && f.endsWith(".json"))
    .flatMap(f => {
      try { return [JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"))]; }
      catch { return []; } // skip malformed user files silently
    });
}

module.exports = { readUser, writeUser, allUsers, defaultUser };
