#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStore } = require("../src/runtime/store-core-runtime");
const { normalizeUserRecord } = require("../src/runtime/user-contract-runtime");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(ROOT, "data");
const DEFAULT_BACKUP_DIR = path.join(ROOT, "artifacts", "backups");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");
const FALLBACK_NOW_ISO = "1970-01-01T00:00:00.000Z";

function log(message) {
  process.stdout.write(`[store-migrate] ${message}\n`);
}

function parseArgs(argv) {
  const options = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (!key) continue;
    const next = argv[i + 1];
    if (next != null && !String(next).startsWith("--")) {
      options[key] = String(next);
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { options, flags };
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

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map((entry) => stableClone(entry));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = stableClone(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) return "";
  return new Date(millis).toISOString();
}

function resolveNormalizationNowIso(raw, fallbackIso = FALLBACK_NOW_ISO) {
  return (
    parseIso(raw?.last_updated)
    || parseIso(raw?.joined_at)
    || fallbackIso
  );
}

function normalizeUserForCompare(rawUser, fallbackIso = FALLBACK_NOW_ISO) {
  const chatId = String(rawUser?.chatId || "").trim();
  const normalized = normalizeUserRecord(rawUser, {
    chatId,
    nowIso: resolveNormalizationNowIso(rawUser, fallbackIso),
  });
  return normalized;
}

function hashUserForCompare(user) {
  const normalized = normalizeUserForCompare(user);
  return sha256(stableStringify(normalized));
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function listUserFiles(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("user-") && entry.name.endsWith(".json"))
    .map((entry) => path.join(dataDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function parseChatIdFromFileName(filePath) {
  const fileName = path.basename(filePath);
  return fileName.replace(/^user-/, "").replace(/\.json$/, "");
}

function loadSourceUsers(dataDir) {
  const files = listUserFiles(dataDir);
  const users = [];
  for (const filePath of files) {
    const fallbackChatId = parseChatIdFromFileName(filePath);
    const rawText = fs.readFileSync(filePath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`source user file parse failed (${path.basename(filePath)}): ${error.message || String(error)}`);
    }
    const chatId = String(parsed?.chatId || fallbackChatId || "").trim();
    if (!chatId) throw new Error(`source user missing chatId (${path.basename(filePath)})`);
    const normalized = normalizeUserRecord(parsed, {
      chatId,
      nowIso: resolveNormalizationNowIso(parsed),
    });
    users.push(normalized);
  }
  return {
    files,
    users,
  };
}

function mapUsersByChatId(users, label = "users") {
  const map = new Map();
  for (const user of users) {
    const chatId = String(user?.chatId || "").trim();
    if (!chatId) continue;
    if (map.has(chatId)) throw new Error(`duplicate chatId in ${label}: ${chatId}`);
    map.set(chatId, normalizeUserForCompare(user));
  }
  return map;
}

function readBackupEvidence(backupDir) {
  if (!fs.existsSync(backupDir)) return null;
  const archives = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => {
      const absPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(absPath);
      return {
        name: entry.name,
        abs_path: absPath,
        mtime_ms: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime_ms - a.mtime_ms);
  if (!archives.length) return null;
  const latest = archives[0];
  const ageMs = Math.max(0, Date.now() - Number(latest.mtime_ms || 0));
  return {
    name: latest.name,
    abs_path: latest.abs_path,
    modified_at_utc: new Date(latest.mtime_ms).toISOString(),
    age_hours: Number((ageMs / (1000 * 60 * 60)).toFixed(3)),
  };
}

function ensureWritableDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
  fs.accessSync(absDir, fs.constants.W_OK);
  const probe = path.join(absDir, `.store-migrate-probe-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
}

function runPreflight(options) {
  const checks = [];
  const warnings = [];
  const nodeMajor = Number.parseInt(String(process.versions.node || "0").split(".")[0], 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(`Node 22+ is required (current: ${process.versions.node})`);
  }
  checks.push({ id: "node_version", ok: true, value: process.versions.node });

  try {
    require("node:sqlite");
    checks.push({ id: "sqlite_module", ok: true, value: "available" });
  } catch (error) {
    throw new Error(`node:sqlite unavailable: ${error.message || String(error)}`);
  }

  if (!fs.existsSync(options.dataDir)) {
    throw new Error(`data dir missing: ${options.dataDir}`);
  }
  const dataStat = fs.statSync(options.dataDir);
  if (!dataStat.isDirectory()) throw new Error(`data path is not a directory: ${options.dataDir}`);
  const sourceUserFiles = listUserFiles(options.dataDir);
  checks.push({ id: "source_user_files", ok: true, value: sourceUserFiles.length });

  const backup = readBackupEvidence(options.backupDir);
  if (!backup) {
    if (options.allowMissingBackup) {
      warnings.push(`backup archive missing under ${options.backupDir}`);
    } else {
      throw new Error(`no backup archive found under ${options.backupDir}; run npm run ops:backup:state first`);
    }
  } else {
    checks.push({ id: "latest_backup", ok: true, value: backup.name, age_hours: backup.age_hours });
    if (backup.age_hours > options.requireBackupMaxAgeHours) {
      if (options.allowStaleBackup) {
        warnings.push(`backup is stale (${backup.age_hours}h > ${options.requireBackupMaxAgeHours}h)`);
      } else {
        throw new Error(
          `latest backup is stale (${backup.age_hours}h > ${options.requireBackupMaxAgeHours}h); run npm run ops:backup:state`
        );
      }
    }
  }

  ensureWritableDir(path.dirname(options.sqlitePath));
  checks.push({ id: "sqlite_dir_writable", ok: true, value: path.dirname(options.sqlitePath) });
  ensureWritableDir(options.artifactDir);
  checks.push({ id: "artifact_dir_writable", ok: true, value: options.artifactDir });

  return {
    ok: true,
    checks,
    warnings,
    source_user_files: sourceUserFiles.length,
    backup,
  };
}

function buildMigratedUser(sourceUser, destinationUser) {
  const source = normalizeUserForCompare(sourceUser);
  const destination = destinationUser ? normalizeUserForCompare(destinationUser) : null;
  const next = { ...source };
  if (!next.token) {
    next.token = destination?.token || createToken();
  }
  if (!next.joined_at) {
    next.joined_at = destination?.joined_at || FALLBACK_NOW_ISO;
  }
  if (!next.last_updated) {
    next.last_updated = destination?.last_updated || next.joined_at;
  }
  return normalizeUserForCompare(next);
}

function planMigration(sourceMap, destinationMap) {
  const operations = [];
  const sortedChatIds = Array.from(sourceMap.keys()).sort((a, b) => a.localeCompare(b));
  for (const chatId of sortedChatIds) {
    const sourceUser = sourceMap.get(chatId);
    const destinationUser = destinationMap.get(chatId) || null;
    const nextUser = buildMigratedUser(sourceUser, destinationUser);
    const destinationHash = destinationUser ? hashUserForCompare(destinationUser) : "";
    const nextHash = hashUserForCompare(nextUser);
    const action = destinationUser
      ? (destinationHash === nextHash ? "unchanged" : "update")
      : "insert";
    operations.push({
      chatId,
      action,
      destination_hash: destinationHash,
      next_hash: nextHash,
      next_user: nextUser,
    });
  }

  const summary = {
    source_users: operations.length,
    inserted: operations.filter((row) => row.action === "insert").length,
    updated: operations.filter((row) => row.action === "update").length,
    unchanged: operations.filter((row) => row.action === "unchanged").length,
  };
  return {
    operations,
    summary,
  };
}

function loadDestinationMap(sqliteStore) {
  const users = sqliteStore.allUsers();
  return mapUsersByChatId(users, "destination sqlite users");
}

function verifyMigrationParity(plan, sqliteStore) {
  const destinationMap = loadDestinationMap(sqliteStore);
  for (const op of plan.operations) {
    const saved = destinationMap.get(op.chatId);
    if (!saved) throw new Error(`destination missing chatId after migration: ${op.chatId}`);
    const savedHash = hashUserForCompare(saved);
    if (savedHash !== op.next_hash) {
      throw new Error(`destination hash mismatch for chatId=${op.chatId}`);
    }
  }
}

function summarizeHash(plan) {
  const lines = plan.operations
    .map((op) => `${op.chatId}:${op.next_hash}`)
    .sort((a, b) => a.localeCompare(b));
  return sha256(lines.join("\n"));
}

function getCommitSha(rootDir = ROOT) {
  try {
    return String(execSync("git rev-parse --short HEAD", {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function writeArtifact(options, report) {
  const suffix = options.preflightOnly ? "preflight" : "run";
  const defaultName = `store-migration-file-to-sqlite-${backupTimestamp()}-${report.commit_sha}-${suffix}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.mkdirSync(options.artifactDir, { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  return artifactPath;
}

function resolveMigrationOptions(argv, env = process.env, baseDir = ROOT) {
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
    requireBackupMaxAgeHours: parsePositiveFloat(
      readOption(options, "require-backup-max-age-hours", "require_backup_max_age_hours"),
      24
    ),
    allowMissingBackup: flags.has("allow-missing-backup"),
    allowStaleBackup: flags.has("allow-stale-backup"),
    dryRun: flags.has("dry-run"),
    preflightOnly: flags.has("preflight-only"),
    skipIdempotencyCheck: flags.has("skip-idempotency-check"),
    help: flags.has("help") || flags.has("h"),
  };
}

function runMigration(rawOptions) {
  const startedAt = new Date();
  const options = {
    ...rawOptions,
    dataDir: path.resolve(String(rawOptions.dataDir || DEFAULT_DATA_DIR)),
    sqlitePath: path.resolve(String(rawOptions.sqlitePath || path.join(DEFAULT_DATA_DIR, "signalbrief.sqlite"))),
    backupDir: path.resolve(String(rawOptions.backupDir || DEFAULT_BACKUP_DIR)),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    requireBackupMaxAgeHours: parsePositiveFloat(rawOptions.requireBackupMaxAgeHours, 24),
    allowMissingBackup: rawOptions.allowMissingBackup === true,
    allowStaleBackup: rawOptions.allowStaleBackup === true,
    dryRun: rawOptions.dryRun === true,
    preflightOnly: rawOptions.preflightOnly === true,
    skipIdempotencyCheck: rawOptions.skipIdempotencyCheck === true,
    artifactName: String(rawOptions.artifactName || "").trim(),
    rootDir: path.resolve(String(rawOptions.rootDir || ROOT)),
  };
  const warnings = [];

  const preflight = runPreflight(options);
  const report = {
    version: 1,
    migration: "file_to_sqlite",
    host: os.hostname(),
    started_at_utc: startedAt.toISOString(),
    finished_at_utc: null,
    commit_sha: getCommitSha(options.rootDir),
    options: {
      data_dir: options.dataDir,
      sqlite_path: options.sqlitePath,
      backup_dir: options.backupDir,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
      require_backup_max_age_hours: options.requireBackupMaxAgeHours,
      dry_run: options.dryRun,
      preflight_only: options.preflightOnly,
      skip_idempotency_check: options.skipIdempotencyCheck,
    },
    preflight,
    summary: null,
    idempotent_replay: {
      checked: false,
      ok: true,
      pending_writes: 0,
    },
    checksums: null,
    warnings,
  };

  if (!options.preflightOnly) {
    const source = loadSourceUsers(options.dataDir);
    const sourceMap = mapUsersByChatId(source.users, "source users");
    const sqliteWarnings = [];
    const sqliteStore = createStore({
      backend: "sqlite",
      dataDir: options.dataDir,
      sqlitePath: options.sqlitePath,
      warningThrottleMs: 0,
      onWarning: (message) => sqliteWarnings.push(String(message || "")),
    });
    sqliteStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });
    const destinationMap = loadDestinationMap(sqliteStore);
    const plan = planMigration(sourceMap, destinationMap);

    let writesApplied = 0;
    if (!options.dryRun) {
      for (const op of plan.operations) {
        if (op.action === "unchanged") continue;
        sqliteStore.writeUser(op.chatId, op.next_user);
        writesApplied += 1;
      }
      sqliteStore.initStore({ dataDir: options.dataDir, rebuildIndex: true });
      verifyMigrationParity(plan, sqliteStore);
    } else {
      writesApplied = plan.summary.inserted + plan.summary.updated;
    }

    report.summary = {
      ...plan.summary,
      writes_applied: writesApplied,
      source_user_files: source.files.length,
    };
    report.checksums = {
      source_user_set_sha256: sha256(
        Array.from(sourceMap.entries())
          .map(([chatId, user]) => `${chatId}:${hashUserForCompare(user)}`)
          .sort((a, b) => a.localeCompare(b))
          .join("\n")
      ),
      migrated_target_set_sha256: summarizeHash(plan),
    };
    warnings.push(...sqliteWarnings.filter(Boolean));

    if (!options.skipIdempotencyCheck && !options.dryRun) {
      const replayPlan = planMigration(sourceMap, loadDestinationMap(sqliteStore));
      const pendingWrites = replayPlan.summary.inserted + replayPlan.summary.updated;
      report.idempotent_replay = {
        checked: true,
        ok: pendingWrites === 0,
        pending_writes: pendingWrites,
      };
      if (pendingWrites !== 0) {
        throw new Error(`idempotent replay failed: ${pendingWrites} pending writes after migration`);
      }
    }
  }

  report.finished_at_utc = new Date().toISOString();
  const artifactPath = writeArtifact(options, report);
  return {
    ...report,
    artifact_path: artifactPath,
  };
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/migrate-store-file-to-sqlite.js [options]",
      "",
      "Purpose:",
      "  Replay JSON user records (data/user-*.json) into SQLite with idempotent upserts.",
      "  Writes a release artifact JSON under artifacts/releases by default.",
      "",
      "Options:",
      "  --data-dir <dir>                         Source user-file directory (default: ./data)",
      "  --sqlite-path <file>                     Target sqlite file (default: <data-dir>/signalbrief.sqlite)",
      "  --backup-dir <dir>                       Backup archive dir (default: ./artifacts/backups)",
      "  --artifact-dir <dir>                     Output artifact dir (default: ./artifacts/releases)",
      "  --artifact-name <file.json>              Explicit artifact file name",
      "  --require-backup-max-age-hours <hours>   Fresh-backup threshold (default: 24)",
      "  --allow-missing-backup                   Do not fail preflight when no backup archive exists",
      "  --allow-stale-backup                     Do not fail preflight when backup is older than threshold",
      "  --dry-run                                Plan only; no sqlite writes",
      "  --preflight-only                         Run safety checks and write preflight artifact only",
      "  --skip-idempotency-check                 Skip second-pass replay check",
      "  --help                                   Show help",
    ].join("\n")
  );
}

function main() {
  const options = resolveMigrationOptions(process.argv.slice(2), process.env, ROOT);
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const result = runMigration({
      ...options,
      rootDir: ROOT,
    });
    log(`preflight: ok (source_user_files=${result.preflight.source_user_files})`);
    if (!result.options.preflight_only) {
      log(
        `summary: source=${result.summary.source_users} inserted=${result.summary.inserted} `
        + `updated=${result.summary.updated} unchanged=${result.summary.unchanged} `
        + `writes_applied=${result.summary.writes_applied}`
      );
      if (result.idempotent_replay.checked) {
        log(
          `idempotent_replay: ok=${result.idempotent_replay.ok} `
          + `pending_writes=${result.idempotent_replay.pending_writes}`
        );
      }
    }
    if (result.warnings.length) {
      for (const warning of result.warnings) {
        log(`warn: ${warning}`);
      }
    }
    log(`artifact=${result.artifact_path}`);
  } catch (error) {
    process.stderr.write(`[store-migrate] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  backupTimestamp,
  hashUserForCompare,
  listUserFiles,
  loadSourceUsers,
  mapUsersByChatId,
  parseArgs,
  planMigration,
  resolveMigrationOptions,
  runMigration,
  runPreflight,
};
