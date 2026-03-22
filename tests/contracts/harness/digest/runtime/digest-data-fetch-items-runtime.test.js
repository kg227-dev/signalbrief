"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/runtime/digest-data-fetch-items-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { parsePerplexityItems } = runtime;

const wrappedArray = parsePerplexityItems(`Here are the results:

\`\`\`json
[
  { "headline": "Item One", "summary": "Lead", "source": "reuters.com", "url": "https://www.reuters.com/a", "published_date": "2026-03-21", "tag": "AI×TECH" }
]
\`\`\`
`);
assert.strictEqual(wrappedArray.length, 1);
assert.strictEqual(wrappedArray[0].headline, "Item One");

const wrappedObject = parsePerplexityItems(`json {"items":[{"headline":"Item Two","summary":"Lead","source":"ft.com","url":"https://www.ft.com/b","published_date":"2026-03-21","tag":"STRATEGY"}]}`);
assert.strictEqual(wrappedObject.length, 1);
assert.strictEqual(wrappedObject[0].headline, "Item Two");

process.stdout.write("[digest-data-fetch-items-runtime] all assertions passed\n");
