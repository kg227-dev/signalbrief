const https = require("https");
const crypto = require("crypto");

function qaDebug(message) {
  if (process.env.QA_DEBUG === "1") {
    console.warn(`[qa-cache] ${message}`);
  }
}

function stableHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function tryParseJson(raw, context) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    qaDebug(`JSON parse fallback for ${context}: ${err.message}`);
    return { ok: false, value: null };
  }
}

function httpsPost(hostname, pathName, headers, body, isForm = false, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const data = isForm ? body : JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path: pathName,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (chunk) => {
          out += chunk;
        });
        res.on("end", () => {
          const parsed = tryParseJson(out, `${hostname}${pathName}`);
          if (parsed.ok) {
            resolve({ status: res.statusCode, body: parsed.value, raw: out });
            return;
          }
          resolve({ status: res.statusCode, body: out, raw: out });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`)));
    req.write(data);
    req.end();
  });
}

async function httpsPostWithRetry(hostname, pathName, headers, body, opts = {}) {
  const retries = Math.max(0, Number(opts.retries ?? 1));
  const retryDelayMs = Math.max(100, Number(opts.retryDelayMs ?? 1200));
  const timeoutMs = Math.max(3000, Number(opts.timeoutMs ?? 30000));

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await httpsPost(hostname, pathName, headers, body, opts.isForm === true, timeoutMs);
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

function stripJsonFences(rawText) {
  return String(rawText || "")
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/g, "")
    .trim();
}

function findBalancedSegment(cleaned, openChar, closeChar) {
  const start = cleaned.indexOf(openChar);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonArrayLenient(rawText) {
  const cleaned = stripJsonFences(rawText);
  if (!cleaned) return [];

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const segment = findBalancedSegment(cleaned, "[", "]");
    if (!segment) throw err;
    return JSON.parse(segment);
  }
}

function parseJsonObjectLenient(rawText) {
  const cleaned = stripJsonFences(rawText);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const segment = findBalancedSegment(cleaned, "{", "}");
    if (!segment) throw err;
    return JSON.parse(segment);
  }
}

module.exports = {
  qaDebug,
  stableHash,
  httpsPost,
  httpsPostWithRetry,
  parseJsonArrayLenient,
  parseJsonObjectLenient,
};
