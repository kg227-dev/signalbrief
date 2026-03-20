"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawnSync } = require("child_process");
const { backupTimestamp, parseArgs } = require("./migrate-store-file-to-sqlite");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ARTIFACT_DIR = path.join(ROOT, "artifacts", "releases");
const DEFAULT_PUBLIC_URL = "https://getsignalbrief.com";
const DEFAULT_VERIFY_ATTEMPTS = 8;
const DEFAULT_VERIFY_DELAY_MS = 2500;

function readOption(options, ...keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      return String(options[key] || "").trim();
    }
  }
  return "";
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function resolvePath(raw, fallback, baseDir = ROOT) {
  const value = String(raw || "").trim();
  if (!value) return path.resolve(fallback);
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(baseDir, value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedMs) {
  return Math.max(0, Date.now() - Number(startedMs || Date.now()));
}

function runCommand(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd || ROOT,
    encoding: "utf8",
    stdio: opts.capture === true ? ["ignore", "pipe", "pipe"] : "inherit",
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  return {
    ok: result.status === 0,
    status: Number(result.status || 0),
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    command: [command, ...args].join(" "),
  };
}

function parseServiceList(rawValue) {
  return String(rawValue || "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveRollbackByShaOptions(argv, env = process.env, baseDir = ROOT) {
  const { options, flags } = parseArgs(argv);
  const rollbackSha = readOption(options, "rollback-sha", "rollback_sha", "sha");
  const restoreSha = readOption(options, "restore-sha", "restore_sha");
  const artifactDir = resolvePath(
    readOption(options, "artifact-dir", "artifact_dir") || String(env.SIGNALBRIEF_RELEASE_ARTIFACT_DIR || ""),
    DEFAULT_ARTIFACT_DIR,
    baseDir
  );
  const publicUrl = readOption(options, "public-url", "public_url")
    || String(env.DEPLOY_PUBLIC_URL || "").trim()
    || DEFAULT_PUBLIC_URL;

  const serviceListRaw = readOption(options, "services") || String(env.DEPLOY_SERVICES || "").trim() || "web bot worker";
  const services = parseServiceList(serviceListRaw);

  return {
    rollbackSha,
    restoreSha,
    artifactDir,
    artifactName: readOption(options, "artifact-name", "artifact_name"),
    publicUrl,
    host: readOption(options, "host") || String(env.DEPLOY_SSH_HOST || "").trim(),
    user: readOption(options, "user") || String(env.DEPLOY_SSH_USER || "").trim(),
    key: readOption(options, "key") || String(env.DEPLOY_SSH_KEY || "").trim(),
    remoteDir: readOption(options, "remote-dir", "remote_dir") || String(env.DEPLOY_REMOTE_DIR || "").trim(),
    remoteTmpDir: readOption(options, "remote-tmp-dir", "remote_tmp_dir") || String(env.DEPLOY_REMOTE_TMP_DIR || "").trim(),
    services,
    skipBuild: flags.has("skip-build"),
    skipRemoteVerify: flags.has("skip-remote-verify"),
    skipPublicVerify: flags.has("skip-public-verify"),
    emergencySourceBuild: flags.has("emergency-source-build"),
    keepWorktrees: flags.has("keep-worktrees"),
    allowOutsideWindow: !flags.has("respect-release-window"),
    hotfix: !flags.has("no-hotfix"),
    verifyAttempts: parsePositiveInt(
      readOption(options, "verify-attempts", "verify_attempts") || String(env.DEPLOY_PUBLIC_VERIFY_ATTEMPTS || ""),
      DEFAULT_VERIFY_ATTEMPTS
    ),
    verifyDelayMs: parsePositiveInt(
      readOption(options, "verify-delay-ms", "verify_delay_ms") || String(env.DEPLOY_PUBLIC_VERIFY_DELAY_MS || ""),
      DEFAULT_VERIFY_DELAY_MS
    ),
    help: flags.has("help") || flags.has("h"),
  };
}

function fetchUrl(url, { timeoutMs = 8000, maxRedirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`invalid URL: ${url}`));
      return;
    }
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(parsed, {
      method: "GET",
      timeout: timeoutMs,
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": "signalbrief-rollback-check/1.0",
      },
    }, (res) => {
      const status = Number(res.statusCode || 0);
      const location = res.headers && res.headers.location ? String(res.headers.location) : "";
      if (status >= 300 && status < 400 && location && maxRedirects > 0) {
        const redirected = new URL(location, parsed).toString();
        res.resume();
        fetchUrl(redirected, { timeoutMs, maxRedirects: maxRedirects - 1 }).then(resolve).catch(reject);
        return;
      }
      let body = "";
      res.on("data", (chunk) => { body += String(chunk || ""); });
      res.on("end", () => {
        resolve({
          url: parsed.toString(),
          status,
          headers: res.headers || {},
          body,
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

async function runPublicHealthChecklist(rawOptions = {}, deps = {}) {
  const request = typeof deps.request === "function" ? deps.request : fetchUrl;
  const attempts = parsePositiveInt(rawOptions.verifyAttempts, DEFAULT_VERIFY_ATTEMPTS);
  const delayMs = parsePositiveInt(rawOptions.verifyDelayMs, DEFAULT_VERIFY_DELAY_MS);
  const base = String(rawOptions.publicUrl || DEFAULT_PUBLIC_URL).replace(/\/+$/, "");

  let lastError = "";
  let latest = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const home = await request(`${base}/`);
      if (home.status !== 200) {
        throw new Error(`GET / expected 200 got ${home.status}`);
      }
      if (!home.body.includes("index.js?v=") || home.body.includes("__ASSET_VERSION__")) {
        throw new Error("landing page cache-busted script check failed");
      }
      const indexMatch = home.body.match(/<script\s+src="(index\.js\?v=[^"]+)"/i);
      if (!indexMatch) throw new Error("landing page missing index.js?v script tag");
      const indexPath = indexMatch[1];
      const index = await request(`${base}/${indexPath}`);
      if (index.status !== 200) {
        throw new Error(`GET /${indexPath} expected 200 got ${index.status}`);
      }
      const health = await request(`${base}/api/health/scheduler`);
      let parsedHealth = {};
      try {
        parsedHealth = JSON.parse(health.body || "{}");
      } catch {
        parsedHealth = {};
      }
      if (health.status !== 200 || parsedHealth.ok !== true) {
        throw new Error(`GET /api/health/scheduler expected 200+ok=true got status=${health.status} ok=${parsedHealth.ok}`);
      }
      return {
        ok: true,
        attempts_used: attempt,
        checks: {
          home_status: home.status,
          asset_path: indexPath,
          asset_status: index.status,
          scheduler_status: health.status,
          scheduler_ok: true,
        },
      };
    } catch (error) {
      lastError = error.message || String(error);
      latest = { attempt, error: lastError };
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  return {
    ok: false,
    attempts_used: attempts,
    error: lastError || "health checklist failed",
    latest,
  };
}

function ensureCommitAvailable(sha, deps = {}) {
  const run = typeof deps.runCommand === "function" ? deps.runCommand : runCommand;
  const result = run("git", ["rev-parse", "--verify", `${sha}^{commit}`], { cwd: ROOT, capture: true });
  return {
    ok: result.ok,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function buildDeployArgs(stepOptions) {
  const args = ["run", "ops:deploy:prod", "--"];
  if (stepOptions.hotfix) args.push("--hotfix");
  if (stepOptions.allowOutsideWindow) args.push("--allow-outside-window");
  if (stepOptions.skipBuild) args.push("--skip-build");
  if (stepOptions.skipRemoteVerify) args.push("--skip-remote-verify");
  if (stepOptions.skipPublicVerify) args.push("--skip-public-verify");
  if (stepOptions.emergencySourceBuild) args.push("--emergency-source-build");
  if (stepOptions.host) args.push("--host", stepOptions.host);
  if (stepOptions.user) args.push("--user", stepOptions.user);
  if (stepOptions.key) args.push("--key", stepOptions.key);
  if (stepOptions.remoteDir) args.push("--remote-dir", stepOptions.remoteDir);
  if (stepOptions.remoteTmpDir) args.push("--remote-tmp-dir", stepOptions.remoteTmpDir);
  if (stepOptions.publicUrl) args.push("--public-url", stepOptions.publicUrl);
  if (stepOptions.services && stepOptions.services.length) {
    args.push("--services", stepOptions.services.join(" "));
  }
  if (stepOptions.deploySha) args.push("--deploy-sha", stepOptions.deploySha);
  return args;
}

function deployCommitViaArchiveSha(commitSha, options = {}, deps = {}) {
  const run = typeof deps.runCommand === "function" ? deps.runCommand : runCommand;
  const deployArgs = buildDeployArgs({
    ...options,
    deploySha: commitSha,
  });
  const deploy = run("npm", deployArgs, {
    cwd: ROOT,
    capture: false,
  });

  return {
    ok: deploy.ok,
    worktree_path: null,
    add: null,
    deploy,
    remove: null,
    error: deploy.ok ? "" : (deploy.stderr || deploy.stdout || "deploy command failed"),
  };
}

function writeArtifact(options, payload) {
  const defaultName = `deploy-rollback-by-sha-${backupTimestamp()}.json`;
  const fileName = options.artifactName || defaultName;
  const artifactPath = path.join(options.artifactDir, fileName);
  fs.mkdirSync(options.artifactDir, { recursive: true });
  if (fs.existsSync(artifactPath)) {
    throw new Error(`artifact already exists: ${artifactPath}`);
  }
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

async function runRollbackStep(stepLabel, commitSha, options = {}, deps = {}) {
  const deployCommit = typeof deps.deployCommit === "function" ? deps.deployCommit : deployCommitViaArchiveSha;
  const healthCheck = typeof deps.healthCheck === "function" ? deps.healthCheck : runPublicHealthChecklist;

  const startedMs = Date.now();
  const startedAt = nowIso();
  const deployResult = deployCommit(commitSha, options, deps);
  const healthResult = deployResult.ok
    ? await healthCheck({
      publicUrl: options.publicUrl,
      verifyAttempts: options.verifyAttempts,
      verifyDelayMs: options.verifyDelayMs,
    }, deps)
    : { ok: false, skipped: true, error: "deploy failed" };
  const finishedAt = nowIso();
  const stepPass = deployResult.ok && healthResult.ok;

  return {
    label: stepLabel,
    commit_sha: commitSha,
    started_at_utc: startedAt,
    finished_at_utc: finishedAt,
    elapsed_ms: elapsedMs(startedMs),
    elapsed_seconds: Number((elapsedMs(startedMs) / 1000).toFixed(3)),
    pass: stepPass,
    deploy: {
      ok: deployResult.ok,
      worktree_path: deployResult.worktree_path || null,
      error: deployResult.error || "",
    },
    health: healthResult,
  };
}

async function runRollbackBySha(rawOptions, deps = {}) {
  const options = {
    ...rawOptions,
    rollbackSha: String(rawOptions.rollbackSha || "").trim(),
    restoreSha: String(rawOptions.restoreSha || "").trim(),
    artifactDir: path.resolve(String(rawOptions.artifactDir || DEFAULT_ARTIFACT_DIR)),
    artifactName: String(rawOptions.artifactName || "").trim(),
    publicUrl: String(rawOptions.publicUrl || DEFAULT_PUBLIC_URL).trim(),
    services: Array.isArray(rawOptions.services) ? rawOptions.services : [],
    hotfix: rawOptions.hotfix !== false,
    allowOutsideWindow: rawOptions.allowOutsideWindow !== false,
    keepWorktrees: rawOptions.keepWorktrees === true,
    emergencySourceBuild: rawOptions.emergencySourceBuild === true,
    skipBuild: rawOptions.skipBuild === true,
    skipRemoteVerify: rawOptions.skipRemoteVerify === true,
    skipPublicVerify: rawOptions.skipPublicVerify === true,
    verifyAttempts: parsePositiveInt(rawOptions.verifyAttempts, DEFAULT_VERIFY_ATTEMPTS),
    verifyDelayMs: parsePositiveInt(rawOptions.verifyDelayMs, DEFAULT_VERIFY_DELAY_MS),
  };
  if (!options.rollbackSha) {
    throw new Error("rollback-sha is required");
  }

  const startedMs = Date.now();
  const startedAt = nowIso();
  const commitChecks = {
    rollback: ensureCommitAvailable(options.rollbackSha, deps),
    restore: options.restoreSha ? ensureCommitAvailable(options.restoreSha, deps) : null,
  };
  if (!commitChecks.rollback.ok) {
    throw new Error(`rollback commit not found: ${options.rollbackSha}`);
  }
  if (commitChecks.restore && !commitChecks.restore.ok) {
    throw new Error(`restore commit not found: ${options.restoreSha}`);
  }

  const steps = [];
  const rollbackStep = await runRollbackStep("rollback", options.rollbackSha, options, deps);
  steps.push(rollbackStep);

  if (rollbackStep.pass && options.restoreSha) {
    const restoreStep = await runRollbackStep("restore", options.restoreSha, options, deps);
    steps.push(restoreStep);
  }

  const pass = steps.every((step) => step.pass === true)
    && (options.restoreSha ? steps.length === 2 : steps.length === 1);
  const report = {
    version: 1,
    workflow: "deploy_rollback_by_sha",
    started_at_utc: startedAt,
    finished_at_utc: nowIso(),
    elapsed_ms: elapsedMs(startedMs),
    elapsed_seconds: Number((elapsedMs(startedMs) / 1000).toFixed(3)),
    options: {
      rollback_sha: options.rollbackSha,
      restore_sha: options.restoreSha || null,
      public_url: options.publicUrl,
      artifact_dir: options.artifactDir,
      artifact_name: options.artifactName || null,
      hotfix: options.hotfix,
      allow_outside_window: options.allowOutsideWindow,
      keep_worktrees: options.keepWorktrees,
      verify_attempts: options.verifyAttempts,
      verify_delay_ms: options.verifyDelayMs,
    },
    commit_checks: {
      rollback_ok: commitChecks.rollback.ok,
      restore_ok: commitChecks.restore ? commitChecks.restore.ok : null,
    },
    rollback_recovery_seconds: Number((steps[0]?.elapsed_seconds || 0).toFixed(3)),
    steps,
    pass,
  };

  const artifactPath = writeArtifact(options, report);
  return {
    ...report,
    artifact_path: artifactPath,
  };
}

module.exports = {
  deployCommitViaArchiveSha,
  resolveRollbackByShaOptions,
  runPublicHealthChecklist,
  runRollbackBySha,
  runRollbackStep,
};
