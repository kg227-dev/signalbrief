// @ts-check
/** @typedef {import("../runtime-types").TransportResponse} TransportResponse */
const https = require("https");
const fs = require("fs");

/**
 * @param {string} hostname
 * @param {string} path_
 * @param {Record<string, string>} headers
 * @param {Object} body
 * @returns {Promise<TransportResponse>}
 */
function httpsPost(hostname, path_, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = https.request(
      {
        hostname,
        path: path_,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => out += c);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, kind: "json", body: JSON.parse(out) });
          } catch {
            resolve({ status: res.statusCode, kind: "text", body: out });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function appendTransportDryRunLog(entry) {
  const filePath = String(process.env.SIGNALBRIEF_TRANSPORT_LOG_FILE || "").trim();
  if (!filePath) return;
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    // Keep runtime resilient when dry-run logging is unavailable.
    if (process.env.QA_DEBUG === "1") {
      console.warn(`[reply-transport] dry-run log write failed: ${err.message}`);
    }
  }
}

function isTransportDryRunEnabled() {
  return String(process.env.SIGNALBRIEF_TRANSPORT_DRY_RUN || "") === "1";
}

function createTelegramTransport(getBotToken) {
  function tokenPath(method) {
    return `/bot${getBotToken()}/${method}`;
  }

  function post(method, payload) {
    if (isTransportDryRunEnabled()) {
      appendTransportDryRunLog({
        kind: "telegram",
        method,
        payload,
      });
      return Promise.resolve({ status: 200, kind: "json", body: { ok: true, dry_run: true } });
    }
    return httpsPost(
      "api.telegram.org",
      tokenPath(method),
      { "Content-Type": "application/json" },
      payload || {}
    );
  }

  function sendMessage(chatId, text, extra = {}) {
    return post("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...extra,
    });
  }

  function answerCallbackQuery(callbackQueryId, text) {
    if (!callbackQueryId) return Promise.resolve({ status: 200, kind: "json", body: { ok: true } });
    return post("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: String(text || "Done").slice(0, 180),
      show_alert: false,
    });
  }

  return {
    post,
    sendMessage,
    answerCallbackQuery,
  };
}

function createAnthropicTransport(getApiKey) {
  function requestMessage(payload) {
    if (isTransportDryRunEnabled()) {
      appendTransportDryRunLog({
        kind: "anthropic",
        payload,
      });
      return Promise.resolve({
        status: 200,
        kind: "json",
        body: {
          id: "dry-run",
          content: [{ text: "Dry run response." }],
        },
      });
    }
    return httpsPost(
      "api.anthropic.com",
      "/v1/messages",
      {
        "Content-Type": "application/json",
        "x-api-key": getApiKey(),
        "anthropic-version": "2023-06-01",
      },
      payload
    );
  }

  return {
    requestMessage,
  };
}

module.exports = {
  httpsPost,
  createTelegramTransport,
  createAnthropicTransport,
};
