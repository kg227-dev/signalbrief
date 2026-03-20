#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const {
  DEFAULT_RELEASE_WINDOWS_ET,
  evaluateReleaseWindowGuard,
} = require("./release-window-guard-runtime");
const {
  DEFAULT_STAGING_ARTIFACT_PATH,
  DEFAULT_STAGING_ARTIFACT_MAX_AGE_MINUTES,
  evaluateStagingPromotionGate,
  formatStagingPromotionGateFailure,
  writeStagingDeployArtifact,
} = require("./deploy-promotion-gate-runtime");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_VERIFY_ATTEMPTS = parsePositiveInt(process.env.DEPLOY_PUBLIC_VERIFY_ATTEMPTS, 8, 1);
const PUBLIC_VERIFY_DELAY_MS = parsePositiveInt(process.env.DEPLOY_PUBLIC_VERIFY_DELAY_MS, 2500, 250);

function log(message) {
  process.stdout.write(`[deploy-prod] ${message}\n`);
}

function fail(message, detail = "") {
  process.stderr.write(`[deploy-prod] FAIL: ${message}\n`);
  if (detail) process.stderr.write(`${detail}\n`);
  process.exit(1);
}

function parsePositiveInt(rawValue, fallback, min = 1) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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
      return String(options[key]);
    }
  }
  return "";
}

function run(command, args, {
  cwd = ROOT,
  label = "",
  capture = false,
  env = null,
  input = null,
  prettyOverride = "",
} = {}) {
  const pretty = prettyOverride || [command, ...args].join(" ");
  log(`${label ? `${label}: ` : ""}${pretty}`);
  const stdio = capture
    ? ["pipe", "pipe", "pipe"]
    : (input == null ? "inherit" : ["pipe", "inherit", "inherit"]);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio,
    env: env ? { ...process.env, ...env } : process.env,
    input,
  });
  if (result.status !== 0) {
    const detail = capture
      ? [String(result.stdout || "").trim(), String(result.stderr || "").trim()].filter(Boolean).join("\n")
      : "";
    fail(`command failed (exit=${result.status}): ${pretty}`, detail);
  }
  return result;
}

function parseServiceList(rawValue) {
  return String(rawValue || "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return false;
  return ["1", "true", "yes", "y", "on"].includes(value);
}

function hasValue(rawValue) {
  return String(rawValue || "").trim().length > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactSnippet(text, maxLen = 280) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function responseDebugLines(response) {
  if (!response || typeof response !== "object") return [];
  const headers = response.headers && typeof response.headers === "object" ? response.headers : {};
  const snippet = compactSnippet(response.body || "");
  const lines = [
    `url: ${response.url || "-"}`,
    `status: ${Number(response.status || 0)}`,
    `cache-control: ${headers["cache-control"] || "-"}`,
    `location: ${headers.location || "-"}`,
  ];
  if (snippet) lines.push(`body: ${snippet}`);
  return lines;
}

function createVerifyError(message, response = null, detail = "") {
  const error = new Error(message);
  error.response = response;
  error.detail = detail;
  return error;
}

function verifyErrorDetail(error) {
  const lines = [];
  if (error?.message) lines.push(String(error.message));
  if (error?.detail) lines.push(String(error.detail));
  lines.push(...responseDebugLines(error?.response));
  return lines.filter(Boolean).join("\n");
}

async function eventually(label, attempts, delayMs, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        log(`${label}: attempt ${attempt}/${attempts} failed (${String(error?.message || error)}); retrying in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError || new Error(`${label} failed`);
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
        "User-Agent": "signalbrief-deploy-prod/1.0",
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
      res.on("data", (chunk) => { body += String(chunk); });
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

function getGitShortSha(ref = "HEAD") {
  const target = String(ref || "HEAD").trim() || "HEAD";
  try {
    const result = spawnSync("git", ["rev-parse", "--short", `${target}^{commit}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      fail("unable to resolve git commit SHA", String(result.stderr || result.stdout || "").trim());
    }
    return String(result.stdout || "").trim();
  } catch (error) {
    fail("unable to resolve git commit SHA", String(error?.message || error));
  }
  return "";
}

function getGitFullSha(ref = "HEAD") {
  const target = String(ref || "HEAD").trim() || "HEAD";
  try {
    const result = spawnSync("git", ["rev-parse", `${target}^{commit}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      fail("unable to resolve full git commit SHA", String(result.stderr || result.stdout || "").trim());
    }
    return String(result.stdout || "").trim();
  } catch (error) {
    fail("unable to resolve full git commit SHA", String(error?.message || error));
  }
  return "";
}

function verifyGitCommit(ref) {
  const target = String(ref || "").trim();
  if (!target) fail("deploy-sha cannot be empty");
  const result = spawnSync("git", ["rev-parse", "--verify", `${target}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`deploy-sha is not a valid commit: ${target}`, String(result.stderr || result.stdout || "").trim());
  }
}

function readGitRemoteOriginUrl() {
  try {
    const result = spawnSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) return "";
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function parseGithubRepoFromRemote(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return null;
  let match = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!match) {
    match = raw.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  }
  if (!match) return null;
  return {
    owner: String(match[1] || "").trim().toLowerCase(),
    repo: String(match[2] || "").trim().toLowerCase(),
  };
}

function resolveDefaultAppImageRepo() {
  const explicitRepo = String(process.env.DEPLOY_APP_IMAGE_REPO || "").trim().toLowerCase();
  if (explicitRepo) return explicitRepo;
  const githubRepo = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (githubRepo) {
    const [owner, repo] = githubRepo.split("/", 2);
    if (owner && repo) return `ghcr.io/${owner.toLowerCase()}/${repo.toLowerCase()}`;
  }
  const parsedRemote = parseGithubRepoFromRemote(readGitRemoteOriginUrl());
  if (parsedRemote?.owner && parsedRemote?.repo) {
    return `ghcr.io/${parsedRemote.owner}/${parsedRemote.repo}`;
  }
  return "";
}

function inferRegistryFromImage(appImage) {
  const raw = String(appImage || "").trim();
  if (!raw) return "";
  const firstSegment = raw.split("/")[0] || "";
  if (firstSegment.includes(".") || firstSegment.includes(":")) return firstSegment;
  return "";
}

function packageWorkingTreeArchive(archivePath) {
  run("tar", [
    "-czf",
    archivePath,
    "--exclude=.git",
    "--exclude=node_modules",
    "--exclude=data",
    "--exclude=archive",
    "--exclude=config.json",
    "--exclude=.env",
    "--exclude=.env.*",
    "--exclude=tmp",
    "--exclude=.desloppify",
    ".",
  ], {
    label: "pack",
    env: {
      COPYFILE_DISABLE: "1",
      COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
    },
  });
}

function packageCommitArchive(archivePath, archiveSha) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "signalbrief-pack-sha-"));
  const sourceTarPath = path.join(tmpRoot, `source-${String(archiveSha).slice(0, 12)}.tar`);
  const extractDir = path.join(tmpRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    run("git", [
      "archive",
      "--format=tar",
      "--output",
      sourceTarPath,
      archiveSha,
    ], { label: "pack source" });
    run("tar", ["-xf", sourceTarPath, "-C", extractDir], { label: "pack extract" });
    run("tar", [
      "-czf",
      archivePath,
      "--exclude=.git",
      "--exclude=node_modules",
      "--exclude=data",
      "--exclude=archive",
      "--exclude=config.json",
      "--exclude=.env",
      "--exclude=.env.*",
      "--exclude=tmp",
      "--exclude=.desloppify",
      ".",
    ], {
      cwd: extractDir,
      label: "pack",
      env: {
        COPYFILE_DISABLE: "1",
        COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
      },
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function buildComposeServiceArgs(services) {
  return (Array.isArray(services) ? services : []).map((service) => shellQuote(service)).join(" ");
}

function buildComposeEnvPrefix(appImage) {
  const image = String(appImage || "").trim();
  if (!image) return "";
  return `SIGNALBRIEF_APP_IMAGE=${shellQuote(image)} `;
}

function buildImageDeployRemoteSteps({
  remoteDir,
  services,
  skipRemoteVerify,
  appImage,
}) {
  const composeServices = buildComposeServiceArgs(services);
  const composeEnvPrefix = buildComposeEnvPrefix(appImage);
  const steps = [
    "set -euo pipefail",
    `cd ${shellQuote(remoteDir)}`,
    "echo '[deploy-prod] remote: compose pull'",
    `${composeEnvPrefix}docker compose pull ${composeServices}`.trim(),
    "echo '[deploy-prod] remote: compose up'",
    `${composeEnvPrefix}docker compose up -d --no-build ${composeServices}`.trim(),
  ];
  if (!skipRemoteVerify) {
    steps.push(
      "echo '[deploy-prod] remote: runtime verify'",
      "if command -v npm >/dev/null 2>&1; then "
      + "npm run -s ops:verify-runtime:quick; "
      + "elif command -v node >/dev/null 2>&1; then "
      + "node scripts/verify-runtime.js --skip-canary; "
      + "else "
      + "echo '[deploy-prod] WARN: remote verify skipped (npm and node missing on VM host)' >&2; "
      + "fi"
    );
  }
  steps.push("echo '[deploy-prod] remote: compose ps'");
  steps.push("docker compose ps");
  return steps;
}

function buildArchiveDeployRemoteSteps({
  remoteDir,
  remoteArchivePath,
  services,
  skipBuild,
  skipRemoteVerify,
  sha,
}) {
  const composeArgs = ["docker", "compose", "up", "-d"];
  if (!skipBuild) composeArgs.push("--build");
  composeArgs.push(...services);

  // Build separately with --no-cache so Docker doesn't serve stale source files
  // from a cached COPY layer. The deps stage (npm ci) is still fast because
  // package.json/package-lock.json rarely change and are in a separate stage.
  const buildNoCacheArgs = services.map((s) => shellQuote(s)).join(" ");

  const steps = [
    "set -euo pipefail",
    `cd ${shellQuote(remoteDir)}`,
    "echo '[deploy-prod] remote: extract archive'",
    `tar -xzf ${shellQuote(remoteArchivePath)}`,
    "echo '[deploy-prod] remote: compose build'",
    skipBuild ? "echo '[deploy-prod] remote: build skipped'" : `docker compose build --no-cache --build-arg ${shellQuote(`DEPLOY_SHA=${sha}`)} ${buildNoCacheArgs}`,
    "echo '[deploy-prod] remote: compose up'",
    composeArgs.filter((arg) => arg !== "--build").map((arg) => shellQuote(arg)).join(" "),
  ];
  if (!skipRemoteVerify) {
    steps.push(
      "echo '[deploy-prod] remote: runtime verify'",
      "if command -v npm >/dev/null 2>&1; then "
      + "npm run -s ops:verify-runtime:quick; "
      + "elif command -v node >/dev/null 2>&1; then "
      + "node scripts/verify-runtime.js --skip-canary; "
      + "else "
      + "echo '[deploy-prod] WARN: remote verify skipped (npm and node missing on VM host)' >&2; "
      + "fi"
    );
  }
  steps.push("echo '[deploy-prod] remote: compose ps'");
  steps.push("docker compose ps");
  steps.push(`rm -f ${shellQuote(remoteArchivePath)}`);
  return steps;
}

function remoteDockerLogin({ sshKey, sshTarget, registry, user, password }) {
  if (!hasValue(registry) || !hasValue(user) || !hasValue(password)) return;
  run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "ConnectTimeout=30",
    sshTarget,
    `docker login ${shellQuote(registry)} -u ${shellQuote(user)} --password-stdin`,
  ], {
    label: "remote registry login",
    input: `${String(password)}\n`,
    prettyOverride: `ssh -i ${sshKey} ${sshTarget} docker login ${registry} -u ${user} --password-stdin`,
  });
}

async function verifyPublicEndpoints(publicBaseUrl) {
  const base = String(publicBaseUrl || "").replace(/\/+$/, "");
  if (!base) fail("public URL is required for verification");
  const attempts = PUBLIC_VERIFY_ATTEMPTS;
  const delayMs = PUBLIC_VERIFY_DELAY_MS;

  try {
    log(`public verify: ${base}/`);
    await eventually("homepage check", attempts, delayMs, async () => {
      const response = await fetchUrl(`${base}/`);
      if (response.status !== 200) {
        throw createVerifyError(`expected 200, got ${response.status}`, response);
      }
      if (!response.body.includes(`id="darkToggle"`)) {
        throw createVerifyError("dark-toggle button markup missing", response);
      }
      if (response.body.includes("__ASSET_VERSION__")) {
        throw createVerifyError("asset version token was not rendered", response);
      }
      return response;
    });
  } catch (error) {
    fail("homepage check failed after retries", verifyErrorDetail(error));
  }

  try {
    log(`public verify: ${base}/signup`);
    await eventually("signup page check", attempts, delayMs, async () => {
      const response = await fetchUrl(`${base}/signup`);
      if (response.status !== 200) {
        throw createVerifyError(`expected 200, got ${response.status}`, response);
      }
      if (response.body.includes("__ASSET_VERSION__")) {
        throw createVerifyError("asset version token was not rendered in signup page", response);
      }
      const versionedScript = response.body.match(/<script\s+src="[^"]+\?v=([^"]+)"/i);
      if (!versionedScript) {
        throw createVerifyError("no cache-busted script tags found in signup page", response);
      }
      return response;
    });
  } catch (error) {
    fail("signup page check failed after retries", verifyErrorDetail(error));
  }

  try {
    const healthUrl = `${base}/api/health/scheduler`;
    log(`public verify: ${healthUrl}`);
    await eventually("scheduler health check", attempts, delayMs, async () => {
      const response = await fetchUrl(healthUrl);
      let parsed = null;
      try {
        parsed = JSON.parse(response.body || "{}");
      } catch {
        throw createVerifyError(`non-JSON response (status=${response.status})`, response);
      }
      if (response.status !== 200 || !parsed || parsed.ok !== true) {
        throw createVerifyError(
          `expected status=200 and ok=true, got status=${response.status} ok=${parsed?.ok}`,
          response,
          `scheduler payload: ${JSON.stringify(parsed, null, 2)}`
        );
      }
      return response;
    });
  } catch (error) {
    fail("scheduler health check failed after retries", verifyErrorDetail(error));
  }

  log("public verification passed");
}

async function main() {
  const { options, flags } = parseArgs(process.argv.slice(2));
  if (flags.has("help") || flags.has("h")) {
    process.stdout.write(
      [
        "Usage: node scripts/deploy-production.js [options]",
        "",
        "Options:",
        "  --host <ip-or-hostname>",
        "  --user <ssh-user>",
        "  --key <path-to-private-key>",
        "  --remote-dir <remote-app-dir>",
        "  --remote-tmp-dir <remote-tmp-dir>",
        "  --public-url <https://public-host>",
        "  --app-image <registry/image:tag>",
        "  --deploy-sha <commit-sha>",
        "  --registry <registry-host>",
        "  --registry-user <registry-user>",
        "  --archive-sha <commit-sha> (legacy alias for --deploy-sha)",
        "  --target-env <production|staging>",
        "  --services \"web bot worker\"",
        "  --staging-artifact-path <path>",
        "  --staging-artifact-max-age-minutes <n>",
        "  --release-windows-et <spec>",
        "  --release-window-tolerance-minutes <n>",
        "  --emergency-source-build",
        "  --hotfix",
        "  --skip-staging-gate",
        "  --allow-outside-window",
        "  --skip-build",
        "  --skip-remote-verify",
        "  --skip-public-verify",
        "",
        `Default release windows (ET): ${DEFAULT_RELEASE_WINDOWS_ET}`,
      ].join("\n")
    );
    return;
  }

  const sshHost = readOption(options, "host") || process.env.DEPLOY_SSH_HOST || "129.213.92.102";
  const sshUser = readOption(options, "user") || process.env.DEPLOY_SSH_USER || "ubuntu";
  const sshKey = readOption(options, "key") || process.env.DEPLOY_SSH_KEY || path.join(os.homedir(), ".ssh", "signalbrief_vm");
  const remoteDir = readOption(options, "remote-dir", "remote_dir") || process.env.DEPLOY_REMOTE_DIR || "/opt/signalbrief/app";
  const remoteTmpDir = readOption(options, "remote-tmp-dir", "remote_tmp_dir") || process.env.DEPLOY_REMOTE_TMP_DIR || "/tmp";
  const publicUrl = readOption(options, "public-url", "public_url") || process.env.DEPLOY_PUBLIC_URL || "https://getsignalbrief.com";
  let appImage = readOption(options, "app-image", "app_image") || process.env.DEPLOY_APP_IMAGE || "";
  let registry = readOption(options, "registry") || process.env.DEPLOY_REGISTRY || "";
  const registryUser = readOption(options, "registry-user", "registry_user") || process.env.DEPLOY_REGISTRY_USER || "";
  const registryPassword = process.env.DEPLOY_REGISTRY_PASSWORD || "";
  const deploySha = readOption(options, "deploy-sha", "deploy_sha", "archive-sha", "archive_sha");
  const targetEnv = (readOption(options, "target-env", "target_env") || process.env.DEPLOY_TARGET_ENV || "production")
    .toLowerCase()
    .trim();
  const stagingArtifactPath = readOption(options, "staging-artifact-path", "staging_artifact_path")
    || process.env.DEPLOY_STAGING_ARTIFACT_PATH
    || DEFAULT_STAGING_ARTIFACT_PATH;
  const stagingArtifactMaxAgeMinutes = parsePositiveInt(
    readOption(options, "staging-artifact-max-age-minutes", "staging_artifact_max_age_minutes")
    || process.env.DEPLOY_STAGING_ARTIFACT_MAX_AGE_MINUTES,
    DEFAULT_STAGING_ARTIFACT_MAX_AGE_MINUTES
  );

  const serviceListRaw = readOption(options, "services") || process.env.DEPLOY_SERVICES || "web bot worker";
  const services = parseServiceList(serviceListRaw);
  if (services.length === 0) fail("no deploy services provided");

  const skipBuild = flags.has("skip-build");
  const skipPublicVerify = flags.has("skip-public-verify");
  const skipRemoteVerify = flags.has("skip-remote-verify");
  const hotfixMode = flags.has("hotfix") || parseBoolean(process.env.DEPLOY_HOTFIX);
  const skipStagingGate = flags.has("skip-staging-gate")
    || parseBoolean(process.env.DEPLOY_SKIP_STAGING_GATE);
  const allowOutsideWindow = flags.has("allow-outside-window")
    || parseBoolean(process.env.DEPLOY_ALLOW_OUTSIDE_WINDOW);
  const emergencySourceBuild = flags.has("emergency-source-build")
    || parseBoolean(process.env.DEPLOY_EMERGENCY_SOURCE_BUILD);

  if (deploySha) verifyGitCommit(deploySha);
  const sha = getGitShortSha(deploySha || "HEAD");
  const fullSha = getGitFullSha(deploySha || "HEAD");
  const archiveName = `signalbrief-deploy-${sha}.tgz`;
  const archivePath = path.join(os.tmpdir(), archiveName);
  const remoteArchivePath = `${remoteTmpDir.replace(/\/+$/, "")}/${archiveName}`;
  const sshTarget = `${sshUser}@${sshHost}`;
  if (!hasValue(appImage) && targetEnv === "production" && !emergencySourceBuild) {
    const inferredRepo = resolveDefaultAppImageRepo();
    if (inferredRepo) {
      appImage = `${inferredRepo}:${fullSha}`;
      log(`app image inferred from git remote (app_image=${appImage})`);
    }
  }
  if (!hasValue(registry) && hasValue(appImage)) {
    registry = inferRegistryFromImage(appImage);
  }
  const imageDeployEnabled = hasValue(appImage);

  if (imageDeployEnabled && emergencySourceBuild) {
    fail("--emergency-source-build cannot be combined with --app-image");
  }
  if (!imageDeployEnabled && (hasValue(registry) || hasValue(registryUser) || hasValue(registryPassword))) {
    fail("registry credentials require --app-image deploy mode");
  }
  if (targetEnv === "production" && !imageDeployEnabled && !emergencySourceBuild) {
    fail(
      "production deploy requires a CI-built image or an explicit emergency fallback",
      [
        `resolved_commit=${fullSha}`,
        "Normal production deploys now pull a prebuilt image by commit SHA.",
        "Provide --app-image / DEPLOY_APP_IMAGE, or use --emergency-source-build only for incident fallback.",
      ].join("\n")
    );
  }
  if (imageDeployEnabled) {
    const partialRegistryConfig = [registry, registryUser, registryPassword].filter(hasValue).length;
    if (partialRegistryConfig > 0 && partialRegistryConfig < 3) {
      fail("registry deploy requires registry, registry user, and DEPLOY_REGISTRY_PASSWORD together");
    }
  }

  if (targetEnv === "production") {
    const stagingGateResult = evaluateStagingPromotionGate({
      targetEnv,
      deploySha: sha,
      artifactPath: stagingArtifactPath,
      maxAgeMinutes: stagingArtifactMaxAgeMinutes,
      bypass: hotfixMode || skipStagingGate,
      bypassMode: hotfixMode ? "hotfix" : "manual_override",
    });
    if (!stagingGateResult.allowed) {
      fail(
        "staging promotion gate blocked deploy",
        formatStagingPromotionGateFailure(stagingGateResult)
      );
    }
    if (stagingGateResult.enforced) {
      log(
        "staging promotion gate: pass "
        + `(artifact=${stagingGateResult.artifactPath}, age=${stagingGateResult.artifactAgeMinutes || 0}m)`
      );
    } else {
      log(`staging promotion gate: bypass (mode=${stagingGateResult.mode})`);
    }

    const releaseWindowResult = evaluateReleaseWindowGuard({
      windowsSpec: readOption(options, "release-windows-et", "release_windows_et")
        || process.env.DEPLOY_RELEASE_WINDOWS_ET
        || DEFAULT_RELEASE_WINDOWS_ET,
      toleranceMinutes: parsePositiveInt(
        readOption(options, "release-window-tolerance-minutes", "release_window_tolerance_minutes")
        || process.env.DEPLOY_RELEASE_WINDOW_TOLERANCE_MINUTES,
        45
      ),
      hotfix: hotfixMode,
      allowOutsideWindow,
    });

    const nextWindow = releaseWindowResult.next_window
      ? `${releaseWindowResult.next_window.label} (in ${releaseWindowResult.next_window.eta})`
      : "n/a";
    if (!releaseWindowResult.allowed) {
      fail(
        "release window gate blocked deploy",
        [
          `now_et=${releaseWindowResult.now_et.weekday_label} ${releaseWindowResult.now_et.time} ${releaseWindowResult.now_et.timezone}`,
          `next_window=${nextWindow}`,
          "Use --hotfix only for active incidents, or ship in the next planned release window.",
        ].join("\n")
      );
    }
    log(`release window gate: pass (mode=${releaseWindowResult.mode}, next_window=${nextWindow})`);
  } else {
    log(`release window gate: skipped (target_env=${targetEnv})`);
  }

  log(`commit=${sha}`);
  let remoteSteps = [];
  if (imageDeployEnabled) {
    log(`deploy mode=image (app_image=${appImage})`);
    remoteDockerLogin({
      sshKey,
      sshTarget,
      registry,
      user: registryUser,
      password: registryPassword,
    });
    remoteSteps = buildImageDeployRemoteSteps({
      remoteDir,
      services,
      skipRemoteVerify,
      appImage,
    });
  } else {
    log("deploy mode=emergency_source_build");
    if (deploySha) {
      log(`pack source commit=${deploySha}`);
      packageCommitArchive(archivePath, deploySha);
    } else {
      packageWorkingTreeArchive(archivePath);
    }

    run("scp", [
      "-i",
      sshKey,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=no",
      archivePath,
      `${sshTarget}:${remoteArchivePath}`,
    ], { label: "upload" });

    remoteSteps = buildArchiveDeployRemoteSteps({
      remoteDir,
      remoteArchivePath,
      services,
      skipBuild,
      skipRemoteVerify,
      sha,
    });
  }

  run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "ConnectTimeout=30",
    sshTarget,
    remoteSteps.join("; "),
  ], { label: "remote deploy" });

  if (!skipPublicVerify) {
    await verifyPublicEndpoints(publicUrl);
  } else {
    log("public verification skipped by flag");
  }

  if (targetEnv === "staging" && !skipPublicVerify) {
    const artifactResult = writeStagingDeployArtifact({
      sha,
      host: sshHost,
      publicUrl,
      services,
      publicVerificationPassed: true,
      completedAt: new Date().toISOString(),
    }, { artifactPath: stagingArtifactPath });
    log(`staging artifact recorded: ${artifactResult.artifactPath}`);
  } else if (targetEnv === "staging") {
    log("staging artifact skipped: public verification was not executed");
  }

  log(`DONE deploy=${sha} host=${sshHost}`);
}

main().catch((error) => {
  fail(error?.message || String(error));
});
