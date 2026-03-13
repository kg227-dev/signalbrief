"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/migrate-store-file-to-sqlite.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  parseArgs,
  resolveMigrationOptions,
  runMigration,
} = runtime;
assert.strictEqual(typeof parseArgs, "function");
assert.strictEqual(typeof resolveMigrationOptions, "function");
assert.strictEqual(typeof runMigration, "function");

const parsed = parseArgs(["--data-dir", "tmp/data", "--dry-run", "--artifact-name", "x.json"]);
assert.strictEqual(parsed.options["data-dir"], "tmp/data");
assert.strictEqual(parsed.options["artifact-name"], "x.json");
assert.ok(parsed.flags.has("dry-run"));

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-migrate-"));
const dataDir = path.join(rootDir, "data");
const backupDir = path.join(rootDir, "backups");
const artifactDir = path.join(rootDir, "artifacts");
const sqlitePath = path.join(rootDir, "sqlite", "signalbrief.sqlite");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, "state-backup-test.tgz"), "backup");

const nowIso = "2026-03-12T12:00:00.000Z";
fs.writeFileSync(path.join(dataDir, "user-a.json"), JSON.stringify({
  chatId: "a",
  email: "a@example.com",
  token: null,
  topics: ["AI"],
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));
fs.writeFileSync(path.join(dataDir, "user-b.json"), JSON.stringify({
  chatId: "b",
  email: "b@example.com",
  token: null,
  topics: ["Finance"],
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));

try {
  const first = runMigration(resolveMigrationOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "migration-first.json",
  ], {}, rootDir));

  assert.strictEqual(first.summary.source_users, 2);
  assert.strictEqual(first.summary.inserted, 2);
  assert.strictEqual(first.summary.updated, 0);
  assert.strictEqual(first.summary.unchanged, 0);
  assert.strictEqual(first.idempotent_replay.checked, true);
  assert.strictEqual(first.idempotent_replay.ok, true);
  assert.ok(fs.existsSync(first.artifact_path), "first migration should emit artifact");

  const replay = runMigration(resolveMigrationOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "migration-replay.json",
  ], {}, rootDir));

  assert.strictEqual(replay.summary.source_users, 2);
  assert.strictEqual(replay.summary.inserted, 0);
  assert.strictEqual(replay.summary.updated, 0);
  assert.strictEqual(replay.summary.unchanged, 2);
  assert.strictEqual(replay.idempotent_replay.ok, true);
  assert.ok(fs.existsSync(replay.artifact_path), "replay should emit artifact");

  const dryRun = runMigration(resolveMigrationOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "migration-dry-run.json",
    "--dry-run",
  ], {}, rootDir));
  assert.strictEqual(dryRun.summary.source_users, 2);
  assert.strictEqual(dryRun.idempotent_replay.checked, false, "dry-run should skip replay write check");
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
