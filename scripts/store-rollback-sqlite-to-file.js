#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/runtime/store-core-runtime");
const { writeUserFileAtomic } = require("../src/runtime/store-record-runtime");
const {
  backupTimestamp,
  hashUserForCompare,
  loadSourceUsers,
  mapUsersByChatId,
  parseArgs,
  runPreflight,
} = require("./migrate-store-file-to-sqlite");
const { runDualReadCompare } = require("./store-dual-read-compare");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");
const DEFAULT_BACKUP_DIR = path.join(ROOT, "artifacts", "backups");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");

function log(message) {
  process.stdout.write(`[store-rollback] ${message}\n`);
}

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function parsePositiveFloat(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolvePath(raw, fallback, baseDir = ROOT) {
  const value = String(raw || "").trim();
  if (!value) return path.resolve(fallback);
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(baseDir, value);
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function userFilePath(dataDir, chatId) {
  return path.join(dataDir, `user-${chatId}.json`);
}

function writeArtifact(options, payload) {
  const defaultName = `store-rollback-sqlite-to-file-${backupTimestamp()}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.mkdirSync(options.artifactDir, { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

function loadFileMap(dataDir) {
  const source = loadSourceUsers(dataDir);
  return mapUsersByChatId(source.users, "file-store users");
}

function loadSqliteMap(options) {
  const sqliteStore = createStore({
    backend: "sqlite",
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    warningThrottleMs: 0,
    onWarning: options.onWarning,
  });
  sqliteStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });
  return mapUsersByChatId(sqliteStore.allUsers(), "sqlite users");
}

function planRollback(sqliteMap, fileMap) {
  const operations = [];
  const sqliteChatIds = Array.from(sqliteMap.keys()).sort((a, b) => a.localeCompare(b));
  for (const chatId of sqliteChatIds) {
    const sqliteUser = sqliteMap.get(chatId);
    const fileUser = fileMap.get(chatId) || null;
    const nextUser = {
      ...sqliteUser,
      token: sqliteUser.token || fileUser?.token || createToken(),
    };
    const nextHash = hashUserForCompare(nextUser);
    const fileHash = fileUser ? hashUserForCompare(fileUser) : "";
    const action = fileUser
      ? (fileHash === nextHash ? "unchanged" : "update")
      : "insert";
    operations.push({
      chatId,
      action,
      next_hash: nextHash,
      next_user: nextUser,
    });
  }

  const fileOnlyChatIds = Array.from(fileMap.keys())
    .filter((chatId) => !sqliteMap.has(chatId))
    .sort((a, b) => a.localeCompare(b));

  return {
    operations,
    file_only_chat_ids: fileOnlyChatIds,
    summary: {
      sqlite_users: sqliteChatIds.length,
      inserted: operations.filter((op) => op.action === "insert").length,
      updated: operations.filter((op) => op.action === "update").length,
      unchanged: operations.filter((op) => op.action === "unchanged").length,
      file_only_users: fileOnlyChatIds.length,
    },
  };
}

function resolveRollbackOptions(argv, env = process.env, baseDir = ROOT) {
  const { options, flags } = parseArgs(argv);
  const dataDir = resolvePath(
    readOption(options, "data-dir", "data_dir") || String(env.SIGNALBRIEF_DATA_DIR || ""),
    DEFAULT_DATA_DIR,
    baseDir
  );
  const sqlitePath = resolvePath(
    readOption(options, "sqlite-path", "sqlite_path") || String(env.SIGNALBRIEF_SQLITE_PATH || ""),
    path.join(dataDir, "signalbrief.sqlite"),
    baseDir
  );
  const backupDir = resolvePath(
    readOption(options, "backup-dir", "backup_dir") || String(env.SIGNALBRIEF_BACKUP_DIR || ""),
    DEFAULT_BACKUP_DIR,
    baseDir
  );
  const artifactDir = resolvePath(
    readOption(options, "artifact-dir", "artifact_dir") || String(env.SIGNALBRIEF_RELEASE_ARTIFACT_DIR || ""),
    DEFAULT_ARTIFACT_DIR,
    baseDir
  );
  return {
    dataDir,
    sqlitePath,
    backupDir,
    artifactDir,
    artifactName: readOption(options, "artifact-name", "artifact_name"),
    verifyArtifactName: readOption(options, "verify-artifact-name", "verify_artifact_name"),
    requireBackupMaxAgeHours: parsePositiveFloat(
      readOption(options, "require-backup-max-age-hours", "require_backup_max_age_hours"),
      24
    ),
    allowMissingBackup: flags.has("allow-missing-backup"),
    allowStaleBackup: flags.has("allow-stale-backup"),
    dryRun: flags.has("dry-run"),
    keepFileOnlyUsers: flags.has("keep-file-only-users"),
    skipIdempotencyCheck: flags.has("skip-idempotency-check"),
    help: flags.has("help") || flags.has("h"),
  };
}

function runRollback(rawOptions) {
  const startedAt = new Date();
  const options = {
    ...rawOptions,
    dataDir: path.resolve(String(rawOptions.dataDir || DEFAULT_DATA_DIR)),
    sqlitePath: path.resolve(String(rawOptions.sqlitePath || path.join(DEFAULT_DATA_DIR, "signalbrief.sqlite"))),
    backupDir: path.resolve(String(rawOptions.backupDir || DEFAULT_BACKUP_DIR)),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    artifactName: String(rawOptions.artifactName || "").trim(),
    verifyArtifactName: String(rawOptions.verifyArtifactName || "").trim(),
    requireBackupMaxAgeHours: parsePositiveFloat(rawOptions.requireBackupMaxAgeHours, 24),
    allowMissingBackup: rawOptions.allowMissingBackup === true,
    allowStaleBackup: rawOptions.allowStaleBackup === true,
    dryRun: rawOptions.dryRun === true,
    keepFileOnlyUsers: rawOptions.keepFileOnlyUsers === true,
    skipIdempotencyCheck: rawOptions.skipIdempotencyCheck === true,
  };
  const warnings = [];

  if (!fs.existsSync(options.sqlitePath)) {
    throw new Error(`sqlite file missing: ${options.sqlitePath}`);
  }

  const preflight = runPreflight({
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    backupDir: options.backupDir,
    artifactDir: options.artifactDir,
    requireBackupMaxAgeHours: options.requireBackupMaxAgeHours,
    allowMissingBackup: options.allowMissingBackup,
    allowStaleBackup: options.allowStaleBackup,
  });

  const sqliteMap = loadSqliteMap({
    dataDir: options.dataDir,
    sqlitePath: options.sqlitePath,
    onWarning: (message) => warnings.push(String(message || "")),
  });
  const fileMapBefore = loadFileMap(options.dataDir);
  const plan = planRollback(sqliteMap, fileMapBefore);

  let writesApplied = 0;
  let prunedFileOnly = 0;
  if (!options.dryRun) {
    for (const op of plan.operations) {
      if (op.action === "unchanged") continue;
      writeUserFileAtomic(userFilePath(options.dataDir, op.chatId), op.next_user);
      writesApplied += 1;
    }

    if (!options.keepFileOnlyUsers) {
      for (const chatId of plan.file_only_chat_ids) {
        const targetFile = userFilePath(options.dataDir, chatId);
        if (!fs.existsSync(targetFile)) continue;
        fs.unlinkSync(targetFile);
        prunedFileOnly += 1;
      }
    } else if (plan.file_only_chat_ids.length > 0) {
      warnings.push(`kept ${plan.file_only_chat_ids.length} file-only users by request`);
    }
  } else {
    writesApplied = plan.summary.inserted + plan.summary.updated;
    if (!options.keepFileOnlyUsers) prunedFileOnly = plan.file_only_chat_ids.length;
  }

  let idempotentReplay = {
    checked: false,
    ok: true,
    pending_writes: 0,
    pending_file_only_users: 0,
  };
  if (!options.skipIdempotencyCheck && !options.dryRun) {
    const afterFileMap = loadFileMap(options.dataDir);
    const replayPlan = planRollback(sqliteMap, afterFileMap);
    const pendingWrites = replayPlan.summary.inserted + replayPlan.summary.updated;
    const pendingFileOnlyUsers = options.keepFileOnlyUsers ? 0 : replayPlan.file_only_chat_ids.length;
    idempotentReplay = {
      checked: true,
      ok: pendingWrites === 0 && pendingFileOnlyUsers === 0,
      pending_writes: pendingWrites,
      pending_file_only_users: pendingFileOnlyUsers,
    };
    if (!idempotentReplay.ok) {
      throw new Error(
        `idempotent replay failed (pending_writes=${pendingWrites}, pending_file_only_users=${pendingFileOnlyUsers})`
      );
    }
  }

  let rollbackVerify = null;
  if (!options.dryRun) {
    const verifyArtifactName = options.verifyArtifactName
      || `store-rollback-verify-${backupTimestamp()}.json`;
    rollbackVerify = runDualReadCompare({
      dataDir: options.dataDir,
      sqlitePath: options.sqlitePath,
      artifactDir: options.artifactDir,
      artifactName: verifyArtifactName,
      strictTokenMatch: true,
      allowExtraSqlite: false,
      allowDiff: false,
    });
    if (!rollbackVerify.summary.pass) {
      throw new Error("rollback verify failed: file/sqlite parity check did not pass");
    }
  }

  const report = {
    version: 1,
    rollback: "sqlite_to_file",
    host: os.hostname(),
    started_at_utc: startedAt.toISOString(),
    finished_at_utc: new Date().toISOString(),
    options: {
      data_dir: options.dataDir,
      sqlite_path: options.sqlitePath,
      backup_dir: options.backupDir,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
      verify_artifact_name: options.verifyArtifactName || null,
      require_backup_max_age_hours: options.requireBackupMaxAgeHours,
      dry_run: options.dryRun,
      keep_file_only_users: options.keepFileOnlyUsers,
      skip_idempotency_check: options.skipIdempotencyCheck,
    },
    preflight,
    summary: {
      sqlite_users: plan.summary.sqlite_users,
      file_users_before: fileMapBefore.size,
      inserted: plan.summary.inserted,
      updated: plan.summary.updated,
      unchanged: plan.summary.unchanged,
      file_only_before: plan.summary.file_only_users,
      writes_applied: writesApplied,
      pruned_file_only_users: prunedFileOnly,
    },
    idempotent_replay: idempotentReplay,
    rollback_verify: rollbackVerify
      ? {
        pass: rollbackVerify.summary.pass,
        artifact_path: rollbackVerify.artifact_path,
      }
      : null,
    warnings,
  };

  const artifactPath = writeArtifact(options, report);
  return {
    ...report,
    artifact_path: artifactPath,
  };
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/store-rollback-sqlite-to-file.js [options]",
      "",
      "Purpose:",
      "  Roll back state backend from SQLite to file-store by replaying sqlite users",
      "  into data/user-*.json, then verifying parity.",
      "",
      "Options:",
      "  --data-dir <dir>                         File-store directory (default: ./data)",
      "  --sqlite-path <file>                     SQLite file path (default: <data-dir>/signalbrief.sqlite)",
      "  --backup-dir <dir>                       Backup archive dir (default: ./artifacts/backups)",
      "  --artifact-dir <dir>                     Output artifact dir (default: ./artifacts/releases)",
      "  --artifact-name <file.json>              Explicit rollback artifact name",
      "  --verify-artifact-name <file.json>       Explicit dual-read verify artifact name",
      "  --require-backup-max-age-hours <hours>   Fresh-backup threshold (default: 24)",
      "  --allow-missing-backup                   Do not fail when no backup archive exists",
      "  --allow-stale-backup                     Do not fail when backup is older than threshold",
      "  --dry-run                                Plan only; no file writes",
      "  --keep-file-only-users                   Preserve file users missing from sqlite",
      "  --skip-idempotency-check                 Skip second-pass replay check",
      "  --help                                   Show help",
    ].join("\n")
  );
}

function main() {
  const options = resolveRollbackOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const result = runRollback(options);
    log(
      `summary: sqlite=${result.summary.sqlite_users} file_before=${result.summary.file_users_before} `
      + `inserted=${result.summary.inserted} updated=${result.summary.updated} `
      + `unchanged=${result.summary.unchanged} pruned=${result.summary.pruned_file_only_users}`
    );
    if (result.idempotent_replay.checked) {
      log(
        `idempotent_replay: ok=${result.idempotent_replay.ok} `
        + `pending_writes=${result.idempotent_replay.pending_writes} `
        + `pending_file_only_users=${result.idempotent_replay.pending_file_only_users}`
      );
    }
    if (result.rollback_verify) {
      log(`verify: pass=${result.rollback_verify.pass} artifact=${result.rollback_verify.artifact_path}`);
    }
    if (result.warnings.length) {
      for (const warning of result.warnings) {
        log(`warn: ${warning}`);
      }
    }
    log(`artifact=${result.artifact_path}`);
  } catch (error) {
    process.stderr.write(`[store-rollback] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  planRollback,
  resolveRollbackOptions,
  runRollback,
};
