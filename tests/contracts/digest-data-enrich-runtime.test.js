"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-enrich-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestDataEnrichRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function makeItem(id, overrides = {}) {
  return {
    url: `https://example.com/${id}`,
    headline: `Item ${id} changes enterprise pricing`,
    summary: "The reported change alters procurement timing and operating budgets for enterprise buyers.",
    tag: "TECHNOLOGY",
    source_domain: "example.com",
    source_type: "reported_media",
    source_tier: 3,
    baseScore: 7.1,
    strategic_value: 0.71,
    ...overrides,
  };
}

function anthropicText(text) {
  return {
    status: 200,
    body: {
      content: [{ text }],
      usage: { input_tokens: 10, output_tokens: 10 },
    },
  };
}

(async () => {
  const deterministicResponses = [
    anthropicText(JSON.stringify({
      what_happened: "A vendor repriced enterprise contracts",
      mechanism: "the change resets procurement terms for new buyers",
      who_it_impacts: "enterprise operators and platform teams",
      implication: "buyers may need to revise software budgets",
      confidence: "high",
    })),
    anthropicText("not-json"),
    anthropicText("still not-json"),
    anthropicText("bad fallback"),
    anthropicText("bad fallback retry"),
  ];
  let deterministicCall = 0;
  const deterministicRuntime = createDigestDataEnrichRuntime({
    CONFIG: { keys: { anthropic: "test-key" }, digest: {} },
    log: () => {},
    httpsPostWithRetry: async () => deterministicResponses[deterministicCall++] || anthropicText("not-json"),
  });
  const deterministicOut = await deterministicRuntime.enrichItems([makeItem("fallback")]);
  assert.strictEqual(deterministicOut.items.length, 1);
  assert.strictEqual(deterministicOut.items[0].writeup_status, "deterministic_fallback_pass");
  assert.ok(deterministicOut.items[0].wim && deterministicOut.items[0].wim.length > 20);
  assert.ok(!/unable to generate|provider|error/i.test(deterministicOut.items[0].wim));
  assert.strictEqual(deterministicOut.writeupDiagnostics.wim_fallback_used_count, 1);
  assert.strictEqual(deterministicOut.writeupDiagnostics.wim_missing_prevented_count, 1);

  function makeStableResponder() {
    return async (...args) => {
      const body = args[3] || {};
      const prompt = String(body?.messages?.[0]?.content || "");
      if (prompt.includes("Extract key facts from this article.")) {
        const headlineMatch = prompt.match(/"headline": "([^"]+)"/);
        const label = headlineMatch ? headlineMatch[1] : "A supplier";
        return anthropicText(JSON.stringify({
          what_happened: `${label} changed commercial terms`,
          mechanism: "the move raises software pricing for new deployments",
          who_it_impacts: "enterprise operators and procurement teams",
          implication: "teams may need to rebalance rollout budgets",
          confidence: "high",
        }));
      }
      const headlineMatch = prompt.match(/"headline": "([^"]+)"/);
      const label = headlineMatch ? headlineMatch[1] : "A supplier";
      return anthropicText(JSON.stringify({
        wim: `${label} changed commercial terms, which raises software pricing for new deployments. Enterprise operators and procurement teams may need to rebalance rollout budgets and vendor choices around ${label.toLowerCase()}.`
      }));
    };
  }

  const stableRuntime = createDigestDataEnrichRuntime({
    CONFIG: { keys: { anthropic: "test-key" }, digest: {} },
    log: () => {},
    httpsPostWithRetry: makeStableResponder(),
  });
  const smallRun = await stableRuntime.enrichItems(Array.from({ length: 5 }, (_, index) => makeItem(`small-${index}`)));
  const largeRun = await stableRuntime.enrichItems(Array.from({ length: 15 }, (_, index) => makeItem(`large-${index}`)));
  assert.ok(smallRun.items.every((item) => item.wim && item.writeup_status === "model_pass"));
  assert.ok(largeRun.items.every((item) => item.wim && item.writeup_status === "model_pass"));
  assert.strictEqual(smallRun.writeupDiagnostics.wim_fallback_used_count, 0);
  assert.strictEqual(largeRun.writeupDiagnostics.wim_fallback_used_count, 0);

  process.stdout.write("[digest-data-enrich-runtime] all assertions passed\n");
})();
