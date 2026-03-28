"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/domains/digest/index.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const TOPIC_DOMAIN_PATH = require.resolve(path.join(process.cwd(), "src/digest/domain/topic-domain-runtime.js"));

delete require.cache[TARGET_PATH];
delete require.cache[TOPIC_DOMAIN_PATH];

assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, TOPIC_DOMAIN_PATH),
  false,
  "digest barrel should not eagerly load legacy topic-domain runtime"
);

assert.strictEqual(typeof runtime.normalizeTopicToken, "function");
assert.strictEqual(runtime.normalizeTopicToken("AI×TECH"), "ai tech");
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, TOPIC_DOMAIN_PATH),
  false,
  "lightweight normalization exports should not force topic-domain load"
);

assert.strictEqual(typeof runtime.applyDigestDepth, "function");
assert.strictEqual(runtime.applyDigestDepth([{ wim: "A" }], "scan")[0].wim, null);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, TOPIC_DOMAIN_PATH),
  false,
  "lightweight digest-depth export should not force topic-domain load"
);

assert.strictEqual(typeof runtime.computeTopicMatch, "function");
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(require.cache, TOPIC_DOMAIN_PATH),
  true,
  "legacy topic exports should still load topic-domain lazily when accessed"
);
assert.strictEqual(
  runtime.computeTopicMatch({ tag: "technology", headline: "AI infra", summary: "" }, ["technology"]),
  10
);

process.stdout.write("[digest-domain-index-runtime] all assertions passed\n");
