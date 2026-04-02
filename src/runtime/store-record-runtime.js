"use strict";

const fs = require("fs");
const path = require("path");
const { readEnvBoolean } = require("./config-provider");

// Atomic write: write to .tmp then rename — prevents partial-write corruption.
function writeUserFileAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function createStoreRecordRuntime(deps) {
  const {
    currentDataDir,
    currentTokenIndex,
    ensureStoreInitialized,
    defaultUser,
    normalizeUserRecord,
    generateToken,
    warnStoreRecovery,
  } = deps;

  function userFile(chatId) {
    return path.join(currentDataDir(), `user-${chatId}.json`);
  }

  function tokenIndexFile() {
    return path.join(currentDataDir(), "token-index.json");
  }

  function isUserRecordFileName(fileName) {
    const normalized = String(fileName || "");
    if (!normalized.startsWith("user-") || !normalized.endsWith(".json")) return false;
    if (normalized === "user-token-index.json") return false;
    return true;
  }

  function writeTokenIndexSnapshot() {
    const filePath = tokenIndexFile();
    const tmpPath = `${filePath}.tmp`;
    const tokenIndex = currentTokenIndex();
    const tokens = {};
    for (const [token, chatId] of tokenIndex.entries()) {
      const safeToken = String(token || "").trim();
      const safeChatId = String(chatId || "").trim();
      if (!safeToken || !safeChatId) continue;
      tokens[safeToken] = safeChatId;
    }
    const payload = {
      version: 1,
      updated_at: new Date().toISOString(),
      tokens,
    };
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
      fs.renameSync(tmpPath, filePath);
    } catch {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // best-effort temp cleanup
      }
    }
  }

  function loadTokenIndexSnapshot() {
    const filePath = tokenIndexFile();
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const tokens = parsed && typeof parsed === "object" && parsed.tokens && typeof parsed.tokens === "object"
        ? parsed.tokens
        : null;
      if (!tokens) return null;
      const out = new Map();
      for (const [token, chatId] of Object.entries(tokens)) {
        const safeToken = String(token || "").trim();
        const safeChatId = String(chatId || "").trim();
        if (!safeToken || !safeChatId) continue;
        out.set(safeToken, safeChatId);
      }
      return out;
    } catch {
      return null;
    }
  }

  function lookupTokenFromSnapshot(token) {
    const snapshot = loadTokenIndexSnapshot();
    if (!(snapshot instanceof Map) || snapshot.size === 0) return "";
    const chatId = String(snapshot.get(token) || "").trim();
    if (!chatId) return "";
    currentTokenIndex().set(token, chatId);
    return chatId;
  }

  function rebuildTokenIndex() {
    const tokenIndex = currentTokenIndex();
    tokenIndex.clear();
    const dir = currentDataDir();
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter((fileName) => isUserRecordFileName(fileName))
      .forEach((fileName) => {
        const filePath = path.join(dir, fileName);
        const fallbackChatId = fileName.replace("user-", "").replace(".json", "");
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const chatId = String(raw.chatId || fallbackChatId);
          const normalized = normalizeUserRecord(raw, { chatId });
          if (normalized.token) {
            tokenIndex.set(normalized.token, chatId);
            return;
          }
          const backfilled = {
            ...normalized,
            token: generateToken(),
            last_updated: normalized.last_updated || new Date().toISOString(),
          };
          writeUserFileAtomic(filePath, backfilled);
          tokenIndex.set(backfilled.token, chatId);
        } catch (err) {
          if (readEnvBoolean(["STORE_DEBUG"], false)) {
            console.warn(`[store] skipping unreadable user file ${fileName}: ${err.message}`);
          }
        }
      });
    writeTokenIndexSnapshot();
  }

  function readUser(chatId) {
    ensureStoreInitialized();
    const filePath = userFile(chatId);
    if (!fs.existsSync(filePath)) return defaultUser(chatId);
    let rawText = "";
    try {
      rawText = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      warnStoreRecovery("read_failed", `chatId=${chatId}`, err?.message || "");
      return defaultUser(chatId);
    }

    let raw;
    try {
      raw = JSON.parse(rawText);
    } catch (err) {
      warnStoreRecovery("parse_failed", `chatId=${chatId}`, err?.message || "");
      return defaultUser(chatId);
    }

    return normalizeUserRecord(raw, { chatId });
  }

  function writeUser(chatId, data) {
    ensureStoreInitialized();
    const tokenIndex = currentTokenIndex();
    const normalized = normalizeUserRecord(data, { chatId });
    const id = String(chatId || "").trim();
    for (const [token, mappedChatId] of tokenIndex.entries()) {
      if (String(mappedChatId || "").trim() !== id) continue;
      if (token === normalized.token) continue;
      tokenIndex.delete(token);
    }
    writeUserFileAtomic(userFile(chatId), normalized);
    if (normalized.token) tokenIndex.set(normalized.token, String(chatId));
    writeTokenIndexSnapshot();
  }

  function deleteUser(chatId) {
    ensureStoreInitialized();
    const id = String(chatId || "").trim();
    if (!id) {
      return { ok: false, existed: false, reason: "chatId required" };
    }

    const filePath = userFile(id);
    const existed = fs.existsSync(filePath);
    const tokenIndex = currentTokenIndex();
    let existingToken = "";

    if (existed) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        existingToken = String(raw?.token || "").trim();
      } catch {
        existingToken = "";
      }
    }

    try {
      if (existed) fs.unlinkSync(filePath);
    } catch (err) {
      return {
        ok: false,
        existed,
        reason: err && err.message ? err.message : "delete failed",
      };
    }

    if (existingToken && tokenIndex.get(existingToken) === id) {
      tokenIndex.delete(existingToken);
    }
    for (const [token, mappedChatId] of tokenIndex.entries()) {
      if (String(mappedChatId || "").trim() === id) tokenIndex.delete(token);
    }
    writeTokenIndexSnapshot();

    return { ok: true, existed: existed || !!existingToken };
  }

  function allUsers() {
    ensureStoreInitialized();
    const dir = currentDataDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((fileName) => isUserRecordFileName(fileName))
      .map((fileName) => {
        const chatId = fileName.replace("user-", "").replace(".json", "");
        try {
          return readUser(chatId);
        } catch (err) {
          warnStoreRecovery("read_user_failed", `chatId=${chatId}`, err?.message || "");
          return null;
        }
      })
      .filter(Boolean);
  }

  function findUserByToken(token) {
    ensureStoreInitialized();
    const tokenIndex = currentTokenIndex();
    const tokenKey = String(token || "").trim();
    if (!tokenKey) return null;
    const hit = tokenIndex.get(tokenKey);
    if (hit) return readUser(hit);
    const snapshotHit = lookupTokenFromSnapshot(tokenKey);
    if (!snapshotHit) return null;
    return readUser(snapshotHit);
  }

  return {
    readUser,
    writeUser,
    deleteUser,
    allUsers,
    rebuildTokenIndex,
    findUserByToken,
    userFile,
  };
}

module.exports = {
  writeUserFileAtomic,
  createStoreRecordRuntime,
};
