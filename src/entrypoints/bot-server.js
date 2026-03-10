#!/usr/bin/env node
/**
 * SignalBrief — bot-server.js
 * Polling-first Telegram ingress worker.
 * Continuously long-polls Telegram getUpdates and dispatches to src/domains/reply.
 * Webhook ingress is legacy/optional and not active in the default runtime.
 * 
 * Usage: node src/entrypoints/bot-server.js
*/

const https = require("https");
const { loadConfig: loadRuntimeConfig } = require("../platform/config");
const { createStore } = require("../platform/store");
const {
  handleIncomingMessage,
  handleCallbackQuery,
} = require("../domains/reply");

const botStore = createStore();
const { initStore } = botStore;

function loadConfig() {
  return loadRuntimeConfig();
}

function getBotToken() {
  const config = loadConfig();
  return config?.keys?.signalBriefBotToken || config?.keys?.telegramBotToken || "";
}

let storeReady = false;
function ensureStoreReady() {
  if (storeReady) return;
  initStore();
  storeReady = true;
}

// ── Polling (no public webhook endpoint needed) ────────────────────────────────

let lastUpdateId = 0;

async function poll() {
  return new Promise((resolve) => {
    const botToken = getBotToken();
    if (!botToken) return resolve([]);
    const url = `/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
    const req = https.request(
      { hostname: "api.telegram.org", path: url, method: "GET" },
      (res) => {
        let out = "";
        res.on("data", c => out += c);
        res.on("end", () => {
          try {
            const data = JSON.parse(out);
            if (data.ok && data.result.length > 0) {
              resolve(data.result);
            } else {
              resolve([]);
            }
          } catch { resolve([]); }
        });
      }
    );
    req.on("error", () => resolve([]));
    // Socket timeout: 35s (5s headroom over the 30s Telegram long-poll timeout)
    req.setTimeout(35000, () => { req.destroy(new Error("poll timeout")); });
    req.end();
  });
}

async function processUpdate(update) {
  // Message updates
  const msg = update.message;
  if (msg && msg.text) {
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    console.log(`[${new Date().toISOString()}] [${chatId}] ${text}`);
    try {
      await handleIncomingMessage(text, chatId);
    } catch (e) {
      console.error(`Error handling message: ${e.message}`);
    }
    return;
  }

  // Inline callback updates
  const callback = update.callback_query;
  if (callback && callback.data) {
    const chatId = String(callback?.message?.chat?.id || callback?.from?.id || "");
    const data = String(callback.data || "").trim();
    if (!chatId || !data) return;

    console.log(`[${new Date().toISOString()}] [${chatId}] callback ${data}`);
    let notice = "Saved";
    try {
      const result = await handleCallbackQuery(data, chatId);
      if (result && result.notice) notice = String(result.notice);
    } catch (e) {
      notice = "Action failed";
      console.error(`Error handling callback: ${e.message}`);
    }
    try {
      await answerCallbackQuery(callback.id, notice);
    } catch (e) {
      console.error(`Error answering callback query: ${e.message}`);
    }
  }
}

function telegramPost(pathname, payload) {
  return new Promise((resolve, reject) => {
    const botToken = getBotToken();
    if (!botToken) return reject(new Error("missing telegram bot token"));
    const body = JSON.stringify(payload || {});
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${botToken}/${pathname}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => out += c);
        res.on("end", () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            resolve({ ok: false, raw: out });
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("telegram post timeout")));
    req.write(body);
    req.end();
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  if (!callbackQueryId) return;
  await telegramPost("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: String(text || "Done").slice(0, 180),
    show_alert: false,
  });
}

async function runLoop() {
  console.log(`[${new Date().toISOString()}] SignalBrief bot polling...`);
  while (true) {
    try {
      const updates = await poll();
      for (const update of updates) {
        lastUpdateId = update.update_id;
        await processUpdate(update);
      }
    } catch (e) {
      console.error(`Poll error: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000)); // back off on error
    }
  }
}

function startBotServer() {
  ensureStoreReady();
  return runLoop();
}

if (require.main === module) {
  startBotServer();
}

module.exports = {
  loadConfig,
  getBotToken,
  poll,
  processUpdate,
  telegramPost,
  answerCallbackQuery,
  runLoop,
  startBotServer,
};
