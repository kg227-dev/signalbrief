"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/entrypoints/digest-orchestrator-enrichment-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createDigestOrchestratorEnrichmentRuntime } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

(async () => {
  const enrichmentRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async (selected) => ({
      items: selected.map((item) => ({ ...item, wim: "ok" })),
      usage: { input_tokens: "123", output_tokens: 45 },
    }),
  });

  const out = await enrichmentRuntime.enrichSelectedItems({
    selected: [{ headline: "A" }],
  });
  assert.deepStrictEqual(out.enriched, [{ headline: "A", wim: "ok" }]);
  assert.strictEqual(out.claudeUsage.input_tokens, 123);
  assert.strictEqual(out.claudeUsage.output_tokens, 45);

  const fallbackRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async () => ({
      items: null,
      usage: {},
    }),
  });
  const fallback = await fallbackRuntime.enrichSelectedItems({ selected: [] });
  assert.deepStrictEqual(fallback.enriched, []);
  assert.deepStrictEqual(fallback.claudeUsage, { input_tokens: 0, output_tokens: 0 });

  const incidents = [];
  const degradedRuntime = createDigestOrchestratorEnrichmentRuntime({
    enrichItems: async () => ({
      items: [{ headline: "A", wim: null }],
      usage: { input_tokens: 0, output_tokens: 0 },
      degraded: true,
      degradation: {
        provider: "anthropic",
        reason: "status_failure",
        status_code: 503,
        timeout_ms: 30000,
      },
    }),
    emitDigestIncident: async (...args) => {
      incidents.push(args);
    },
  });
  const degraded = await degradedRuntime.enrichSelectedItems({
    selected: [{ headline: "A" }],
    runMode: "scheduled",
    dueUsersCount: 2,
  });
  assert.strictEqual(Array.isArray(degraded.enriched), true);
  assert.strictEqual(degraded.enriched[0].headline, "A");
  assert.strictEqual(incidents.length, 1);
  assert.strictEqual(incidents[0][0], "anthropic-partial-degradation");
  assert.strictEqual(incidents[0][2].status_code, 503);
})();
