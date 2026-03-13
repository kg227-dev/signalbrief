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
const GUARD_REL = "scripts/store-canary-guard.js";
const MIGRATE_PATH = path.join(process.cwd(), MIGRATE_REL);
const GUARD_PATH = path.join(process.cwd(), GUARD_REL);
assertNodeSyntaxFile(MIGRATE_PATH);
assertNodeSyntaxFile(GUARD_PATH);

const migrateRuntime = require(MIGRATE_PATH);
const guardRuntime = require(GUARD_PATH);
assertModuleExports(() => guardRuntime, GUARD_REL);

const { resolveMigrationOptions, runMigration } = migrateRuntime;
const { resolveCanaryGuardOptions, runCanaryGuard } = guardRuntime;
assert.strictEqual(typeof resolveCanaryGuardOptions, "function");
assert.strictEqual(typeof runCanaryGuard, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-canary-guard-"));
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
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));

try {
  runMigration(resolveMigrationOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "guard-seed-migration.json",
  ], {}, rootDir));

  const clean = runCanaryGuard(resolveCanaryGuardOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--artifact-dir", artifactDir,
    "--artifact-name", "guard-clean.json",
    "--compare-artifact-name", "guard-clean-compare.json",
  ], {}, rootDir));
  assert.strictEqual(clean.rollback_triggered, false);
  assert.strictEqual(clean.pass, true);

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
    email: "a-mutated@example.com",
    last_updated: "2026-03-13T00:00:00.000Z",
  });

  const breached = runCanaryGuard(resolveCanaryGuardOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--artifact-dir", artifactDir,
    "--artifact-name", "guard-breached.json",
    "--compare-artifact-name", "guard-breached-compare.json",
    "--warn-only",
  ], {}, rootDir));
  assert.strictEqual(breached.rollback_triggered, true);
  assert.strictEqual(breached.pass, true, "warn-only should suppress process failure state");
  assert.ok(breached.breaches.length >= 1);
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
