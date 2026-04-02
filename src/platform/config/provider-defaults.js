"use strict";

const PERPLEXITY_PROVIDER_DEFAULTS = Object.freeze({
  timeoutMs: 25_000,
  retries: 2,
  retryDelayMs: 1_200,
  retryStatusCodes: Object.freeze([429, 500, 502, 503, 504]),
  maxConcurrentFetches: 4,
});

const ANTHROPIC_PROVIDER_DEFAULTS = Object.freeze({
  timeoutMs: 30_000,
  retries: 2,
  retryDelayMs: 1_200,
  retryStatusCodes: Object.freeze([429, 500, 502, 503, 504]),
});

const SEARCH_EVIDENCE_RESOLVER_DEFAULTS = Object.freeze({
  timeoutMs: 12_000,
  maxFetchBytes: 256_000,
  standardMaxUrls: 3,
  technologyMaxUrls: 5,
});

const STANDARD_TOPIC_BROKER_DEFAULTS = Object.freeze({
  timeoutMs: 12_000,
  maxBytes: 512_000,
});

const FETCH_ORCHESTRATOR_DEFAULTS = Object.freeze({
  rateLimitCooldownMs: 1_250,
  rateLimitMaxCooldownMs: 20_000,
});

module.exports = {
  PERPLEXITY_PROVIDER_DEFAULTS,
  ANTHROPIC_PROVIDER_DEFAULTS,
  SEARCH_EVIDENCE_RESOLVER_DEFAULTS,
  STANDARD_TOPIC_BROKER_DEFAULTS,
  FETCH_ORCHESTRATOR_DEFAULTS,
};
