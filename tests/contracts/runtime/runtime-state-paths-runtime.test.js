"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "src/runtime/runtime-state-paths-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  defaultDataDir,
  resolveSignalBriefRuntimePaths,
  describeRuntimePathAlignment,
} = runtime;

(() => {
  const appRoot = path.join(process.cwd(), "tmp-runtime-state-root");

  const testDir = defaultDataDir({
    appRoot,
    env: {},
    nodeEnv: "test",
  });
  assert.strictEqual(testDir, path.join(appRoot, ".tmp", "test-data"));

  const paths = resolveSignalBriefRuntimePaths({
    appRoot,
    env: {
      SIGNALBRIEF_DATA_DIR: path.join(appRoot, "runtime"),
      SIGNALBRIEF_SQLITE_PATH: path.join(appRoot, "state", "users.sqlite"),
      SIGNALBRIEF_ARCHIVE_DIR: path.join(appRoot, "archive-volume"),
    },
  });
  assert.strictEqual(paths.dataDir, path.join(appRoot, "runtime"));
  assert.strictEqual(paths.sqlitePath, path.join(appRoot, "state", "users.sqlite"));
  assert.strictEqual(paths.archiveDir, path.join(appRoot, "archive-volume"));
  assert.strictEqual(paths.digestRecordsDir, path.join(appRoot, "runtime", "digest-records"));
  assert.strictEqual(paths.digestRetryStatePath, path.join(appRoot, "runtime", "digest-retry-state.json"));
  assert.strictEqual(paths.sourceRegistryPath, path.join(appRoot, "runtime", "standard-topic-broker-sources.json"));
  assert.strictEqual(paths.preferredSourcesPath, path.join(appRoot, "runtime", "preferred-sources.json"));
  assert.strictEqual(paths.standardTopicBrokerSourcesPath, path.join(appRoot, "runtime", "standard-topic-broker-sources.json"));
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(paths, "digestOnDemandCooldownPath"),
    false,
    "runtime paths should not resolve a removed on-demand cooldown file"
  );

  const aligned = describeRuntimePathAlignment(resolveSignalBriefRuntimePaths({
    appRoot,
    env: {
      SIGNALBRIEF_DATA_DIR: path.join(appRoot, "runtime"),
    },
  }));
  assert.strictEqual(aligned.ok, true);
  assert.deepStrictEqual(aligned.divergent_components, []);

  const mismatched = describeRuntimePathAlignment(paths);
  assert.strictEqual(mismatched.ok, false);
  assert.ok(mismatched.divergent_components.includes("sqlite"));
  assert.ok(mismatched.divergent_components.includes("archive"));
})();

process.stdout.write("[runtime-state-paths-runtime] all assertions passed\n");
