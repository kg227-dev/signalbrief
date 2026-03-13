"use strict";

function createDigestOrchestratorTransportRuntime(deps) {
  const {
    https,
    defaultTimeoutMs = 30_000,
  } = deps || {};

  function httpsPostRuntime(hostname, path_, headers, body, isForm = false) {
    return new Promise((resolve, reject) => {
      const data = isForm ? body : JSON.stringify(body);
      const req = https.request(
        {
          hostname,
          path: path_,
          method: "POST",
          headers: { ...headers, "Content-Length": Buffer.byteLength(data) },
        },
        (res) => {
          let out = "";
          res.on("data", (chunk) => {
            out += chunk;
          });
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
      req.setTimeout(defaultTimeoutMs, () => {
        req.destroy(new Error(`HTTP timeout after ${Math.round(defaultTimeoutMs / 1000)}s`));
      });
      req.write(data);
      req.end();
    });
  }

  function httpsPost(hostname, path_, headers, body) {
    return httpsPostRuntime(hostname, path_, headers, body, false);
  }

  async function httpsPostWithRetry(hostname, path_, headers, body, opts = {}) {
    const retries = Math.max(0, Number(opts.retries ?? 2));
    const retryDelayMs = Math.max(100, Number(opts.retryDelayMs ?? 1200));
    const isForm = !!opts.isForm;

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await httpsPostRuntime(hostname, path_, headers, body, isForm);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || "");
        const retryable = /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg);
        if (!retryable || attempt >= retries) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }

    throw lastErr || new Error("HTTP request failed");
  }

  return {
    httpsPostRuntime,
    httpsPost,
    httpsPostWithRetry,
  };
}

module.exports = {
  createDigestOrchestratorTransportRuntime,
};
