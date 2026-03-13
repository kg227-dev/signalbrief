"use strict";

function toBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function normalizeRetryStatusCodes(rawStatusCodes) {
  if (!Array.isArray(rawStatusCodes)) return [];
  const statusCodes = [];
  for (const rawCode of rawStatusCodes) {
    const code = Number(rawCode);
    if (!Number.isInteger(code) || code < 100 || code > 599) continue;
    if (statusCodes.includes(code)) continue;
    statusCodes.push(code);
  }
  return statusCodes;
}

function isRetryableNetworkError(error) {
  const msg = String(error?.message || "");
  return /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|ECONNREFUSED|EPIPE/i.test(msg);
}

function shouldRetryStatusCode(status, retryStatusCodes) {
  const code = Number(status);
  if (!Number.isInteger(code)) return false;
  return retryStatusCodes.includes(code);
}

function createDigestOrchestratorTransportRuntime(deps) {
  const {
    https,
    defaultTimeoutMs = 30_000,
  } = deps || {};

  function httpsPostRuntime(hostname, path_, headers, body, opts = {}) {
    const isForm = !!opts.isForm;
    const timeoutMs = toBoundedInt(opts.timeoutMs, toBoundedInt(defaultTimeoutMs, 30_000, { min: 1_000 }), {
      min: 1_000,
      max: 180_000,
    });
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
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`HTTP timeout after ${Math.round(timeoutMs / 1000)}s`));
      });
      req.write(data);
      req.end();
    });
  }

  function httpsPost(hostname, path_, headers, body, opts = {}) {
    return httpsPostRuntime(hostname, path_, headers, body, { ...opts, isForm: false });
  }

  async function httpsPostWithRetry(hostname, path_, headers, body, opts = {}) {
    const retries = toBoundedInt(opts.retries ?? 2, 2, { min: 0, max: 8 });
    const retryDelayMs = toBoundedInt(opts.retryDelayMs ?? 1200, 1200, { min: 100, max: 60_000 });
    const timeoutMs = toBoundedInt(opts.timeoutMs, toBoundedInt(defaultTimeoutMs, 30_000, { min: 1_000 }), {
      min: 1_000,
      max: 180_000,
    });
    const isForm = !!opts.isForm;
    const retryStatusCodes = normalizeRetryStatusCodes(opts.retryStatusCodes);

    let lastErr = null;
    let lastResponse = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await httpsPostRuntime(hostname, path_, headers, body, { isForm, timeoutMs });
        lastResponse = response;
        const retryableStatus = shouldRetryStatusCode(response?.status, retryStatusCodes);
        if (!retryableStatus || attempt >= retries) {
          return response;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
        continue;
      } catch (err) {
        lastErr = err;
        const retryable = isRetryableNetworkError(err);
        if (!retryable || attempt >= retries) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }

    if (lastResponse) return lastResponse;
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
