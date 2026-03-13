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

(async () => {
  await testCustomFallbackFlowWithProviderPolicy();
  await testTransportErrorDiagnostics();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
