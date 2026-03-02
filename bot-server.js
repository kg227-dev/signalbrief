#!/usr/bin/env node
/**
 * SignalBrief — bot-server.js
 * Lightweight webhook server for the SignalBrief Telegram bot.
 * Receives updates from Telegram and dispatches to reply-handler.js
 * 
 * Usage: node bot-server.js
 * Runs on PORT 3002 by default.
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { handle } = require("./reply-handler");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const BOT_TOKEN = CONFIG.keys.signalBriefBotToken || CONFIG.keys.telegramBotToken;
const PORT = 3002;

// ── Polling (no public webhook needed — long-poll from local Mac) ─────────────

let lastUpdateId = 0;

async function poll() {
  return new Promise((resolve) => {
    const url = `/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
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
  // Only handle new messages — skip edited_message to prevent double-handling
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  console.log(`[${new Date().toISOString()}] [${chatId}] ${text}`);

  try {
    await handle(text, chatId);
  } catch (e) {
    console.error(`Error handling message: ${e.message}`);
  }
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

runLoop();
