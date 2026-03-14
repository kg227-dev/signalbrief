"use strict";

const { getTopicQueries, buildSearchRequest } = require("./digest-data-fetch-request-runtime");
const {
  enrichWithCitationUrls,
  collectUniqueItems,
  shouldStopAttempts,
  parsePerplexityItems,
} = require("./digest-data-fetch-items-runtime");

const DEFAULT_PERPLEXITY_TIMEOUT_MS = 25_000;
const DEFAULT_PERPLEXITY_RETRIES = 2;
const DEFAULT_PERPLEXITY_RETRY_DELAY_MS = 1_200;
const DEFAULT_PERPLEXITY_RETRY_STATUS_CODES = Object.freeze([429, 500, 502, 503, 504]);

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

function resolvePerplexityResilience(configDigest) {
  const configured = configDigest?.providerResilience?.perplexity || {};
  return {
    timeoutMs: toBoundedInt(
      process.env.SIGNALBRIEF_PERPLEXITY_TIMEOUT_MS || configured.timeoutMs,
      DEFAULT_PERPLEXITY_TIMEOUT_MS,
      { min: 1_000, max: 180_000 }
    ),
    retries: toBoundedInt(
      process.env.SIGNALBRIEF_PERPLEXITY_RETRIES || configured.retries,
      DEFAULT_PERPLEXITY_RETRIES,
      { min: 0, max: 8 }
    ),
    retryDelayMs: toBoundedInt(
      process.env.SIGNALBRIEF_PERPLEXITY_RETRY_DELAY_MS || configured.retryDelayMs,
      DEFAULT_PERPLEXITY_RETRY_DELAY_MS,
      { min: 100, max: 60_000 }
    ),
    retryStatusCodes: normalizeStatusCodes(
      process.env.SIGNALBRIEF_PERPLEXITY_RETRY_STATUS_CODES || configured.retryStatusCodes,
      DEFAULT_PERPLEXITY_RETRY_STATUS_CODES
    ),
  };
}

function incrementStatusCount(statusCounts, statusCode) {
  const code = Number(statusCode);
  if (!Number.isInteger(code)) return;
  statusCounts[code] = (statusCounts[code] || 0) + 1;
}

function createDigestDataFetchRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
    normalizeUrlForDedup,
  } = deps;

  async function fetchTopicNews(topic, opts = {}) {
    const searchModel = opts.searchModel || "sonar";
    const providerPolicy = resolvePerplexityResilience(CONFIG?.digest);
    const retrievedAt = new Date().toISOString();
    log(`Fetching: ${topic.tag}`);
    const queries = getTopicQueries(topic);
    const maxAttempts = topic?.isCustom ? Math.min(3, queries.length) : 1;
    const collected = [];
    const seenUrl = new Set();
    const seenHeadline = new Set();
    let apiCalls = 0;
    const diagnostics = {
      provider: "perplexity",
      timeout_ms: providerPolicy.timeoutMs,
      retries: providerPolicy.retries,
      retry_status_codes: providerPolicy.retryStatusCodes.slice(),
      attempts_planned: maxAttempts,
      attempts_executed: 0,
      successful_calls: 0,
      failed_calls: 0,
      transport_errors: 0,
      status_counts: {},
      degraded: false,
      last_error: null,
    };

    if (!queries.length) {
      return { items: [], apiCalls: 0, diagnostics };
    }

    for (let idx = 0; idx < maxAttempts; idx++) {
      const query = queries[idx];
      diagnostics.attempts_executed += 1;
      if (idx > 0) log(`↳ ${topic.tag} fallback query ${idx + 1}/${maxAttempts}`);

      let res;
      try {
        res = await httpsPostWithRetry(
          "api.perplexity.ai",
          "/chat/completions",
          {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONFIG.keys.perplexity}`,
          },
          buildSearchRequest(topic.tag, query, searchModel),
          {
            retries: providerPolicy.retries,
            retryDelayMs: providerPolicy.retryDelayMs,
            timeoutMs: providerPolicy.timeoutMs,
            retryStatusCodes: providerPolicy.retryStatusCodes,
          }
        );
        apiCalls += 1;
      } catch (err) {
        const message = String(err?.message || err).slice(0, 180);
        diagnostics.failed_calls += 1;
        diagnostics.transport_errors += 1;
        diagnostics.degraded = true;
        diagnostics.last_error = message;
        log(`⚠️ Perplexity ${topic.tag} query failed (${idx + 1}/${maxAttempts}): ${message}`);
        continue;
      }

      if (res.status >= 400) {
        const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
        diagnostics.failed_calls += 1;
        diagnostics.degraded = true;
        diagnostics.last_error = String(errDetail).slice(0, 180);
        incrementStatusCount(diagnostics.status_counts, res.status);
        log(`⚠️ Perplexity ${topic.tag} request returned ${res.status}: ${String(errDetail).slice(0, 180)}`);
        continue;
      }
      diagnostics.successful_calls += 1;

      const citations = res.body?.citations || [];

      try {
        const content = res.body?.choices?.[0]?.message?.content || "[]";
        if (!res.body?.choices?.[0]?.message?.content) {
          const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || "no choices content";
          log(`⚠️ Perplexity returned empty payload for ${topic.tag}: ${String(errDetail).slice(0, 180)}`);
        }
        const parsed = parsePerplexityItems(content);
        if (!Array.isArray(parsed)) {
          log(`⚠️ Perplexity payload for ${topic.tag} was not an array`);
          continue;
        }

        const normalized = enrichWithCitationUrls(parsed, citations, topic.tag, log)
          .map((item) => ({ ...item, retrieved_at: retrievedAt }));
        collectUniqueItems(normalized, seenHeadline, seenUrl, collected, normalizeUrlForDedup);
      } catch (err) {
        log(`Parse error for ${topic.tag}: ${err.message}`);
      }

      if (shouldStopAttempts(topic, collected)) break;
    }

    return {
      items: collected.slice(0, 3),
      apiCalls,
      diagnostics,
    };
  }

  return {
    fetchTopicNews,
  };
}

module.exports = {
  createDigestDataFetchRuntime,
};
