#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STATE_DIRS = ["data", "archive"];
const DEFAULT_BACKUP_DIR = process.env.SIGNALBRIEF_BACKUP_DIR || path.join(ROOT, "artifacts", "backups");
const DEFAULT_KEEP = Math.max(1, Number(process.env.SIGNALBRIEF_BACKUP_KEEP || 14));

function log(message) {
  process.stdout.write(`[backup-state] ${message}\n`);
}

function fail(message, detail = "") {
  process.stderr.write(`[backup-state] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
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

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/backup-state.js [options]",
      "",
      "Options:",
      "  --state-dirs \"data archive\"     Directories to back up (default: data archive)",
      "  --backup-dir <dir>               Output directory (default: artifacts/backups)",
      "  --name <file.tgz>                Custom archive file name",
      "  --keep <n>                       Keep newest n backups (default: 14)",
      "  --allow-missing                  Skip missing state directories",
      "  --dry-run                        Build manifest, skip tar output",
      "  Manifest output records canonical SQLite assets when present:",
      "    signalbrief.sqlite, signalbrief.sqlite-wal, signalbrief.sqlite-shm",
      "  --help                           Show help",
    ].join("\n")
  );
}

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function parseStateDirList(raw) {
  if (!raw) return DEFAULT_STATE_DIRS.slice();
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeLabel(absPath) {
  const rel = path.relative(ROOT, absPath);
  if (rel && !rel.startsWith("..")) return rel.split(path.sep).join("/");
  return path.basename(absPath);
}

function resolveStateDirs(dirList, allowMissing) {
  const resolved = [];
  for (const entry of dirList) {
    const absPath = path.resolve(ROOT, entry);
    if (!fs.existsSync(absPath)) {
      if (allowMissing) {
        log(`warn: missing state dir skipped: ${entry}`);
        continue;
      }
      fail(`state dir missing: ${entry}`);
    }
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) fail(`state path is not a directory: ${entry}`);
    resolved.push({
      label: normalizeLabel(absPath),
      absPath,
    });
  }
  if (resolved.length === 0) fail("no state directories resolved");
  return resolved;
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function listFilesRecursive(rootDir, prefix) {
  const files = [];
  const stack = [{ absDir: rootDir, relDir: "" }];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.absDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absPath = path.join(current.absDir, entry.name);
      const relPath = current.relDir ? `${current.relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push({ absDir: absPath, relDir: relPath });
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = fs.statSync(absPath);
      files.push({
        path: `${prefix}/${relPath}`,
        size: stat.size,
        sha256: hashFile(absPath),
      });
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function getCommitSha() {
  try {
    return String(execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function run(command, args, { cwd = ROOT, label = "" } = {}) {
  const pretty = [command, ...args].join(" ");
  log(`${label ? `${label}: ` : ""}${pretty}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = [String(result.stdout || "").trim(), String(result.stderr || "").trim()]
      .filter(Boolean)
      .join("\n");
    fail(`command failed (exit=${result.status}): ${pretty}`, detail);
  }
}

function ensureDir(absPath) {
  fs.mkdirSync(absPath, { recursive: true });
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function pruneBackups(backupDir, keep) {
  const files = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tgz"))
    .map((entry) => {
      const absPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(absPath);
      return { name: entry.name, absPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (let i = keep; i < files.length; i += 1) {
    fs.unlinkSync(files[i].absPath);
    log(`prune: removed ${files[i].name}`);
  }
}

function copyStateToStage(stateDirs, stageDir) {
  for (const dir of stateDirs) {
    const dest = path.join(stageDir, dir.label);
    fs.cpSync(dir.absPath, dest, {
      recursive: true,
      preserveTimestamps: true,
      force: true,
    });
  }
}

function buildManifest({ stateDirs }) {
  const files = [];
  for (const dir of stateDirs) {
    const dirFiles = listFilesRecursive(dir.absPath, dir.label);
    files.push(...dirFiles);
  }
  const sqlitePrimaryAssets = files
    .map((file) => file.path)
    .filter((filePath) => /(^|\/)signalbrief\.sqlite(?:-wal|-shm)?$/i.test(filePath));
  const totalBytes = files.reduce((sum, row) => sum + Number(row.size || 0), 0);
  return {
    version: 1,
    generated_at_utc: new Date().toISOString(),
    host: os.hostname(),
    root: ROOT,
    commit_sha: getCommitSha(),
    state_dirs: stateDirs.map((row) => row.label),
    canonical_state_assets: {
      sqlite_primary: sqlitePrimaryAssets,
    },
    file_count: files.length,
    total_bytes: totalBytes,
    files,
  };
}

function main() {
  const { options, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    printHelp();
    return;
  }

  const stateDirsRaw = readOption(options, "state-dirs", "state_dirs");
  const backupDirRaw = readOption(options, "backup-dir", "backup_dir");
  const keepRaw = readOption(options, "keep");
  const archiveNameRaw = readOption(options, "name");
  const dryRun = flags.has("dry-run");
  const allowMissing = flags.has("allow-missing");

  const stateDirList = parseStateDirList(stateDirsRaw);
  const backupDir = backupDirRaw ? path.resolve(ROOT, backupDirRaw) : DEFAULT_BACKUP_DIR;
  const keep = parsePositiveInt(keepRaw || "", DEFAULT_KEEP);

  const stateDirs = resolveStateDirs(stateDirList, allowMissing);
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "signalbrief-backup-"));
  const stamp = backupTimestamp();

  ensureDir(backupDir);

  try {
    copyStateToStage(stateDirs, stageDir);
    const stagedDirs = stateDirs.map((dir) => ({
      label: dir.label,
      absPath: path.join(stageDir, dir.label),
    }));
    const manifest = buildManifest({ stateDirs: stagedDirs });
    const archiveName = archiveNameRaw || `state-backup-${stamp}-${manifest.commit_sha}.tgz`;
    const archivePath = path.join(backupDir, archiveName);
    if (fs.existsSync(archivePath)) fail(`archive already exists: ${archivePath}`);

    fs.writeFileSync(path.join(stageDir, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (dryRun) {
      log(`dry-run: manifest prepared for ${manifest.file_count} files (${manifest.total_bytes} bytes)`);
      log(`dry-run: output archive would be ${archivePath}`);
      return;
    }

    run("tar", ["-czf", archivePath, "-C", stageDir, "."], { label: "pack" });
    pruneBackups(backupDir, keep);
    log(`OK archive=${archivePath}`);
    log(`files=${manifest.file_count} bytes=${manifest.total_bytes}`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  backupTimestamp,
  parseArgs,
  parseStateDirList,
  parsePositiveInt,
};
