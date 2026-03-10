"use strict";

const fs = require("fs");
const path = require("path");

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

  function rebuildTokenIndex() {
    const tokenIndex = currentTokenIndex();
    tokenIndex.clear();
    const dir = currentDataDir();
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter((fileName) => fileName.startsWith("user-") && fileName.endsWith(".json"))
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
          if (process.env.STORE_DEBUG === "1") {
            console.warn(`[store] skipping unreadable user file ${fileName}: ${err.message}`);
          }
        }
      });
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
    writeUserFileAtomic(userFile(chatId), normalized);
    if (normalized.token) tokenIndex.set(normalized.token, String(chatId));
  }

  function allUsers() {
    ensureStoreInitialized();
    const dir = currentDataDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((fileName) => fileName.startsWith("user-") && fileName.endsWith(".json"))
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
    if (!token) return null;
    const hit = tokenIndex.get(token);
    if (hit) return readUser(hit);
    rebuildTokenIndex();
    const refreshed = tokenIndex.get(token);
    if (!refreshed) return null;
    return readUser(refreshed);
  }

  return {
    readUser,
    writeUser,
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
