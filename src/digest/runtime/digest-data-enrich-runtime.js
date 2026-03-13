"use strict";

const { buildDigestDataEnrichPrompt } = require("./digest-data-enrich-prompt-runtime");
const { parseJsonArrayLenient, normalizeEnrichedItems } = require("./digest-data-enrich-result-runtime");

const DEFAULT_ANTHROPIC_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_RETRIES = 2;
const DEFAULT_ANTHROPIC_RETRY_DELAY_MS = 1_200;
const DEFAULT_ANTHROPIC_RETRY_STATUS_CODES = Object.freeze([429, 500, 502, 503, 504]);

function toBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function normalizeStatusCodes(rawValue, fallback) {
  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "").split(",");
  const out = [];
  for (const entry of source) {
    const code = Number(String(entry || "").trim());
    if (!Number.isInteger(code) || code < 100 || code > 599) continue;
    if (out.includes(code)) continue;
    out.push(code);
  }
  return out.length > 0 ? out : fallback.slice();
}

function resolveAnthropicResilience(configDigest) {
  const configured = configDigest?.providerResilience?.anthropic || {};
  return {
    timeoutMs: toBoundedInt(
      process.env.SIGNALBRIEF_ANTHROPIC_TIMEOUT_MS || configured.timeoutMs,
      DEFAULT_ANTHROPIC_TIMEOUT_MS,
      { min: 1_000, max: 180_000 }
    ),
    retries: toBoundedInt(
      process.env.SIGNALBRIEF_ANTHROPIC_RETRIES || configured.retries,
      DEFAULT_ANTHROPIC_RETRIES,
      { min: 0, max: 8 }
    ),
    retryDelayMs: toBoundedInt(
      process.env.SIGNALBRIEF_ANTHROPIC_RETRY_DELAY_MS || configured.retryDelayMs,
      DEFAULT_ANTHROPIC_RETRY_DELAY_MS,
      { min: 100, max: 60_000 }
    ),
    retryStatusCodes: normalizeStatusCodes(
      process.env.SIGNALBRIEF_ANTHROPIC_RETRY_STATUS_CODES || configured.retryStatusCodes,
      DEFAULT_ANTHROPIC_RETRY_STATUS_CODES
    ),
  };
}

function buildFallbackItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    wim: null,
    implications: null,
    watch_next: null,
  }));
}

function buildUsage(payload) {
  return {
    input_tokens: Number(payload?.usage?.input_tokens || 0),
    output_tokens: Number(payload?.usage?.output_tokens || 0),
  };
}

function degradedResult(items, usage, degradation) {
  return {
    items: buildFallbackItems(items),
    usage,
    degraded: true,
    degradation,
  };
}

function createDigestDataEnrichRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
  } = deps;

  async function enrichItems(items, enrichOpts = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return { items: [], usage: { input_tokens: 0, output_tokens: 0 }, degraded: false, degradation: null };
    }

    const enrichModel = enrichOpts.model || "claude-haiku-4-5";
    const providerPolicy = resolveAnthropicResilience(CONFIG?.digest);
    log(`Enriching with ${enrichModel}...`);

    let res;
    try {
      res = await httpsPostWithRetry(
        "api.anthropic.com",
        "/v1/messages",
        {
          "Content-Type": "application/json",
          "x-api-key": CONFIG.keys.anthropic,
          "anthropic-version": "2023-06-01",
        },
        {
          model: enrichModel,
          max_tokens: 4500,
          messages: [{ role: "user", content: buildDigestDataEnrichPrompt(items) }],
        },
        {
          retries: providerPolicy.retries,
          retryDelayMs: providerPolicy.retryDelayMs,
          timeoutMs: providerPolicy.timeoutMs,
          retryStatusCodes: providerPolicy.retryStatusCodes,
        }
      );
    } catch (err) {
      const message = String(err?.message || err).slice(0, 180);
      log(`⚠️ Claude request failed: ${message}`);
      return degradedResult(items, { input_tokens: 0, output_tokens: 0 }, {
        provider: "anthropic",
        reason: "request_failed",
        message,
        timeout_ms: providerPolicy.timeoutMs,
        retries: providerPolicy.retries,
      });
    }

    const usage = buildUsage(res.body);
    if (Number(res.status || 0) >= 400) {
      const detail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
      const message = String(detail).slice(0, 180);
      log(`⚠️ Claude request returned ${res.status}: ${message}`);
      return degradedResult(items, usage, {
        provider: "anthropic",
        reason: "status_failure",
        status_code: Number(res.status || 0) || null,
        message,
        retries: providerPolicy.retries,
      });
    }

    try {
      const enriched = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
      if (!Array.isArray(enriched)) throw new Error("Claude response was not a JSON array");
      return {
        items: normalizeEnrichedItems(items, enriched),
        usage,
        degraded: false,
        degradation: null,
      };
    } catch (err) {
      log(`Claude parse error: ${err.message}`);
      return degradedResult(items, usage, {
        provider: "anthropic",
        reason: "parse_failure",
        message: String(err.message || err).slice(0, 180),
      });
    }
  }

  return {
    enrichItems,
  };
}

module.exports = {
  createDigestDataEnrichRuntime,
};
