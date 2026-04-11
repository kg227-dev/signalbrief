"use strict";

/**
 * Strategic Relevance Classifier — calls Claude Haiku to classify news
 * articles as HIGH/MEDIUM/LOW strategic relevance.
 *
 * Depends on: src/domains/classification/strategic-relevance-cache.js
 */

const { lookupCache, writeEntry, flushCache } = require("./strategic-relevance-cache.js");

// ─── Constants ────────────────────────────────────────────────────────────────

const CLASSIFIER_VERSION = "1.0";
const VALID_LABELS = ["HIGH", "MEDIUM", "LOW"];
const FALLBACK_RESULT = Object.freeze({ classification: "MEDIUM", reason: "Classifier fallback" });
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MODEL = "claude-3-haiku-20240307";
const DEFAULT_MAX_TOKENS = 100;

function buildUsage(payload) {
  return {
    input_tokens: Number(payload?.usage?.input_tokens || 0),
    output_tokens: Number(payload?.usage?.output_tokens || 0),
  };
}

function mergeUsage(left = {}, right = {}) {
  return {
    input_tokens: Number(left?.input_tokens || 0) + Number(right?.input_tokens || 0),
    output_tokens: Number(left?.output_tokens || 0) + Number(right?.output_tokens || 0),
  };
}

// ─── buildClassificationPrompt ───────────────────────────────────────────────

/**
 * Build the system and user prompt for a classification call.
 *
 * @param {object} candidate
 * @returns {{ system: string, user: string }}
 */
function buildClassificationPrompt(candidate) {
  const headline = (candidate && candidate.headline) ? candidate.headline : "Untitled";
  const snippet = (candidate && candidate.snippet) ? candidate.snippet : "Not available";
  const source = (candidate && candidate.source_domain) ? candidate.source_domain : "Unknown";
  const topic = (candidate && candidate.tag) ? candidate.tag : "General";

  const system = [
    "You are a strategic relevance classifier for a senior executive intelligence digest.",
    "",
    "Classify the following news article into exactly one of these three relevance levels:",
    "",
    "HIGH — Major strategic developments that a C-suite executive must be aware of immediately.",
    "      Includes: central bank decisions, major regulatory changes, geopolitical events,",
    "      large M&A deals, significant market disruptions, or executive-level industry shifts.",
    "",
    "MEDIUM — Relevant but not urgent. Worth monitoring. Includes: industry trends, notable",
    "         company earnings, moderate policy updates, sector-level developments.",
    "",
    "LOW — Background noise. Routine updates, minor announcements, opinion pieces, or stories",
    "      that lack strategic significance for a senior executive.",
    "",
    "Focus on content, not source reputation. A prestigious source can publish non-strategic content.",
    "",
    'Return JSON only:',
    '{"classification": "HIGH | MEDIUM | LOW", "reason": "max 15 words explaining why"}',
  ].join("\n");

  const user = [
    `Title: ${headline}`,
    `Summary: ${snippet}`,
    `Source: ${source}`,
    `Topic: ${topic}`,
  ].join("\n");

  return { system, user };
}

// ─── normalizeClassificationResult ───────────────────────────────────────────

/**
 * Validate and normalize raw model output.
 * Never throws.
 *
 * @param {*} raw
 * @returns {{ classification: string, reason: string }}
 */
function normalizeClassificationResult(raw) {
  // Non-object or null: return fallback
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...FALLBACK_RESULT };
  }

  // Normalize classification
  let classification = "MEDIUM";
  if (raw.classification && typeof raw.classification === "string") {
    const upper = raw.classification.toUpperCase();
    if (VALID_LABELS.includes(upper)) {
      classification = upper;
    }
  }

  // Normalize reason — truncate to 15 words, provide default if missing
  let reason = "No reason provided";
  if (raw.reason && typeof raw.reason === "string" && raw.reason.trim().length > 0) {
    const words = raw.reason.trim().split(/\s+/);
    reason = words.slice(0, 15).join(" ");
  }

  return { classification, reason };
}

// ─── classifySingle ───────────────────────────────────────────────────────────

/**
 * Classify a single candidate via the Anthropic Messages API.
 *
 * @param {object} candidate
 * @param {{ apiKey: string, model?: string, timeout?: number, httpsPost: Function }} opts
 * @returns {Promise<{ classification: string, reason: string, _fallback_type?: string }>}
 */
async function classifySingle(candidate, opts) {
  const { apiKey, model = DEFAULT_MODEL, timeout, httpsPost } = opts || {};

  if (!apiKey || !httpsPost) {
    return { ...FALLBACK_RESULT, _fallback_type: "no_api_key", usage: { input_tokens: 0, output_tokens: 0 } };
  }

  const { system, user } = buildClassificationPrompt(candidate);

  const requestBody = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  };

  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };

  let res;
  try {
    res = await httpsPost(
      "api.anthropic.com",
      "/v1/messages",
      headers,
      requestBody,
      { timeoutMs: timeout || 15000, retries: 1, retryDelayMs: 500 }
    );
  } catch (err) {
    return { ...FALLBACK_RESULT, _fallback_type: "network_error", usage: { input_tokens: 0, output_tokens: 0 } };
  }

  if (res.status >= 400) {
    return { ...FALLBACK_RESULT, _fallback_type: "network_error", usage: buildUsage(res.body) };
  }

  // Extract text from response
  let text;
  try {
    text = res.body && res.body.content && res.body.content[0] && res.body.content[0].text;
  } catch (_) {
    // swallow
  }

  if (!text) {
    return { ...FALLBACK_RESULT, _fallback_type: "empty_response", usage: buildUsage(res.body) };
  }

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return { ...FALLBACK_RESULT, _fallback_type: "parse_failure", usage: buildUsage(res.body) };
  }

  // Validate label
  if (!parsed || !parsed.classification ||
      !VALID_LABELS.includes(parsed.classification.toUpperCase())) {
    return { ...FALLBACK_RESULT, _fallback_type: "unrecognized_label", usage: buildUsage(res.body) };
  }

  return {
    ...normalizeClassificationResult(parsed),
    usage: buildUsage(res.body),
  };
}

// ─── runConcurrent ────────────────────────────────────────────────────────────

/**
 * Run worker over all items with limited concurrency.
 * Uses a shared cursor so N workers pull from the same queue.
 *
 * @param {Array} items
 * @param {Function} worker  - async (item) => void
 * @param {number} concurrency
 * @returns {Promise<void>}
 */
async function runConcurrent(items, worker, concurrency) {
  if (!items || items.length === 0) return;

  let cursor = 0;

  async function pull() {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i]);
    }
  }

  const workers = [];
  const limit = Math.min(concurrency, items.length);
  for (let i = 0; i < limit; i++) {
    workers.push(pull());
  }
  await Promise.all(workers);
}

// ─── classifyCandidates ───────────────────────────────────────────────────────

/**
 * Orchestration entry point. Classifies all candidates using cache + model.
 *
 * @param {object[]} candidates
 * @param {{
 *   cache?: Map,
 *   config?: object,
 *   log?: Function,
 *   httpsPost?: Function,
 *   cachePath?: string
 * }} opts
 * @returns {Promise<{ candidates: object[], diagnostics: object }>}
 */
async function classifyCandidates(candidates, opts) {
  const startMs = Date.now();
  const {
    cache = new Map(),
    config = {},
    log = null,
    httpsPost = null,
    cachePath = null,
  } = opts || {};

  const apiKey = config.keys?.anthropic || config.ANTHROPIC_API_KEY || config.apiKey || null;
  const classificationConfig = config.digest?.classification || {};
  const model = classificationConfig.model || DEFAULT_MODEL;
  const concurrency = classificationConfig.concurrency || DEFAULT_CONCURRENCY;
  const ttlDays = classificationConfig.cache_ttl_days || 14;

  let cacheHits = 0;
  let modelCalls = 0;
  let fallbacks = 0;
  let errors = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let usage = { input_tokens: 0, output_tokens: 0 };

  // Phase 1: Check cache for all candidates
  const misses = [];
  for (const candidate of candidates) {
    const url = candidate.url || candidate.link || null;
    if (!url) {
      misses.push(candidate);
      continue;
    }

    const entry = lookupCache(cache, url, CLASSIFIER_VERSION, { ttlDays });
    if (entry) {
      candidate.strategic_relevance = entry.classification;
      candidate.strategic_relevance_reason = entry.reason;
      candidate.strategic_relevance_source = "cache";
      candidate.strategic_relevance_version = CLASSIFIER_VERSION;
      candidate.strategic_relevance_applied = true;
      cacheHits++;
    } else {
      misses.push(candidate);
    }
  }

  // Phase 2: Run cache misses through classifySingle with concurrency pool
  await runConcurrent(misses, async (candidate) => {
    const result = await classifySingle(candidate, { apiKey, model, httpsPost });
    modelCalls++;
    usage = mergeUsage(usage, result.usage);

    if (result._fallback_type) {
      fallbacks++;
      if (result._fallback_type === "network_error") {
        errors++;
      }
      candidate.strategic_relevance_source = "fallback";
    } else {
      candidate.strategic_relevance_source = "model";
    }

    candidate.strategic_relevance = result.classification;
    candidate.strategic_relevance_reason = result.reason;
    candidate.strategic_relevance_version = CLASSIFIER_VERSION;
    candidate.strategic_relevance_applied = true;

    // Write to cache (no per-item disk flush)
    const url = candidate.url || candidate.link || null;
    if (url) {
      writeEntry(
        cache,
        url,
        CLASSIFIER_VERSION,
        { classification: result.classification, reason: result.reason },
        { source: candidate.source_domain || null, topic: candidate.tag || null },
        null  // defer flush
      );
    }
  }, concurrency);

  // Tally classifications across all candidates
  for (const candidate of candidates) {
    const label = candidate.strategic_relevance;
    if (label === "HIGH") high++;
    else if (label === "LOW") low++;
    else medium++;
  }

  // Phase 3: Flush cache once
  if (cachePath && cache.size > 0) {
    flushCache(cache, cachePath, typeof log === "function" ? log : null);
  }

  const diagnostics = {
    total_classified: candidates.length,
    cache_hits: cacheHits,
    model_calls: modelCalls,
    fallbacks,
    errors,
    high,
    medium,
    low,
    elapsed_ms: Date.now() - startMs,
    classifier_version: CLASSIFIER_VERSION,
    model,
    usage,
  };

  return { candidates, diagnostics };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  CLASSIFIER_VERSION,
  buildClassificationPrompt,
  normalizeClassificationResult,
  classifySingle,
  runConcurrent,
  classifyCandidates,
};
