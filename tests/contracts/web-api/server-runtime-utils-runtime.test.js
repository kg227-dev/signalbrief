"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime-utils-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  readArchiveFiles,
} = runtime;

assert.strictEqual(typeof readArchiveFiles, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-web-utils-archive-"));
try {
  const indexedDir = path.join(rootDir, "indexed");
  fs.mkdirSync(indexedDir, { recursive: true });
  fs.writeFileSync(path.join(indexedDir, "2026-03-12.json"), "{\"items\":[]}");
  fs.writeFileSync(path.join(indexedDir, "index.json"), JSON.stringify({
    version: 1,
    updated_at: "2026-03-13T00:00:00.000Z",
    dates: ["2026-03-12"],
  }, null, 2));

  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = function guardedReaddir(target, ...args) {
    if (path.resolve(String(target || "")) === path.resolve(indexedDir)) {
      throw new Error("unexpected archive directory scan");
    }
    return originalReaddirSync.call(fs, target, ...args);
  };
  try {
    const fromIndex = readArchiveFiles({ fs, archiveDir: indexedDir });
    assert.deepStrictEqual(fromIndex, ["2026-03-12.json"]);
  } finally {
    fs.readdirSync = originalReaddirSync;
  }

  const scannedDir = path.join(rootDir, "scanned");
  fs.mkdirSync(scannedDir, { recursive: true });
  fs.writeFileSync(path.join(scannedDir, "2026-03-10.json"), "{\"items\":[]}");
  fs.writeFileSync(path.join(scannedDir, "2026-03-11.json"), "{\"items\":[]}");
  const scanned = readArchiveFiles({ fs, archiveDir: scannedDir });
  assert.deepStrictEqual(scanned, ["2026-03-11.json", "2026-03-10.json"]);
  assert.ok(fs.existsSync(path.join(scannedDir, "index.json")), "archive index should be backfilled after scan");
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
