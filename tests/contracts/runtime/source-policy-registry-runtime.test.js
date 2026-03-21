"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/source-policy-registry-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  clampAuthority,
  createSourceRegistryRuntime,
  normalizeSourceIdentityKey,
} = runtime;

assert.strictEqual(clampAuthority(null), null);
assert.strictEqual(clampAuthority(""), null);
assert.strictEqual(clampAuthority(undefined), null);
assert.strictEqual(normalizeSourceIdentityKey("youtube:@InsideBoardroom"), "youtube:@insideboardroom");
assert.strictEqual(normalizeSourceIdentityKey("not-a-valid-key"), "");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-source-registry-"));
const registryPath = path.join(tempDir, "source-registry.json");
const registryRuntime = createSourceRegistryRuntime({ sourceRegistryPath: registryPath });

registryRuntime.upsertSourceRegistryEntry({
  domain: "example.com",
  source_type: "reported_media",
  policy: "allowed",
  review_status: "reviewed",
  authority_override: null,
  note: "No manual authority override",
}, { updated_by: "test" });

const saved = JSON.parse(fs.readFileSync(registryPath, "utf8"));
assert.strictEqual(saved.domains["example.com"].authority_override, null);

registryRuntime.upsertSourceRegistryEntry({
  identity_key: "youtube:@InsideBoardroom",
  source_type: "reported_media",
  policy: "preferred",
  review_status: "reviewed",
  note: "Specific channel is approved",
}, { updated_by: "test" });

const savedWithIdentity = JSON.parse(fs.readFileSync(registryPath, "utf8"));
assert.ok(savedWithIdentity.identities, "registry should persist identities map");
assert.strictEqual(savedWithIdentity.identities["youtube:@insideboardroom"].policy, "preferred");
assert.strictEqual(
  registryRuntime.getSourceRegistryIdentityEntry("youtube:@InsideBoardroom").identity_key,
  "youtube:@insideboardroom"
);
assert.ok(registryRuntime.buildRegistryMap(registryRuntime.loadSourceRegistry()).identities instanceof Map);

process.stdout.write("[source-policy-registry-runtime] all assertions passed\n");
