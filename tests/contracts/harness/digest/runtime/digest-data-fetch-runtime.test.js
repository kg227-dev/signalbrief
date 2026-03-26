"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-fetch-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestDataFetchRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);
const RECENT_PUBLISHED_DATE = new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString();
const STALE_PUBLISHED_DATE = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();

function createResolverRuntime(items = [], diagnostics = {}) {
  return {
    resolveSearchEvidenceUrls: async () => ({
      items: Array.isArray(items) ? items : [],
      diagnostics: {
        attempt_count: 0,
        success_count: Array.isArray(items) ? items.length : 0,
        fetch_failure_count: 0,
        parse_failure_count: 0,
        non_article_drop_count: 0,
        stale_count: 0,
        failed_urls: [],
        ...diagnostics,
      },
    }),
  };
}

async function testCustomFallbackFlowWithProviderPolicy() {
  const callOpts = [];
  let calls = 0;
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {
        providerResilience: {
          perplexity: {
            timeoutMs: 4321,
            retries: 1,
            retryDelayMs: 5,
            retryStatusCodes: [429, 503],
          },
        },
      },
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async (_host, _path, _headers, _payload, opts) => {
      callOpts.push(opts);
      calls += 1;
      if (calls === 1) {
        return { status: 503, body: { error: { message: "unavailable" } } };
      }
      return {
        status: 200,
        body: {
          citations: ["https://example.com/story"],
          choices: [{
            message: {
              content: JSON.stringify([
                { headline: "Custom story", summary: "Summary", url: "https://example.com/story", published_date: RECENT_PUBLISHED_DATE },
              ]),
            },
          }],
        },
      };
    },
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "GLP-1",
    isCustom: true,
    queries: ["q1", "q2"],
  });
  assert.strictEqual(result.apiCalls, 2);
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].tag, "GLP-1");
  assert.strictEqual(result.diagnostics.degraded, true);
  assert.strictEqual(result.diagnostics.failed_calls, 1);
  assert.strictEqual(result.diagnostics.successful_calls, 1);
  assert.strictEqual(result.diagnostics.status_counts[503], 1);
  assert.strictEqual(result.diagnostics.attempts_executed, 2);
  assert.deepStrictEqual(callOpts[0].retryStatusCodes, [429, 503]);
  assert.ok(callOpts.every((opts) => opts.timeoutMs === 4321));
}

async function testTransportErrorDiagnostics() {
  const errorRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: { providerResilience: { perplexity: { timeoutMs: 3000, retries: 0 } } },
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async () => {
      throw new Error("HTTP timeout after 3s");
    },
  });

  const result = await errorRuntime.fetchTopicNews({
    tag: "AI×TECH",
    queries: ["q1"],
  });
  assert.strictEqual(result.apiCalls, 0);
  assert.strictEqual(result.items.length, 0);
  assert.strictEqual(result.diagnostics.degraded, true);
  assert.strictEqual(result.diagnostics.transport_errors, 1);
  assert.strictEqual(result.diagnostics.failed_calls, 1);
}

async function testStandardTopicsUseFallbackQueriesForThinPools() {
  let calls = 0;
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 200,
          body: {
            citations: ["https://example.com/one"],
            choices: [{
              message: {
                content: JSON.stringify([
                  { headline: "Standard story one", summary: "Summary", url: "https://example.com/one", published_date: RECENT_PUBLISHED_DATE },
                ]),
              },
            }],
          },
        };
      }
      return {
        status: 200,
        body: {
          citations: ["https://example.com/two"],
          choices: [{
            message: {
              content: JSON.stringify([
                  { headline: "Standard story two", summary: "Summary", url: "https://example.com/two", published_date: RECENT_PUBLISHED_DATE },
              ]),
            },
          }],
        },
      };
    },
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "AI×TECH",
    queries: ["q1", "q2"],
  });

  assert.strictEqual(calls, 2);
  assert.strictEqual(result.apiCalls, 2);
  assert.strictEqual(result.items.length, 2);
}

async function testPreferredDomainPassUsesSearchFilterAndBroadFallback() {
  const payloads = [];
  let calls = 0;
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    isFetchedItemEligible: (item) => item?.source !== "blocked.example",
    httpsPostWithRetry: async (_host, _path, _headers, payload) => {
      payloads.push(payload);
      calls += 1;
      if (calls === 1) {
        return {
          status: 200,
          body: {
            citations: ["https://preferred.example/story"],
            search_results: [
              { title: "Preferred source result", url: "https://reuters.com/technology/ai-infra" },
              { title: "Other result", url: "https://theinformation.com/articles/ai-infra" },
            ],
            choices: [{
              message: {
                content: JSON.stringify([
                  {
                    headline: "Preferred source story",
                    summary: "Summary",
                    source: "blocked.example",
                    url: "https://preferred.example/story",
                    published_date: RECENT_PUBLISHED_DATE,
                  },
                ]),
              },
            }],
          },
        };
      }
      return {
        status: 200,
        body: {
          citations: ["https://broad.example/story"],
          search_results: [
            { title: "Preferred result still available", url: "https://reuters.com/technology/ai-infra-2" },
            { title: "Broad result", url: "https://broad.example/story" },
          ],
          choices: [{
            message: {
              content: JSON.stringify([
                  {
                    headline: "Broad source story",
                    summary: "Summary",
                    source: "reuters.com",
                    url: "https://broad.example/story",
                    published_date: RECENT_PUBLISHED_DATE,
                  },
                ]),
              },
          }],
        },
      };
    },
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "TECHNOLOGY",
    queries: ["q1"],
  }, {
    retrievalPlan: {
      preferred_domains: ["theinformation.com", "reuters.com"],
      thin_item_threshold: 2,
    },
  });

  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(payloads[0].search_domain_filter, ["theinformation.com", "reuters.com"]);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payloads[1], "search_domain_filter"), false);
  assert.ok(payloads[1].messages[1].content.includes("Avoid derivative rewrites or press release reposts"));
  assert.strictEqual(result.diagnostics.preferred_fallback_triggered, true);
  assert.strictEqual(result.diagnostics.preferred_pass_item_count, 1);
  assert.strictEqual(result.diagnostics.broad_pass_item_count, 1);
  assert.strictEqual(result.diagnostics.preferred_domains_count, 2);
  assert.strictEqual(result.diagnostics.preferred_candidate_count, 1);
  assert.strictEqual(result.diagnostics.non_preferred_candidate_count, 1);
  assert.deepStrictEqual(result.diagnostics.preferred_search_result_domains, ["reuters.com", "theinformation.com"]);
  assert.strictEqual(result.diagnostics.preferred_search_result_hit_count, 2);
  assert.strictEqual(result.diagnostics.preferred_search_results_without_preferred_item, false);
  assert.strictEqual(result.diagnostics.conversion_funnel.search_result_count, 4);
  assert.strictEqual(result.diagnostics.conversion_funnel.parsed_item_count, 2);
  assert.strictEqual(result.diagnostics.conversion_funnel.provider_url_shape_counts.article_url, 2);
  assert.strictEqual(result.diagnostics.conversion_funnel.normalized_item_count, 2);
  assert.strictEqual(result.diagnostics.conversion_funnel.retained_item_count, 2);
  assert.strictEqual(result.items[0].retrieval_pass, "preferred");
  assert.strictEqual(result.items[0].preferred_source_available_in_search, true);
  assert.deepStrictEqual(result.items[0].retrieval_preferred_search_domains, ["reuters.com", "theinformation.com"]);
  assert.strictEqual(result.items[1].retrieval_pass, "broad");
  assert.deepStrictEqual(result.items[1].retrieval_preferred_search_domains, ["reuters.com"]);
}

async function testPreferredOnlyModeSkipsBroadFallback() {
  let calls = 0;
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    isFetchedItemEligible: () => false,
    httpsPostWithRetry: async (_host, _path, _headers, payload) => {
      calls += 1;
      assert.deepStrictEqual(payload.search_domain_filter, ["reuters.com"]);
      return {
        status: 200,
        body: {
          citations: ["https://preferred.example/story"],
          search_results: [{ title: "Preferred result", url: "https://reuters.com/markets/story" }],
          choices: [{
            message: {
              content: JSON.stringify([
                { headline: "Preferred only story", summary: "Summary", source: "reuters.com", url: "https://preferred.example/story", published_date: RECENT_PUBLISHED_DATE },
              ]),
            },
          }],
        },
      };
    },
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "MARKETS",
    queries: ["q1"],
  }, {
    retrievalPlan: {
      preferred_domains: ["reuters.com"],
      allow_broad_fallback: false,
    },
  });

  assert.strictEqual(calls, 1);
  assert.strictEqual(result.diagnostics.retrieval_mode, "preferred_allowlist_only");
  assert.strictEqual(result.diagnostics.preferred_fallback_triggered, false);
  assert.strictEqual(result.diagnostics.broad_pass_item_count, 0);
}

async function testBroadOnlyModeSkipsSearchFilter() {
  let calls = 0;
  const payloads = [];
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async (_host, _path, _headers, payload) => {
      payloads.push(payload);
      calls += 1;
      return {
        status: 200,
        body: {
          citations: ["https://broad.example/story"],
          search_results: [{ title: "Preferred result", url: "https://wsj.com/articles/story-1" }],
          choices: [{
            message: {
              content: JSON.stringify([
                { headline: "Broad only story", summary: "Summary", source: "wsj.com", url: "https://broad.example/story", published_date: RECENT_PUBLISHED_DATE },
              ]),
            },
          }],
        },
      };
    },
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "STRATEGY",
    queries: ["q1"],
  }, {
    retrievalPlan: {
      preferred_domains: ["wsj.com"],
      broad_only: true,
    },
  });

  assert.strictEqual(calls, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(payloads[0], "search_domain_filter"), false);
  assert.strictEqual(result.diagnostics.retrieval_mode, "broad_only");
  assert.strictEqual(result.diagnostics.broad_pass_item_count, 1);
  assert.deepStrictEqual(result.diagnostics.preferred_search_result_domains, ["wsj.com"]);
}

async function testFetchReplacesUnsupportedSlugWithSingleEvidenceUrl() {
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async () => ({
      status: 200,
      body: {
        citations: ["https://www.wsj.com/articles/actual-blackstone-deal-4912d9ee"],
        choices: [{
          message: {
            content: JSON.stringify([
              {
                headline: "Blackstone exits energy portfolio in $15 billion deal",
                summary: "Summary",
                source: "wsj.com",
                url: "https://www.wsj.com/articles/blackstone-exits-energy-portfolio-15-billion-deal-3f8d2a1c",
                published_date: RECENT_PUBLISHED_DATE,
              },
            ]),
          },
        }],
      },
    }),
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "PE×M&A",
    queries: ["q1"],
  });

  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].url, "https://www.wsj.com/articles/actual-blackstone-deal-4912d9ee");
}

async function testFetchDropsAmbiguousSameHostMismatch() {
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async () => ({
      status: 200,
      body: {
        citations: [
          "https://www.wsj.com/articles/first-energy-deal-11111111",
          "https://www.wsj.com/articles/second-energy-deal-22222222",
        ],
        choices: [{
          message: {
            content: JSON.stringify([
              {
                headline: "Blackstone exits energy portfolio in $15 billion deal",
                summary: "Summary",
                source: "wsj.com",
                url: "https://www.wsj.com/articles/blackstone-exits-energy-portfolio-15-billion-deal-3f8d2a1c",
                published_date: RECENT_PUBLISHED_DATE,
              },
            ]),
          },
        }],
      },
    }),
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "PE×M&A",
    queries: ["q1"],
  });

  assert.strictEqual(result.items.length, 0);
}

async function testStandardTopicsDoNotRetainThinSearchMetadataWithoutResolvedEvidence() {
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async () => ({
      status: 200,
      body: {
        citations: [],
        search_results: [
          {
            title: "AI chip demand is reshaping data center strategy | TechCrunch",
            url: "https://techcrunch.com/2026/03/22/ai-chip-demand-is-reshaping-data-center-strategy/",
          },
          {
            title: "Tag page",
            url: "https://techcrunch.com/tag/ai/",
          },
        ],
        choices: [{
          message: {
            content: JSON.stringify([]),
          },
        }],
      },
    }),
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "TECHNOLOGY",
    queries: ["q1"],
  }, {
    retrievalPlan: {
      preferred_domains: ["techcrunch.com", "theinformation.com"],
      thin_item_threshold: 2,
      official_friendly: false,
    },
  });

  assert.strictEqual(result.items.length, 0);
  assert.strictEqual(result.diagnostics.conversion_funnel.search_evidence_candidate_count, 0);
  assert.strictEqual(result.diagnostics.conversion_funnel.search_evidence_retained_count, 0);
}

async function testStandardTopicsResolveTrustedEvidenceUrlsDirectlyWhenSearchMetadataIsThin() {
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime([
      {
        headline: "AI infrastructure demand is forcing data center redesigns",
        summary: "Summary",
        source: "techcrunch.com",
        source_domain: "techcrunch.com",
        url: "https://techcrunch.com/2026/03/22/ai-infrastructure-demand-is-forcing-data-center-redesigns/",
        retrieval_original_url: "https://techcrunch.com/2026/03/22/ai-infrastructure-demand-is-forcing-data-center-redesigns/",
        published_date: RECENT_PUBLISHED_DATE,
        tag: "TECHNOLOGY",
        retrieved_at: RECENT_PUBLISHED_DATE,
        retrieval_pass: "preferred_evidence_resolver",
        retrieval_from_search_evidence: true,
        retrieval_from_evidence_resolver: true,
      },
    ], {
      attempt_count: 1,
      success_count: 1,
    }),
    httpsPostWithRetry: async () => ({
      status: 200,
      body: {
        citations: [],
        search_results: [
          {
            title: "AI infrastructure demand is forcing data center redesigns | TechCrunch",
            url: "https://techcrunch.com/2026/03/22/ai-infrastructure-demand-is-forcing-data-center-redesigns/",
          },
        ],
        choices: [{
          message: {
            content: JSON.stringify([]),
          },
        }],
      },
    }),
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "TECHNOLOGY",
    queries: ["q1"],
  }, {
    retrievalPlan: {
      preferred_domains: ["theinformation.com"],
      reported_domains: ["techcrunch.com", "theinformation.com"],
      official_domains: ["nist.gov", "bis.gov"],
      thin_item_threshold: 2,
      official_friendly: true,
    },
  });

  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].retrieval_from_evidence_resolver, true);
  assert.strictEqual(result.items[0].url, "https://techcrunch.com/2026/03/22/ai-infrastructure-demand-is-forcing-data-center-redesigns/");
  assert.strictEqual(result.diagnostics.conversion_funnel.search_evidence_resolver_attempt_count, 2);
  assert.strictEqual(result.diagnostics.conversion_funnel.search_evidence_resolver_success_count, 2);
  assert.strictEqual(result.diagnostics.conversion_funnel.search_evidence_retained_count, 1);
}

async function testStandardTopicsPreferFreshTrustedSearchEvidenceOverStaleProviderItems() {
  const fetchRuntime = createDigestDataFetchRuntime({
    CONFIG: {
      keys: { perplexity: "test-key" },
      digest: {},
    },
    log: () => {},
    normalizeUrlForDedup: (value) => String(value || ""),
    searchEvidenceResolverRuntime: createResolverRuntime(),
    httpsPostWithRetry: async () => ({
      status: 200,
      body: {
        citations: ["https://www.healthcaredive.com/news/sutter-allina-health-form-26-billion-nonprofit-system/815028/"],
        search_results: [
          {
            title: "CMS proposes new payment model for hospitals | CMS",
            url: "https://www.cms.gov/newsroom/fact-sheets/2026-03-21-hospital-payment-model",
            date: RECENT_PUBLISHED_DATE,
          },
        ],
        choices: [{
          message: {
            content: JSON.stringify([
              {
                headline: "Sutter, Allina Health to form $26B nonprofit system",
                summary: "Summary",
                source: "healthcaredive.com",
                url: "https://www.healthcaredive.com/news/sutter-allina-health-form-26-billion-nonprofit-system/815028/",
                published_date: STALE_PUBLISHED_DATE,
              },
            ]),
          },
        }],
      },
    }),
  });

  const result = await fetchRuntime.fetchTopicNews({
    tag: "HEALTHCARE",
    queries: ["q1"],
  }, {
    retrievalPlan: {
      preferred_domains: ["cms.gov", "healthcaredive.com"],
      thin_item_threshold: 2,
      official_friendly: true,
    },
  });

  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].url, "https://www.cms.gov/newsroom/fact-sheets/2026-03-21-hospital-payment-model");
  assert.strictEqual(result.items[0].retrieval_from_search_evidence, true);
  assert.strictEqual(result.diagnostics.conversion_funnel.listing_page_penalty_count, 2);
  assert.strictEqual(result.diagnostics.conversion_funnel.search_evidence_retained_count, 1);
}

(async () => {
  await testCustomFallbackFlowWithProviderPolicy();
  await testTransportErrorDiagnostics();
  await testStandardTopicsUseFallbackQueriesForThinPools();
  await testPreferredDomainPassUsesSearchFilterAndBroadFallback();
  await testPreferredOnlyModeSkipsBroadFallback();
  await testBroadOnlyModeSkipsSearchFilter();
  await testFetchReplacesUnsupportedSlugWithSingleEvidenceUrl();
  await testFetchDropsAmbiguousSameHostMismatch();
  await testStandardTopicsDoNotRetainThinSearchMetadataWithoutResolvedEvidence();
  await testStandardTopicsResolveTrustedEvidenceUrlsDirectlyWhenSearchMetadataIsThin();
  await testStandardTopicsPreferFreshTrustedSearchEvidenceOverStaleProviderItems();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
