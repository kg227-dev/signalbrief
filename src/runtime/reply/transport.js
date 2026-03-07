const https = require("https");

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
            resolve({ status: res.statusCode, body: JSON.parse(out) });
          } catch {
            resolve({ status: res.statusCode, body: out });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function createTelegramTransport(getBotToken) {
  function tokenPath(method) {
    return `/bot${getBotToken()}/${method}`;
  }

  function post(method, payload) {
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
    if (!callbackQueryId) return Promise.resolve({ status: 200, body: { ok: true } });
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
