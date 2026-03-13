"use strict";

const fs = require("fs");
const path = require("path");
const { assertStoreAdapterContract } = require("./store-adapter-contract-runtime");

function createSqliteStoreAdapter(deps, options = {}) {
  const {
    currentDataDir,
    currentTokenIndex,
    ensureStoreInitialized,
    defaultUser,
    normalizeUserRecord,
    generateToken,
    warnStoreRecovery,
  } = deps;

  const explicitPath = String(options.sqlitePath || "").trim();
  const resolveSqlitePath = typeof options.resolveSqlitePath === "function"
    ? options.resolveSqlitePath
    : () => (explicitPath ? path.resolve(explicitPath) : path.join(currentDataDir(), "signalbrief.sqlite"));

  let dbPath = "";
  let db = null;

  function ensureDatabase() {
    ensureStoreInitialized();
    const targetPath = path.resolve(resolveSqlitePath());
    if (!targetPath) throw new Error("sqlite path is required");
    if (db && dbPath === targetPath) return db;

    if (db && typeof db.close === "function") {
      try {
        db.close();
      } catch {
        // best-effort close before reconnect
      }
    }

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Lazy require so the experimental sqlite warning is emitted only when adapter is used.
    const { DatabaseSync } = require("node:sqlite");
    const nextDb = new DatabaseSync(targetPath);
    nextDb.exec("PRAGMA journal_mode = WAL;");
    nextDb.exec("PRAGMA synchronous = NORMAL;");
    nextDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        chat_id TEXT PRIMARY KEY,
        token TEXT,
        record_json TEXT NOT NULL,
        updated_at TEXT
      );
    `);
    nextDb.exec("CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);");

    db = nextDb;
    dbPath = targetPath;
    return db;
  }

  function readUser(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return defaultUser(chatId);
    const database = ensureDatabase();
    const row = database
      .prepare("SELECT record_json FROM users WHERE chat_id = ? LIMIT 1")
      .get(id);
    if (!row || typeof row.record_json !== "string") return defaultUser(id);
    try {
      const raw = JSON.parse(row.record_json);
      return normalizeUserRecord(raw, { chatId: id });
    } catch (err) {
      warnStoreRecovery("parse_failed", `chatId=${id}`, err?.message || "");
      return defaultUser(id);
    }
  }

  function writeUser(chatId, data) {
    const id = String(chatId || "").trim();
    if (!id) return;
    const database = ensureDatabase();
    const tokenIndex = currentTokenIndex();
    const normalized = normalizeUserRecord(data, { chatId: id });
    const nowIso = normalized.last_updated || new Date().toISOString();
    database.prepare(`
      INSERT INTO users (chat_id, token, record_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        token=excluded.token,
        record_json=excluded.record_json,
        updated_at=excluded.updated_at
    `).run(
      id,
      normalized.token || null,
      JSON.stringify(normalized),
      nowIso
    );
    if (normalized.token) tokenIndex.set(normalized.token, id);
  }

  function deleteUser(chatId) {
    const id = String(chatId || "").trim();
    if (!id) return { ok: false, existed: false, reason: "chatId required" };
    const database = ensureDatabase();
    const tokenIndex = currentTokenIndex();
    const result = database.prepare("DELETE FROM users WHERE chat_id = ?").run(id);
    for (const [token, mappedChatId] of tokenIndex.entries()) {
      if (String(mappedChatId || "").trim() === id) tokenIndex.delete(token);
    }
    return { ok: true, existed: Number(result?.changes || 0) > 0 };
  }

  function allUsers() {
    const database = ensureDatabase();
    const rows = database.prepare("SELECT chat_id, record_json FROM users ORDER BY chat_id ASC").all();
    const users = [];
    for (const row of rows) {
      const id = String(row?.chat_id || "").trim();
      if (!id) continue;
      try {
        const raw = JSON.parse(String(row?.record_json || "{}"));
        users.push(normalizeUserRecord(raw, { chatId: id }));
      } catch (err) {
        warnStoreRecovery("parse_failed", `chatId=${id}`, err?.message || "");
      }
    }
    return users;
  }

  function rebuildTokenIndex() {
    const database = ensureDatabase();
    const tokenIndex = currentTokenIndex();
    tokenIndex.clear();
    const rows = database.prepare("SELECT chat_id, token, record_json FROM users ORDER BY chat_id ASC").all();
    for (const row of rows) {
      const id = String(row?.chat_id || "").trim();
      if (!id) continue;
      let normalized;
      try {
        const raw = JSON.parse(String(row?.record_json || "{}"));
        normalized = normalizeUserRecord(raw, { chatId: id });
      } catch (err) {
        warnStoreRecovery("parse_failed", `chatId=${id}`, err?.message || "");
        continue;
      }

      if (normalized.token) {
        tokenIndex.set(normalized.token, id);
        continue;
      }

      const backfilled = {
        ...normalized,
        token: generateToken(),
        last_updated: normalized.last_updated || new Date().toISOString(),
      };
      database.prepare(`
        UPDATE users
        SET token = ?, record_json = ?, updated_at = ?
        WHERE chat_id = ?
      `).run(
        backfilled.token,
        JSON.stringify(backfilled),
        backfilled.last_updated,
        id
      );
      tokenIndex.set(backfilled.token, id);
    }
  }

  function findUserByToken(token) {
    const rawToken = String(token || "").trim();
    if (!rawToken) return null;
    const tokenIndex = currentTokenIndex();
    const directHit = tokenIndex.get(rawToken);
    if (directHit) return readUser(directHit);
    rebuildTokenIndex();
    const refreshed = tokenIndex.get(rawToken);
    if (!refreshed) return null;
    return readUser(refreshed);
  }

  return assertStoreAdapterContract({
    readUser,
    writeUser,
    deleteUser,
    allUsers,
    rebuildTokenIndex,
    findUserByToken,
  }, { label: "sqlite store adapter" });
}

module.exports = {
  createSqliteStoreAdapter,
};
