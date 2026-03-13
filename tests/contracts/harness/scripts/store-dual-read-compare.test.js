"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const MIGRATE_REL = "scripts/migrate-store-file-to-sqlite.js";
const DUAL_READ_REL = "scripts/store-dual-read-compare.js";
const MIGRATE_PATH = path.join(process.cwd(), MIGRATE_REL);
const DUAL_READ_PATH = path.join(process.cwd(), DUAL_READ_REL);
assertNodeSyntaxFile(MIGRATE_PATH);
assertNodeSyntaxFile(DUAL_READ_PATH);

const migrateRuntime = require(MIGRATE_PATH);
const dualReadRuntime = require(DUAL_READ_PATH);
assertModuleExports(() => dualReadRuntime, DUAL_READ_REL);

const { resolveMigrationOptions, runMigration } = migrateRuntime;
const { resolveDualReadCompareOptions, runDualReadCompare } = dualReadRuntime;
assert.strictEqual(typeof resolveDualReadCompareOptions, "function");
assert.strictEqual(typeof runDualReadCompare, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-dual-read-"));
const dataDir = path.join(rootDir, "data");
const backupDir = path.join(rootDir, "backups");
const artifactDir = path.join(rootDir, "artifacts");
const sqlitePath = path.join(rootDir, "data", "signalbrief.sqlite");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, "state-backup-test.tgz"), "backup");

const nowIso = "2026-03-12T12:00:00.000Z";
fs.writeFileSync(path.join(dataDir, "user-a.json"), JSON.stringify({
  chatId: "a",
  email: "a@example.com",
  token: "tok_a",
  topics: ["AI"],
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));
fs.writeFileSync(path.join(dataDir, "user-b.json"), JSON.stringify({
  chatId: "b",
  email: "b@example.com",
  token: null,
  topics: ["Energy"],
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));

try {
  runMigration(resolveMigrationOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "dual-read-seed-migration.json",
  ], {}, rootDir));

  const cleanCompare = runDualReadCompare(resolveDualReadCompareOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--artifact-dir", artifactDir,
    "--artifact-name", "dual-read-clean.json",
  ], {}, rootDir));
  assert.strictEqual(cleanCompare.summary.pass, true);
  assert.strictEqual(cleanCompare.summary.diff_detected, false);
  assert.ok(fs.existsSync(cleanCompare.artifact_path));

  const { createStore } = require(path.join(process.cwd(), "src/runtime/store-core-runtime.js"));
  const sqliteStore = createStore({
    backend: "sqlite",
    dataDir,
    sqlitePath,
  });
  sqliteStore.initStore({ dataDir, rebuildIndex: true });
  const mutated = sqliteStore.readUser("a");
  sqliteStore.writeUser("a", {
    ...mutated,
    email: "mutated@example.com",
    last_updated: "2026-03-13T00:00:00.000Z",
  });

  const mismatchCompare = runDualReadCompare(resolveDualReadCompareOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--artifact-dir", artifactDir,
    "--artifact-name", "dual-read-mismatch.json",
    "--allow-diff",
  ], {}, rootDir));
  assert.strictEqual(mismatchCompare.summary.diff_detected, true);
  assert.strictEqual(mismatchCompare.summary.pass, true, "allow-diff should keep command pass state");
  assert.ok(mismatchCompare.summary.field_mismatches >= 1);
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
