"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-formatting-ai-generation-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const prompts = [];
const generationRuntime = runtime.createDigestAiGenerationRuntime({
  callHaikuOneLine: async (prompt) => {
    prompts.push(prompt);
    return { text: "Subject line", usage: { input_tokens: 1, output_tokens: 1 } };
  },
  stripInlineHtml: (value) => String(value || "").replace(/<[^>]+>/g, ""),
});

(async () => {
  await generationRuntime.generateLeadSubjectLine({
    headline: "Datadog acquires startup",
    wim: "This deal strengthens Datadog's platform footprint.",
  }, new Date("2026-03-27T12:00:00Z"));
  await generationRuntime.generateEditorialNote([
    { tag: "AI", headline: "AWS expands GPU cluster capacity" },
    { tag: "ENERGY", headline: "Utilities reopen gas turbine procurement" },
  ]);

  assert.strictEqual(prompts.length, 2);
  assert.ok(prompts[0].includes("operators, founders, investors, and team leads"));
  assert.ok(prompts[0].includes("one topic closely"));
  assert.ok(!prompts[0].includes("strategy consultants"));

  assert.ok(prompts[1].includes("focused sector briefing"));
  assert.ok(prompts[1].includes("company, regulator, buyer segment, or supply chain node"));
  assert.ok(!prompts[1].includes("strategy professional"));
  assert.ok(!prompts[1].includes("cross-sector"));

  process.stdout.write("[digest-formatting-ai-generation-runtime] all assertions passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
