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
const ROLLBACK_REL = "scripts/store-rollback-sqlite-to-file.js";
const MIGRATE_PATH = path.join(process.cwd(), MIGRATE_REL);
const ROLLBACK_PATH = path.join(process.cwd(), ROLLBACK_REL);
assertNodeSyntaxFile(MIGRATE_PATH);
assertNodeSyntaxFile(ROLLBACK_PATH);

const migrateRuntime = require(MIGRATE_PATH);
const rollbackRuntime = require(ROLLBACK_PATH);
assertModuleExports(() => rollbackRuntime, ROLLBACK_REL);

const { resolveMigrationOptions, runMigration } = migrateRuntime;
const { resolveRollbackOptions, runRollback } = rollbackRuntime;
assert.strictEqual(typeof resolveRollbackOptions, "function");
assert.strictEqual(typeof runRollback, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-rollback-"));
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
    "--artifact-name", "rollback-seed-migration.json",
  ], {}, rootDir));

  const { createStore } = require(path.join(process.cwd(), "src/runtime/store-core-runtime.js"));
  const sqliteStore = createStore({
    backend: "sqlite",
    dataDir,
    sqlitePath,
  });
  sqliteStore.initStore({ dataDir, rebuildIndex: true });
  const userA = sqliteStore.readUser("a");
  sqliteStore.writeUser("a", {
    ...userA,
    email: "a-updated@example.com",
    last_updated: "2026-03-13T00:00:00.000Z",
  });
  const userC = sqliteStore.readUser("c");
  sqliteStore.writeUser("c", {
    ...userC,
    email: "c@example.com",
    token: "tok_c",
    last_updated: "2026-03-13T00:00:00.000Z",
  });
  fs.writeFileSync(path.join(dataDir, "user-file-only.json"), JSON.stringify({
    chatId: "file-only",
    email: "file-only@example.com",
    token: "tok_file_only",
    joined_at: nowIso,
    last_updated: nowIso,
  }, null, 2));

  const first = runRollback(resolveRollbackOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "rollback-first.json",
    "--verify-artifact-name", "rollback-verify-first.json",
  ], {}, rootDir));

  assert.ok(first.summary.updated >= 1, "rollback should update changed sqlite records");
  assert.ok(first.summary.inserted >= 1, "rollback should insert sqlite-only users");
  assert.ok(first.summary.pruned_file_only_users >= 1, "rollback should prune stale file-only users");
  assert.ok(first.rollback_verify && first.rollback_verify.pass, "rollback verify must pass");
  assert.ok(first.idempotent_replay.checked);
  assert.ok(first.idempotent_replay.ok);

  const second = runRollback(resolveRollbackOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "rollback-second.json",
    "--verify-artifact-name", "rollback-verify-second.json",
  ], {}, rootDir));
  assert.strictEqual(second.summary.inserted, 0);
  assert.strictEqual(second.summary.updated, 0);
  assert.strictEqual(second.summary.pruned_file_only_users, 0);
  assert.ok(second.idempotent_replay.ok);
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
