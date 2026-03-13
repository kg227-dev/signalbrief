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
const TARGET_REL = "scripts/store-full-enable-validate.js";
const MIGRATE_PATH = path.join(process.cwd(), MIGRATE_REL);
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(MIGRATE_PATH);
assertNodeSyntaxFile(TARGET_PATH);

const migrateRuntime = require(MIGRATE_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { resolveMigrationOptions, runMigration } = migrateRuntime;
const {
  resolveFullEnableValidateOptions,
  runFullEnableValidate,
} = runtime;
assert.strictEqual(typeof resolveFullEnableValidateOptions, "function");
assert.strictEqual(typeof runFullEnableValidate, "function");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-store-full-enable-"));
const dataDir = path.join(rootDir, "data");
const backupDir = path.join(rootDir, "backups");
const artifactDir = path.join(rootDir, "artifacts");
const sqlitePath = path.join(dataDir, "signalbrief.sqlite");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(path.join(backupDir, "state-backup-test.tgz"), "backup");

const nowIso = "2026-03-12T12:00:00.000Z";
fs.writeFileSync(path.join(dataDir, "user-a.json"), JSON.stringify({
  chatId: "a",
  email: "a@example.com",
  token: "tok_a",
  topics: ["AI×TECH"],
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));
fs.writeFileSync(path.join(dataDir, "user-b.json"), JSON.stringify({
  chatId: "b",
  email: "b@example.com",
  token: "tok_b",
  topics: ["STRATEGY"],
  joined_at: nowIso,
  last_updated: nowIso,
}, null, 2));

try {
  runMigration(resolveMigrationOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--backup-dir", backupDir,
    "--artifact-dir", artifactDir,
    "--artifact-name", "full-enable-seed-migration.json",
  ], {}, rootDir));

  const resolved = resolveFullEnableValidateOptions([
    "--data-dir", dataDir,
    "--sqlite-path", sqlitePath,
    "--artifact-dir", artifactDir,
    "--artifact-name", "full-enable-validate.json",
    "--sample-size", "2",
  ], {}, rootDir);
  assert.strictEqual(resolved.dataDir, dataDir);
  assert.strictEqual(resolved.sqlitePath, sqlitePath);
  assert.strictEqual(resolved.artifactDir, artifactDir);
  assert.strictEqual(resolved.sampleSize, 2);

  const success = runFullEnableValidate(resolved);
  assert.strictEqual(success.pass, true);
  assert.strictEqual(success.checks.file_users, 2);
  assert.strictEqual(success.checks.sqlite_users, 2);
  assert.strictEqual(success.checks.rollback_switch_validated, true);
  assert.strictEqual(success.export.SIGNALBRIEF_STORE_BACKEND, "sqlite");
  assert.strictEqual(success.export.SIGNALBRIEF_STORE_ROLLBACK_BACKEND, "file");
  assert.ok(fs.existsSync(success.artifact_path));

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

  assert.throws(
    () => runFullEnableValidate({
      dataDir,
      sqlitePath,
      artifactDir,
      artifactName: "full-enable-validate-fail.json",
      compareArtifactName: "full-enable-compare-fail.json",
      sampleSize: 2,
      allowEmpty: false,
    }),
    /dual-read compare failed/
  );
} finally {
  fs.rmSync(rootDir, { recursive: true, force: true });
}
