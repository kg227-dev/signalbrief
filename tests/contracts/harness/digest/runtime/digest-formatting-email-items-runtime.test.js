"use strict";

const assert = require("assert");
const path = require("path");
const { assertNodeSyntaxFile, assertModuleExports } = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-formatting-email-items-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { createDigestEmailItemsRuntime } = runtime;

const emailItemsRuntime = createDigestEmailItemsRuntime({
  BASE_URL: "https://getsignalbrief.com",
  topicVisual: () => ({ chipText: "#111827", chipBg: "#E5E7EB", icon: "•" }),
  scoreColor: () => ({ solid: "#111827" }),
  escapeHtml: (value) => String(value || ""),
});

const html = emailItemsRuntime.renderDigestItemHtml({
  tag: "AI",
  headline: "Nvidia signs new enterprise deal",
  summary: "Summary text.",
  wim: "Why it matters.",
  source: "reuters.com",
  url: "https://www.reuters.com/example",
  relevanceScore: 7.3,
  why_shown: ["source_trusted", "tracked_topic"],
}, 0, {
  userToken: "token-123",
  digestId: "digest-456",
  depth: "headline_plus_why",
});

assert.ok(html.includes("Read more"), "email item should keep the read-more link");
assert.ok(html.includes("reuters.com"), "email item should keep source attribution");
assert.ok(html.includes("Why included: source trusted · tracked topic"), "email item should keep why_shown details");
