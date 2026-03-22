"use strict";

const { normalizeSourcePolicyDomain } = require("../../runtime/source-policy-registry-runtime");
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

function matchesDomain(sourceDomain, candidateDomain) {
  const source = normalizeSourcePolicyDomain(sourceDomain);
  const candidate = normalizeSourcePolicyDomain(candidateDomain);
  if (!source || !candidate) return false;
  return source === candidate || source.endsWith(`.${candidate}`);
}

function collectSearchResultEvidence(searchResults, preferredDomains = []) {
  const domains = [];
  const preferredHits = [];
  const seenDomains = new Set();
  const seenPreferred = new Set();
  for (const result of (Array.isArray(searchResults) ? searchResults : [])) {
    let normalized = "";
    try {
      normalized = normalizeSourcePolicyDomain(new URL(String(result?.url || "")).hostname);
    } catch {
      normalized = "";
    }
    if (!normalized) continue;
    if (!seenDomains.has(normalized)) {
      seenDomains.add(normalized);
      domains.push(normalized);
    }
    const matchingPreferred = (Array.isArray(preferredDomains) ? preferredDomains : []).find((candidate) => matchesDomain(normalized, candidate));
    if (matchingPreferred) {
      const preferredNormalized = normalizeSourcePolicyDomain(matchingPreferred);
      if (preferredNormalized && !seenPreferred.has(preferredNormalized)) {
        seenPreferred.add(preferredNormalized);
        preferredHits.push(preferredNormalized);
      }
    }
  }
  return {
    search_result_domains: domains,
    preferred_search_result_domains: preferredHits,
  };
}

function createPassDiagnostics(maxAttempts) {
  return {
    attempts_planned: maxAttempts,
    attempts_executed: 0,
    successful_calls: 0,
    failed_calls: 0,
    transport_errors: 0,
    status_counts: {},
    degraded: false,
    last_error: null,
    search_result_domains: [],
    preferred_search_result_domains: [],
    preferred_search_result_hit_count: 0,
  };
}

function mergePassDiagnostics(target, extra) {
  target.attempts_planned += Number(extra?.attempts_planned || 0);
  target.attempts_executed += Number(extra?.attempts_executed || 0);
  target.successful_calls += Number(extra?.successful_calls || 0);
  target.failed_calls += Number(extra?.failed_calls || 0);
  target.transport_errors += Number(extra?.transport_errors || 0);
  target.degraded = target.degraded || extra?.degraded === true;
  target.last_error = extra?.last_error || target.last_error || null;
  target.search_result_domains = Array.from(new Set([
    ...(Array.isArray(target.search_result_domains) ? target.search_result_domains : []),
    ...(Array.isArray(extra?.search_result_domains) ? extra.search_result_domains : []),
  ]));
  target.preferred_search_result_domains = Array.from(new Set([
    ...(Array.isArray(target.preferred_search_result_domains) ? target.preferred_search_result_domains : []),
    ...(Array.isArray(extra?.preferred_search_result_domains) ? extra.preferred_search_result_domains : []),
  ]));
  target.preferred_search_result_hit_count += Number(extra?.preferred_search_result_hit_count || 0);
  for (const [code, count] of Object.entries(extra?.status_counts || {})) {
    target.status_counts[code] = (target.status_counts[code] || 0) + Number(count || 0);
  }
  return target;
}

function buildPreferredPromptBias(preferredDomains) {
  const domains = Array.isArray(preferredDomains) ? preferredDomains.filter(Boolean) : [];
  if (domains.length === 0) return "";
  return "Prefer direct reporting or official primary documents from the provided preferred domains when they are close substitutes.";
}

function buildBroadFallbackPromptBias(retrievalPlan = {}) {
  const officialFriendly = retrievalPlan?.official_friendly === true;
  if (officialFriendly) {
    return "If preferred-domain coverage is thin, return the best available official documents, specialist trade reporting, or original reporting. Avoid derivative rewrites or press release reposts when better direct sources exist.";
  }
  return "If preferred-domain coverage is thin, return the best available specialist trade or original reporting. Avoid derivative rewrites or press release reposts when better direct sources exist.";
}

function createDigestDataFetchRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
    normalizeUrlForDedup,
    isFetchedItemEligible,
  } = deps;
  const itemEligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;

  async function runFetchPass({
    topic,
    queries,
    searchModel,
    providerPolicy,
    retrievedAt,
    seenHeadline,
    seenUrl,
    collected,
    passName,
    searchDomainFilter,
    preferredEvidenceDomains,
    promptBias,
    maxAgeHours,
  }) {
    const maxAttempts = Math.min(3, queries.length);
    const diagnostics = createPassDiagnostics(maxAttempts);
    let apiCalls = 0;

    for (let idx = 0; idx < maxAttempts; idx++) {
      const query = queries[idx];
      diagnostics.attempts_executed += 1;
      if (idx > 0) log(`↳ ${topic.tag} ${passName} fallback query ${idx + 1}/${maxAttempts}`);

      let res;
      try {
        res = await httpsPostWithRetry(
          "api.perplexity.ai",
          "/chat/completions",
          {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CONFIG.keys.perplexity}`,
          },
          buildSearchRequest(topic.tag, query, searchModel, {
            searchDomainFilter,
            promptBias,
          }),
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
        log(`⚠️ Perplexity ${topic.tag} ${passName} query failed (${idx + 1}/${maxAttempts}): ${message}`);
        continue;
      }

      if (res.status >= 400) {
        const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
        diagnostics.failed_calls += 1;
        diagnostics.degraded = true;
        diagnostics.last_error = String(errDetail).slice(0, 180);
        incrementStatusCount(diagnostics.status_counts, res.status);
        log(`⚠️ Perplexity ${topic.tag} ${passName} request returned ${res.status}: ${String(errDetail).slice(0, 180)}`);
        continue;
      }
      diagnostics.successful_calls += 1;

      const citations = res.body?.citations || [];
      const searchResults = Array.isArray(res.body?.search_results) ? res.body.search_results : [];
      const searchEvidence = collectSearchResultEvidence(
        searchResults,
        Array.isArray(preferredEvidenceDomains) ? preferredEvidenceDomains : searchDomainFilter
      );
      diagnostics.search_result_domains = Array.from(new Set([
        ...diagnostics.search_result_domains,
        ...searchEvidence.search_result_domains,
      ]));
      diagnostics.preferred_search_result_domains = Array.from(new Set([
        ...diagnostics.preferred_search_result_domains,
        ...searchEvidence.preferred_search_result_domains,
      ]));
      if (searchEvidence.preferred_search_result_domains.length > 0) {
        diagnostics.preferred_search_result_hit_count += 1;
      }

      try {
        const content = res.body?.choices?.[0]?.message?.content || "[]";
        if (!res.body?.choices?.[0]?.message?.content) {
          const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || "no choices content";
          log(`⚠️ Perplexity returned empty payload for ${topic.tag} ${passName}: ${String(errDetail).slice(0, 180)}`);
        }
        const parsed = parsePerplexityItems(content);
        if (!Array.isArray(parsed)) {
          log(`⚠️ Perplexity payload for ${topic.tag} ${passName} was not an array`);
          continue;
        }

        const normalized = enrichWithCitationUrls(parsed, citations, searchResults, topic.tag, log)
          .map((item) => ({
            ...item,
            retrieved_at: retrievedAt,
            retrieval_pass: passName,
            retrieval_search_result_domains: searchEvidence.search_result_domains.slice(0, 10),
            retrieval_preferred_search_domains: searchEvidence.preferred_search_result_domains.slice(0, 10),
            preferred_source_available_in_search: searchEvidence.preferred_search_result_domains.length > 0
              && !searchEvidence.preferred_search_result_domains.some((candidate) => matchesDomain(item?.source || item?.url, candidate)),
          }));
        collectUniqueItems(normalized, seenHeadline, seenUrl, collected, normalizeUrlForDedup, {
          maxAgeHours,
          requireVerifiedPublishedDate: true,
        });
      } catch (err) {
        log(`Parse error for ${topic.tag} ${passName}: ${err.message}`);
      }

      if (shouldStopAttempts(topic, collected)) break;
    }

    return {
      apiCalls,
      diagnostics,
    };
  }

  async function fetchTopicNews(topic, opts = {}) {
    const searchModel = opts.searchModel || "sonar";
    const providerPolicy = resolvePerplexityResilience(CONFIG?.digest);
    const retrievedAt = new Date().toISOString();
    log(`Fetching: ${topic.tag}`);
    const queries = getTopicQueries(topic);
    const collected = [];
    const seenUrl = new Set();
    const seenHeadline = new Set();
    let apiCalls = 0;
    const retrievalPlan = opts.retrievalPlan && typeof opts.retrievalPlan === "object"
      ? opts.retrievalPlan
      : {};
    const preferredDomains = Array.isArray(retrievalPlan.preferred_domains)
      ? retrievalPlan.preferred_domains.map((domain) => String(domain || "").trim()).filter(Boolean)
      : [];
    const broadOnly = retrievalPlan.broad_only === true;
    const allowBroadFallback = retrievalPlan.allow_broad_fallback !== false;
    const preferredEnabled = preferredDomains.length > 0 && !broadOnly;
    const thinThreshold = Math.max(1, Number(retrievalPlan.thin_item_threshold || 2));
    const diagnostics = {
      provider: "perplexity",
      retrieval_mode: preferredEnabled
        ? (allowBroadFallback ? "preferred_allowlist_then_broad" : "preferred_allowlist_only")
        : "broad_only",
      timeout_ms: providerPolicy.timeoutMs,
      retries: providerPolicy.retries,
      retry_status_codes: providerPolicy.retryStatusCodes.slice(),
      attempts_planned: 0,
      attempts_executed: 0,
      successful_calls: 0,
      failed_calls: 0,
      transport_errors: 0,
      status_counts: {},
      degraded: false,
      last_error: null,
      preferred_domains_used: preferredDomains.slice(),
      preferred_fallback_triggered: false,
      preferred_pass_item_count: 0,
      broad_pass_item_count: 0,
      preferred_domains_count: preferredDomains.length,
      preferred_candidate_count: 0,
      non_preferred_candidate_count: 0,
      final_selected_preferred_count: 0,
      preferred_displaced_weak_count: 0,
      search_result_domains: [],
      preferred_search_result_domains: [],
      preferred_search_result_hit_count: 0,
      preferred_search_results_without_preferred_item: false,
      freshness_max_age_hours: Number(CONFIG?.digest?.maxArticleAgeHours || 48),
      require_verified_published_date: true,
    };
    const maxAgeHours = Number(CONFIG?.digest?.maxArticleAgeHours || 48);

    if (!queries.length) {
      return { items: [], apiCalls: 0, diagnostics };
    }

    if (preferredEnabled) {
      const preferredPass = await runFetchPass({
        topic,
        queries,
        searchModel,
        providerPolicy,
        retrievedAt,
        seenHeadline,
        seenUrl,
        collected,
        passName: "preferred",
        searchDomainFilter: preferredDomains,
        preferredEvidenceDomains: preferredDomains,
        promptBias: buildPreferredPromptBias(preferredDomains),
        maxAgeHours,
      });
      apiCalls += preferredPass.apiCalls;
      mergePassDiagnostics(diagnostics, preferredPass.diagnostics);
      diagnostics.preferred_pass_item_count = collected.length;
    }

    const eligibleCountAfterPreferred = collected.filter((item) => itemEligibilityFn(item) !== false).length;
    const needsBroadFallback = broadOnly || (allowBroadFallback && (!preferredEnabled || eligibleCountAfterPreferred < thinThreshold));
    if (preferredEnabled && needsBroadFallback) diagnostics.preferred_fallback_triggered = true;

    if (needsBroadFallback) {
      const beforeBroadCount = collected.length;
      const broadPass = await runFetchPass({
        topic,
        queries,
        searchModel,
        providerPolicy,
        retrievedAt,
        seenHeadline,
        seenUrl,
        collected,
        passName: "broad",
        searchDomainFilter: [],
        preferredEvidenceDomains: preferredDomains,
        promptBias: buildBroadFallbackPromptBias(retrievalPlan),
        maxAgeHours,
      });
      apiCalls += broadPass.apiCalls;
      mergePassDiagnostics(diagnostics, broadPass.diagnostics);
      diagnostics.broad_pass_item_count = Math.max(0, collected.length - beforeBroadCount);
    }
    const finalHasPreferredItem = collected.some((item) =>
      (Array.isArray(item?.retrieval_preferred_search_domains) ? item.retrieval_preferred_search_domains : [])
        .some((candidate) => matchesDomain(item?.source || item?.url, candidate))
    );
    const preferredCandidateCount = collected.filter((item) => (
      Array.isArray(preferredDomains) && preferredDomains.some((candidate) => matchesDomain(item?.source || item?.url, candidate))
    )).length;
    diagnostics.preferred_candidate_count = preferredCandidateCount;
    diagnostics.non_preferred_candidate_count = Math.max(0, collected.length - preferredCandidateCount);
    diagnostics.preferred_search_results_without_preferred_item = diagnostics.preferred_search_result_domains.length > 0 && !finalHasPreferredItem;

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
