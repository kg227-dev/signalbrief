"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_STAGING_ARTIFACT_PATH = path.resolve(
  process.cwd(),
  "artifacts",
  "releases",
  "latest-staging-deploy.json"
);
const DEFAULT_STAGING_ARTIFACT_MAX_AGE_MINUTES = 24 * 60;

function parseTimestampMs(value) {
  const ts = Date.parse(String(value || "").trim());
  if (!Number.isFinite(ts)) return 0;
  return ts;
}

function normalizeArtifactPath(artifactPath) {
  const raw = String(artifactPath || "").trim();
  if (!raw) return DEFAULT_STAGING_ARTIFACT_PATH;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), raw);
}

function readStagingDeployArtifact(artifactPath, fsImpl = fs) {
  const filePath = normalizeArtifactPath(artifactPath);
  if (!fsImpl.existsSync(filePath)) {
    return {
      ok: false,
      reason: "missing_artifact",
      message: `staging artifact not found: ${filePath}`,
      filePath,
      artifact: null,
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_artifact_json",
      message: `staging artifact is not valid JSON: ${filePath}`,
      detail: String(error?.message || error),
      filePath,
      artifact: null,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      reason: "invalid_artifact_shape",
      message: `staging artifact must be an object: ${filePath}`,
      filePath,
      artifact: null,
    };
  }

  return {
    ok: true,
    reason: "ok",
    message: "",
    filePath,
    artifact: parsed,
  };
}

function evaluateStagingPromotionGate(options = {}) {
  const targetEnv = String(options.targetEnv || "production").toLowerCase().trim();
  if (targetEnv !== "production") {
    return {
      allowed: true,
      enforced: false,
      mode: "non_production_target",
      message: "",
      artifactPath: normalizeArtifactPath(options.artifactPath),
      artifact: null,
    };
  }

  if (options.bypass) {
    return {
      allowed: true,
      enforced: false,
      mode: String(options.bypassMode || "manual_override").trim() || "manual_override",
      message: "",
      artifactPath: normalizeArtifactPath(options.artifactPath),
      artifact: null,
    };
  }

  const artifactRead = readStagingDeployArtifact(options.artifactPath, options.fsImpl);
  if (!artifactRead.ok) {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: artifactRead.message,
      detail: artifactRead.detail || "",
      artifactPath: artifactRead.filePath,
      artifact: null,
    };
  }

  const artifact = artifactRead.artifact;
  const artifactTarget = String(artifact.target_env || "").toLowerCase().trim();
  if (artifactTarget !== "staging") {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: `staging artifact target_env must be "staging" (found "${artifactTarget || "unknown"}")`,
      artifactPath: artifactRead.filePath,
      artifact,
    };
  }

  if (artifact.public_verification_passed !== true) {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: "staging artifact does not show successful public verification",
      artifactPath: artifactRead.filePath,
      artifact,
    };
  }

  const deploySha = String(options.deploySha || "").trim();
  const artifactSha = String(artifact.sha || "").trim();
  if (!deploySha) {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: "deploy SHA is required for staging promotion gate",
      artifactPath: artifactRead.filePath,
      artifact,
    };
  }
  if (!artifactSha || artifactSha !== deploySha) {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: `staging artifact SHA mismatch (artifact=${artifactSha || "missing"}, deploy=${deploySha})`,
      artifactPath: artifactRead.filePath,
      artifact,
    };
  }

  const maxAgeMinutesRaw = Number(options.maxAgeMinutes);
  const maxAgeMinutes = Number.isFinite(maxAgeMinutesRaw) && maxAgeMinutesRaw > 0
    ? Math.floor(maxAgeMinutesRaw)
    : DEFAULT_STAGING_ARTIFACT_MAX_AGE_MINUTES;
  const nowMs = Number.isFinite(Number(options.nowMs))
    ? Number(options.nowMs)
    : Date.now();
  const completedAtMs = parseTimestampMs(artifact.completed_at);
  if (!completedAtMs) {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: "staging artifact completed_at timestamp is missing or invalid",
      artifactPath: artifactRead.filePath,
      artifact,
    };
  }

  const artifactAgeMs = Math.max(0, nowMs - completedAtMs);
  const maxAgeMs = maxAgeMinutes * 60 * 1000;
  if (artifactAgeMs > maxAgeMs) {
    return {
      allowed: false,
      enforced: true,
      mode: "require_staging",
      message: `staging artifact is too old (age=${Math.ceil(artifactAgeMs / 60000)}m, max=${maxAgeMinutes}m)`,
      artifactPath: artifactRead.filePath,
      artifact,
    };
  }

  return {
    allowed: true,
    enforced: true,
    mode: "require_staging",
    message: "",
    artifactPath: artifactRead.filePath,
    artifact,
    artifactAgeMinutes: Math.ceil(artifactAgeMs / 60000),
  };
}

function formatStagingPromotionGateFailure(result) {
  const lines = [];
  lines.push(String(result?.message || "staging promotion gate failed"));
  if (result?.detail) lines.push(String(result.detail));
  if (result?.artifactPath) lines.push(`artifact_path=${result.artifactPath}`);
  if (result?.artifact && typeof result.artifact === "object") {
    const sha = String(result.artifact.sha || "").trim() || "missing";
    const completedAt = String(result.artifact.completed_at || "").trim() || "missing";
    const target = String(result.artifact.target_env || "").trim() || "missing";
    lines.push(`artifact_target_env=${target}`);
    lines.push(`artifact_sha=${sha}`);
    lines.push(`artifact_completed_at=${completedAt}`);
  }
  lines.push(
    "Run `npm run ops:deploy:staging` for this commit, or use `npm run ops:deploy:prod:override`"
    + " (wraps `--skip-staging-gate --allow-outside-window`) for an explicit non-incident override."
  );
  return lines.filter(Boolean).join("\n");
}

function writeStagingDeployArtifact(payload, options = {}) {
  const artifactPath = normalizeArtifactPath(options.artifactPath);
  const fsImpl = options.fsImpl || fs;
  const artifact = {
    schema_version: 1,
    target_env: "staging",
    sha: String(payload?.sha || "").trim(),
    host: String(payload?.host || "").trim(),
    public_url: String(payload?.publicUrl || "").trim(),
    services: Array.isArray(payload?.services) ? payload.services.map((item) => String(item)) : [],
    public_verification_passed: payload?.publicVerificationPassed === true,
    completed_at: String(payload?.completedAt || new Date().toISOString()),
    source: "deploy-production.js",
  };

  fsImpl.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fsImpl.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return {
    artifactPath,
    artifact,
  };
}

module.exports = {
  DEFAULT_STAGING_ARTIFACT_PATH,
  DEFAULT_STAGING_ARTIFACT_MAX_AGE_MINUTES,
  normalizeArtifactPath,
  readStagingDeployArtifact,
  evaluateStagingPromotionGate,
  formatStagingPromotionGateFailure,
  writeStagingDeployArtifact,
};
