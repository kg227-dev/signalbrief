"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/selection-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { selectItemsByPolicyDetailed } = runtime;

const items = [
  { headline: "Alpha", url: "https://news.example.com/a", tag: "AI", source_domain: "reuters.com" },
  { headline: "Alpha dup", url: "https://news.example.com/a", tag: "M&A", source_domain: "reuters.com" },
  { headline: "Beta", url: "https://news.example.com/b", tag: "STRATEGY", source_domain: "reuters.com" },
  { headline: "Gamma", url: "https://news.example.com/c", tag: "AI", source_domain: "wsj.com" },
  { headline: "Delta", url: "https://news.example.com/d", tag: "custom_one", source_domain: "ft.com" },
  { headline: "Epsilon", url: "https://news.example.com/e", tag: "custom_two", source_domain: "axios.com" },
  { headline: "Zeta", url: "https://news.example.com/f", tag: "ENERGY", source_domain: "bloomberg.com" },
];

const result = selectItemsByPolicyDetailed(items, {
  maxItems: 4,
  perTagCap: 1,
  perSourceCap: 1,
  customTagOrder: ["custom_one", "custom_two"],
  maxCustomItems: 1,
}, {
  normalizeUrl: (value) => String(value || "").trim(),
  parseDomain: (item) => String(item?.source_domain || "unknown"),
});

const reasonsByHeadline = Object.fromEntries(result.rejected.map((row) => [row.item.headline, row.reason]));
assert.strictEqual(reasonsByHeadline["Alpha dup"], "selection_duplicate_url");
assert.strictEqual(reasonsByHeadline.Beta, "selection_source_cap");
assert.strictEqual(reasonsByHeadline.Gamma, "selection_tag_cap");
assert.strictEqual(reasonsByHeadline.Epsilon, "selection_custom_cap");
assert.ok(result.selected.some((item) => item.headline === "Delta"));
assert.ok(result.selected.some((item) => item.headline === "Alpha"));
assert.ok(result.selected.some((item) => item.headline === "Zeta"));

process.stdout.write("[selection-domain-detailed-runtime] all assertions passed\n");
