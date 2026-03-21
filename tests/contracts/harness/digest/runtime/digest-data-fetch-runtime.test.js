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
                { headline: "Custom story", summary: "Summary", url: "https://example.com/story" },
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
                  { headline: "Standard story one", summary: "Summary", url: "https://example.com/one" },
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
                { headline: "Standard story two", summary: "Summary", url: "https://example.com/two" },
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
    isFetchedItemEligible: (item) => item?.source !== "blocked.example",
    httpsPostWithRetry: async (_host, _path, _headers, payload) => {
      payloads.push(payload);
      calls += 1;
      if (calls === 1) {
        return {
          status: 200,
          body: {
            citations: ["https://preferred.example/story"],
            choices: [{
              message: {
                content: JSON.stringify([
                  {
                    headline: "Preferred source story",
                    summary: "Summary",
                    source: "blocked.example",
                    url: "https://preferred.example/story",
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
          choices: [{
            message: {
              content: JSON.stringify([
                {
                  headline: "Broad source story",
                  summary: "Summary",
                  source: "reuters.com",
                  url: "https://broad.example/story",
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
  assert.strictEqual(result.diagnostics.preferred_fallback_triggered, true);
  assert.strictEqual(result.diagnostics.preferred_pass_item_count, 1);
  assert.strictEqual(result.diagnostics.broad_pass_item_count, 1);
  assert.strictEqual(result.items[0].retrieval_pass, "preferred");
  assert.strictEqual(result.items[1].retrieval_pass, "broad");
}

(async () => {
  await testCustomFallbackFlowWithProviderPolicy();
  await testTransportErrorDiagnostics();
  await testStandardTopicsUseFallbackQueriesForThinPools();
  await testPreferredDomainPassUsesSearchFilterAndBroadFallback();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
