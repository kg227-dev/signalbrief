"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/digest/domain/source-domain-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  parseSourceDomain,
  parseSourceIdentity,
} = runtime;

assert.strictEqual(
  parseSourceDomain({ url: "https://youtu.be/abc123" }),
  "youtube.com"
);

const youtubeIdentity = parseSourceIdentity({ url: "https://www.youtube.com/@InsideBoardroom/videos" });
assert.strictEqual(youtubeIdentity.source_platform, "youtube");
assert.strictEqual(youtubeIdentity.source_identity_key, "youtube:@insideboardroom");
assert.strictEqual(youtubeIdentity.source_identity_scope, "platform_channel");

const substackIdentity = parseSourceIdentity({ url: "https://signals.substack.com/p/briefing" });
assert.strictEqual(substackIdentity.source_platform, "substack");
assert.strictEqual(substackIdentity.source_identity_key, "substack:signals");
assert.strictEqual(substackIdentity.source_identity_scope, "platform_publication");

const mediumIdentity = parseSourceIdentity({ url: "https://medium.com/@SignalWriter/analysis-piece" });
assert.strictEqual(mediumIdentity.source_platform, "medium");
assert.strictEqual(mediumIdentity.source_identity_key, "medium:@signalwriter");
assert.strictEqual(mediumIdentity.source_identity_scope, "platform_author");

process.stdout.write("[source-domain-runtime] all assertions passed\n");
