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
})();
