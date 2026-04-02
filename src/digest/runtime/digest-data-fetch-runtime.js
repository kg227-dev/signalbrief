"use strict";

const {
  getPerplexityProviderEnvOverrides,
  isStandardEvidenceResolverEnabled,
} = require("../../runtime/config-provider");
const { PERPLEXITY_PROVIDER_DEFAULTS } = require("../../platform/config/provider-defaults");
const { normalizeSourcePolicyDomain } = require("../../runtime/source-policy-registry-runtime");
const { parseRetryAfterMs } = require("../../entrypoints/digest-orchestrator-transport-runtime");
const { getTopicQueries, buildSearchRequest } = require("./digest-data-fetch-request-runtime");
const {
  enrichWithCitationUrls,
  buildSearchEvidenceCandidates,
  collectUniqueItems,
  shouldStopAttempts,
  parsePerplexityItems,
  classifyUrlShape,
  createConversionFunnel,
  mergeConversionFunnel,
  prioritizeItemsForRetention,
  articleAgeTooOld,
} = require("./digest-data-fetch-items-runtime");
const { createDigestSearchEvidenceResolverRuntime } = require("./digest-search-evidence-resolver-runtime");

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
  const env = getPerplexityProviderEnvOverrides();
  return {
    timeoutMs: toBoundedInt(
      env.timeoutMs || configured.timeoutMs,
      PERPLEXITY_PROVIDER_DEFAULTS.timeoutMs,
      { min: 1_000, max: 180_000 }
    ),
    retries: toBoundedInt(
      env.retries || configured.retries,
      PERPLEXITY_PROVIDER_DEFAULTS.retries,
      { min: 0, max: 8 }
    ),
    retryDelayMs: toBoundedInt(
      env.retryDelayMs || configured.retryDelayMs,
      PERPLEXITY_PROVIDER_DEFAULTS.retryDelayMs,
      { min: 100, max: 60_000 }
    ),
    retryStatusCodes: normalizeStatusCodes(
      env.retryStatusCodes || configured.retryStatusCodes,
      PERPLEXITY_PROVIDER_DEFAULTS.retryStatusCodes
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
  const articleResults = [];
  const preferredArticleResults = [];
  const seenDomains = new Set();
  const seenPreferred = new Set();
  const seenArticleUrls = new Set();
  const seenPreferredArticleUrls = new Set();
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
    if (classifyUrlShape(result?.url) === "article_url") {
      const url = String(result?.url || "").trim();
      if (url && !seenArticleUrls.has(url)) {
        seenArticleUrls.add(url);
        articleResults.push(result);
      }
      if (matchingPreferred && url && !seenPreferredArticleUrls.has(url)) {
        seenPreferredArticleUrls.add(url);
        preferredArticleResults.push(result);
      }
    }
  }
  return {
    search_result_domains: domains,
    preferred_search_result_domains: preferredHits,
    article_search_results: articleResults,
    preferred_article_search_results: preferredArticleResults,
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
    rate_limit_retry_after_ms: 0,
    search_result_domains: [],
    preferred_search_result_domains: [],
    preferred_search_result_hit_count: 0,
    conversion_funnel: createConversionFunnel(),
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
  target.rate_limit_retry_after_ms = Math.max(
    Number(target.rate_limit_retry_after_ms || 0),
    Number(extra?.rate_limit_retry_after_ms || 0)
  );
  target.search_result_domains = Array.from(new Set([
    ...(Array.isArray(target.search_result_domains) ? target.search_result_domains : []),
    ...(Array.isArray(extra?.search_result_domains) ? extra.search_result_domains : []),
  ]));
  target.preferred_search_result_domains = Array.from(new Set([
    ...(Array.isArray(target.preferred_search_result_domains) ? target.preferred_search_result_domains : []),
    ...(Array.isArray(extra?.preferred_search_result_domains) ? extra.preferred_search_result_domains : []),
  ]));
  target.preferred_search_result_hit_count += Number(extra?.preferred_search_result_hit_count || 0);
  target.conversion_funnel = mergeConversionFunnel(target.conversion_funnel, extra?.conversion_funnel);
  for (const [code, count] of Object.entries(extra?.status_counts || {})) {
    target.status_counts[code] = (target.status_counts[code] || 0) + Number(count || 0);
  }
  return target;
}

function accumulateSearchEvidenceShapes(funnel, citations, searchResults) {
  const target = funnel && typeof funnel === "object" ? funnel : createConversionFunnel();
  for (const citation of (Array.isArray(citations) ? citations : [])) {
    const shape = classifyUrlShape(citation);
    target.citation_count += 1;
    target.citation_url_shape_counts[shape] = (target.citation_url_shape_counts[shape] || 0) + 1;
  }
  for (const result of (Array.isArray(searchResults) ? searchResults : [])) {
    const url = result?.url;
    const shape = classifyUrlShape(url);
    target.search_result_count += 1;
    target.search_result_url_shape_counts[shape] = (target.search_result_url_shape_counts[shape] || 0) + 1;
    if (shape !== "article_url" && Array.isArray(target.samples?.search_result_non_article_urls) && target.samples.search_result_non_article_urls.length < 5) {
      target.samples.search_result_non_article_urls.push({
        url: String(url || "").trim() || null,
        shape,
        title: String(result?.title || "").trim() || null,
      });
    }
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

function dedupeResolvedEvidenceItems(items = [], normalizeUrlForDedup) {
  const out = [];
  const seen = new Set();
  for (const item of (Array.isArray(items) ? items : [])) {
    const normalizedUrl = typeof normalizeUrlForDedup === "function"
      ? String(normalizeUrlForDedup(item?.url || "") || "").trim()
      : String(item?.url || "").trim();
    const dedupeKey = normalizedUrl || `${String(item?.headline || "").trim().toLowerCase()}::${String(item?.published_date || "").trim()}`;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(item);
  }
  return out;
}

function createDigestDataFetchRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
    normalizeUrlForDedup,
    isFetchedItemEligible,
    searchEvidenceResolverRuntime,
  } = deps;
  const itemEligibilityFn = typeof isFetchedItemEligible === "function"
    ? isFetchedItemEligible
    : () => true;
  const evidenceResolverRuntime = searchEvidenceResolverRuntime
    && typeof searchEvidenceResolverRuntime.resolveSearchEvidenceUrls === "function"
    ? searchEvidenceResolverRuntime
    : createDigestSearchEvidenceResolverRuntime({ log });
  const evidenceResolverEnabled = deps?.enableSearchEvidenceResolver === true
    || (searchEvidenceResolverRuntime && typeof searchEvidenceResolverRuntime.resolveSearchEvidenceUrls === "function")
    || isStandardEvidenceResolverEnabled();

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
    reportedEvidenceDomains,
    officialEvidenceDomains,
    promptBias,
    maxAgeHours,
    officialFriendly,
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
        diagnostics.rate_limit_retry_after_ms = Math.max(
          Number(diagnostics.rate_limit_retry_after_ms || 0),
          parseRetryAfterMs(res?.headers?.["retry-after"])
        );
        log(`⚠️ Perplexity ${topic.tag} ${passName} request returned ${res.status}: ${String(errDetail).slice(0, 180)}`);
        continue;
      }
      diagnostics.successful_calls += 1;

      const citations = res.body?.citations || [];
      const searchResults = Array.isArray(res.body?.search_results) ? res.body.search_results : [];
      accumulateSearchEvidenceShapes(diagnostics.conversion_funnel, citations, searchResults);
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
          diagnostics.conversion_funnel.provider_empty_payload_count += 1;
          const errDetail = res.body?.error?.message || res.body?.error || res.body?.message || "no choices content";
          log(`⚠️ Perplexity returned empty payload for ${topic.tag} ${passName}: ${String(errDetail).slice(0, 180)}`);
        }
        const parsed = parsePerplexityItems(content);
        if (!Array.isArray(parsed)) {
          log(`⚠️ Perplexity payload for ${topic.tag} ${passName} was not an array`);
          continue;
        }
        diagnostics.conversion_funnel.parsed_item_count += parsed.length;
        for (const item of parsed) {
          const shape = classifyUrlShape(item?.url);
          diagnostics.conversion_funnel.provider_url_shape_counts[shape] = (diagnostics.conversion_funnel.provider_url_shape_counts[shape] || 0) + 1;
          if (shape !== "article_url" && Array.isArray(diagnostics.conversion_funnel.samples?.provider_non_article_urls) && diagnostics.conversion_funnel.samples.provider_non_article_urls.length < 5) {
            diagnostics.conversion_funnel.samples.provider_non_article_urls.push({
              headline: String(item?.headline || "").trim() || null,
              url: String(item?.url || "").trim() || null,
              shape,
            });
          }
        }

        const normalized = enrichWithCitationUrls(parsed, citations, searchResults, topic.tag, log, diagnostics.conversion_funnel)
          .map((item) => ({
            ...item,
            retrieved_at: retrievedAt,
            retrieval_pass: passName,
            retrieval_search_result_domains: searchEvidence.search_result_domains.slice(0, 10),
            retrieval_preferred_search_domains: searchEvidence.preferred_search_result_domains.slice(0, 10),
            preferred_source_available_in_search: searchEvidence.preferred_search_result_domains.length > 0
              && !searchEvidence.preferred_search_result_domains.some((candidate) => matchesDomain(item?.source || item?.url, candidate)),
          }));
        diagnostics.conversion_funnel.normalized_item_count += normalized.length;
        for (const item of normalized) {
          const shape = classifyUrlShape(item?.url);
          diagnostics.conversion_funnel.normalized_url_shape_counts[shape] = (diagnostics.conversion_funnel.normalized_url_shape_counts[shape] || 0) + 1;
        }
        const searchEvidenceCandidates = topic?.isCustom === true
          ? []
          : buildSearchEvidenceCandidates(searchEvidence.article_search_results, {
            preferredDomains: Array.isArray(preferredEvidenceDomains) ? preferredEvidenceDomains : [],
            trustedOnly: true,
            topicTag: topic.tag,
            retrievedAt,
            maxAgeHours,
            passName,
          });
        diagnostics.conversion_funnel.search_evidence_candidate_count += searchEvidenceCandidates.length;
        const prioritizedProviderItems = prioritizeItemsForRetention(normalized, {
          standardTopicMode: topic?.isCustom !== true,
          hasTrustedArticleEvidence: searchEvidenceCandidates.length > 0,
          preferredDomains: Array.isArray(preferredEvidenceDomains) ? preferredEvidenceDomains : [],
          officialFriendly: officialFriendly === true,
          maxAgeHours,
          diagnostics: diagnostics.conversion_funnel,
        });
        const providerArticleCount = prioritizedProviderItems.reduce((sum, item) => {
          return sum + (classifyUrlShape(item?.url) === "article_url" ? 1 : 0);
        }, 0);
        const providerListingCount = prioritizedProviderItems.reduce((sum, item) => {
          const shape = classifyUrlShape(item?.url);
          return sum + (shape === "listing_page" || shape === "tag_page" || shape === "search_page" || shape === "homepage" ? 1 : 0);
        }, 0);
        const providerFreshArticleCount = prioritizedProviderItems.reduce((sum, item) => {
          return sum + ((classifyUrlShape(item?.url) === "article_url" && !articleAgeTooOld(item, maxAgeHours)) ? 1 : 0);
        }, 0);
        const shouldRunEvidenceResolver = topic?.isCustom !== true
          && evidenceResolverEnabled
          && searchEvidence.article_search_results.length > 0
          && (
            prioritizedProviderItems.length <= 1
            || providerFreshArticleCount <= 0
            || searchEvidenceCandidates.length <= 1
            || (String(topic?.tag || "").trim().toUpperCase() === "TECHNOLOGY" && searchEvidence.article_search_results.length >= 3)
          );
        let resolvedEvidenceItems = [];
        if (shouldRunEvidenceResolver) {
          const resolvedEvidence = await evidenceResolverRuntime.resolveSearchEvidenceUrls(searchEvidence.article_search_results, {
            topicTag: topic.tag,
            preferredDomains: Array.isArray(preferredEvidenceDomains) ? preferredEvidenceDomains : [],
            reportedDomains: Array.isArray(reportedEvidenceDomains) ? reportedEvidenceDomains : [],
            officialDomains: Array.isArray(officialEvidenceDomains) ? officialEvidenceDomains : [],
            passName,
            retrievedAt,
            maxAgeHours,
          });
          resolvedEvidenceItems = dedupeResolvedEvidenceItems(resolvedEvidence?.items, normalizeUrlForDedup);
          diagnostics.conversion_funnel.search_evidence_resolver_attempt_count += Number(resolvedEvidence?.diagnostics?.attempt_count || 0);
          diagnostics.conversion_funnel.search_evidence_resolver_success_count += Number(resolvedEvidence?.diagnostics?.success_count || 0);
          diagnostics.conversion_funnel.search_evidence_resolver_fetch_failure_count += Number(resolvedEvidence?.diagnostics?.fetch_failure_count || 0);
          diagnostics.conversion_funnel.search_evidence_resolver_parse_failure_count += Number(resolvedEvidence?.diagnostics?.parse_failure_count || 0);
          diagnostics.conversion_funnel.search_evidence_resolver_non_article_drop_count += Number(resolvedEvidence?.diagnostics?.non_article_drop_count || 0);
          diagnostics.conversion_funnel.search_evidence_resolver_stale_count += Number(resolvedEvidence?.diagnostics?.stale_count || 0);
          for (const failedUrl of (Array.isArray(resolvedEvidence?.diagnostics?.failed_urls) ? resolvedEvidence.diagnostics.failed_urls : [])) {
            if (Array.isArray(diagnostics.conversion_funnel.samples?.search_evidence_resolver_failures)
              && diagnostics.conversion_funnel.samples.search_evidence_resolver_failures.length < 5) {
              diagnostics.conversion_funnel.samples.search_evidence_resolver_failures.push(failedUrl);
            }
          }
        }
        const prioritizedEvidenceItems = prioritizeItemsForRetention(
          dedupeResolvedEvidenceItems([...resolvedEvidenceItems, ...searchEvidenceCandidates], normalizeUrlForDedup),
          {
            standardTopicMode: topic?.isCustom !== true,
            hasTrustedArticleEvidence: searchEvidenceCandidates.length > 0 || resolvedEvidenceItems.length > 0,
            preferredDomains: Array.isArray(preferredEvidenceDomains) ? preferredEvidenceDomains : [],
            officialFriendly: officialFriendly === true,
            maxAgeHours,
            diagnostics: diagnostics.conversion_funnel,
          }
        );
        const retainedBeforeProvider = collected.length;
        const staleBeforeProvider = diagnostics.conversion_funnel.stale_item_count;
        const evidenceFirst = topic?.isCustom !== true
          && prioritizedEvidenceItems.length > 0
          && (
            prioritizedProviderItems.length === 0
            || providerFreshArticleCount <= 0
            || providerListingCount > providerArticleCount
            || String(topic?.tag || "").trim().toUpperCase() === "TECHNOLOGY"
          );
        let evidenceFirstRetainedCount = 0;
        if (evidenceFirst) {
          const retainedBeforeEvidenceFirst = collected.length;
          collectUniqueItems(prioritizedEvidenceItems, seenHeadline, seenUrl, collected, normalizeUrlForDedup, {
            maxAgeHours,
            requireVerifiedPublishedDate: true,
            diagnostics: diagnostics.conversion_funnel,
          });
          evidenceFirstRetainedCount = Math.max(0, collected.length - retainedBeforeEvidenceFirst);
        }
        collectUniqueItems(prioritizedProviderItems, seenHeadline, seenUrl, collected, normalizeUrlForDedup, {
          maxAgeHours,
          requireVerifiedPublishedDate: true,
          diagnostics: diagnostics.conversion_funnel,
        });
        const retainedAfterProvider = collected.length;
        const staleProviderDelta = diagnostics.conversion_funnel.stale_item_count - staleBeforeProvider;
        const retainedProviderDelta = retainedAfterProvider - retainedBeforeProvider;
        const shouldRescueFromEvidence = topic?.isCustom !== true
          && prioritizedEvidenceItems.length > 0
          && !evidenceFirst
          && (retainedProviderDelta <= 1 || staleProviderDelta > 0 || providerArticleCount <= 0);
        if (shouldRescueFromEvidence) {
          const retainedBeforeEvidence = collected.length;
          collectUniqueItems(prioritizedEvidenceItems, seenHeadline, seenUrl, collected, normalizeUrlForDedup, {
            maxAgeHours,
            requireVerifiedPublishedDate: true,
            diagnostics: diagnostics.conversion_funnel,
          });
          diagnostics.conversion_funnel.search_evidence_retained_count += Math.max(0, collected.length - retainedBeforeEvidence);
        } else if (evidenceFirst) {
          diagnostics.conversion_funnel.search_evidence_retained_count += evidenceFirstRetainedCount;
        }
      } catch (err) {
        diagnostics.conversion_funnel.parse_error_count += 1;
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
    const reportedDomains = Array.isArray(retrievalPlan.reported_domains)
      ? retrievalPlan.reported_domains.map((domain) => String(domain || "").trim()).filter(Boolean)
      : [];
    const officialDomains = Array.isArray(retrievalPlan.official_domains)
      ? retrievalPlan.official_domains.map((domain) => String(domain || "").trim()).filter(Boolean)
      : [];
    const broadOnly = retrievalPlan.broad_only === true;
    const allowBroadFallback = retrievalPlan.allow_broad_fallback !== false;
    const preferredEnabled = preferredDomains.length > 0 && !broadOnly;
    const thinThreshold = Math.max(1, Number(retrievalPlan.thin_item_threshold || 2));
    const resolvedMaxAgeHours = Number(opts?.maxAgeHours ?? CONFIG?.digest?.maxArticleAgeHours ?? 48);
    const maxAgeHours = Number.isFinite(resolvedMaxAgeHours)
      ? Math.min(48, Math.max(1, resolvedMaxAgeHours))
      : 48;
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
      conversion_funnel: createConversionFunnel(),
      freshness_max_age_hours: maxAgeHours,
      require_verified_published_date: true,
    };

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
        reportedEvidenceDomains: reportedDomains,
        officialEvidenceDomains: officialDomains,
        promptBias: buildPreferredPromptBias(preferredDomains),
        maxAgeHours,
        officialFriendly: retrievalPlan?.official_friendly === true,
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
        reportedEvidenceDomains: reportedDomains,
        officialEvidenceDomains: officialDomains,
        promptBias: buildBroadFallbackPromptBias(retrievalPlan),
        maxAgeHours,
        officialFriendly: retrievalPlan?.official_friendly === true,
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
