const fs = require("fs");
const path = require("path");
const { MVP_TOPIC_TAGS } = require("../platform/config/mvp-topics");
const { validateConfigSchema } = require("./config-schema-runtime");
const {
  canonicalizeMvpTopicTag,
} = require("./topic-normalization-runtime");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(APP_ROOT, "config.json");
const CONFIG_EXAMPLE_PATH = path.join(APP_ROOT, "config.example.json");
const ENV_OVERRIDE_MAP = Object.freeze([
  { path: ["admin", "email"], env: ["SIGNALBRIEF_ADMIN_EMAIL", "ADMIN_EMAIL"] },
  { path: ["admin", "salt"], env: ["SIGNALBRIEF_ADMIN_SALT", "ADMIN_SALT"] },
  { path: ["admin", "passwordHash"], env: ["SIGNALBRIEF_ADMIN_PASSWORD_HASH", "ADMIN_PASSWORD_HASH"] },
  { path: ["keys", "perplexity"], env: ["SIGNALBRIEF_PERPLEXITY_API_KEY", "PERPLEXITY_API_KEY"] },
  { path: ["keys", "anthropic"], env: ["SIGNALBRIEF_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"] },
  { path: ["keys", "resendApiKey"], env: ["SIGNALBRIEF_RESEND_API_KEY", "RESEND_API_KEY"] },
  { path: ["keys", "unsubscribeSigningSecret"], env: ["SIGNALBRIEF_UNSUBSCRIBE_SIGNING_SECRET", "UNSUBSCRIBE_SIGNING_SECRET"] },
  { path: ["keys", "fromEmail"], env: ["SIGNALBRIEF_FROM_EMAIL"] },
  { path: ["keys", "fromName"], env: ["SIGNALBRIEF_FROM_NAME"] },
]);
let cachedConfig = null;

function readEnvString(candidates, fallback = "") {
  for (const candidate of (Array.isArray(candidates) ? candidates : [candidates])) {
    const raw = process.env[candidate];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return String(fallback || "").trim();
}

function readEnvNumber(candidates, fallback) {
  const raw = readEnvString(candidates, "");
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnvBoolean(candidates, fallback = false) {
  const raw = readEnvString(candidates, "");
  if (!raw) return Boolean(fallback);
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return Boolean(fallback);
}

function configError(stage, configPath, err) {
  const wrapped = new Error(`[config] ${stage} (${configPath}): ${err.message}`);
  wrapped.code = `config_${stage}`;
  wrapped.cause = err;
  return wrapped;
}

function normalizeConfigPath(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.join(APP_ROOT, trimmed);
}

function resolveConfigPath(explicitPath = "") {
  const explicit = normalizeConfigPath(explicitPath);
  if (explicit) return explicit;
  const envPath = normalizeConfigPath(readEnvString(["SIGNALBRIEF_CONFIG_PATH"], ""));
  if (envPath) return envPath;
  if (fs.existsSync(CONFIG_PATH)) return CONFIG_PATH;
  return CONFIG_EXAMPLE_PATH;
}

function setNested(target, pathParts, value) {
  let cursor = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const key = pathParts[i];
    if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[pathParts[pathParts.length - 1]] = value;
}

function applyEnvOverrides(config) {
  const resolved = JSON.parse(JSON.stringify(config));
  for (const entry of ENV_OVERRIDE_MAP) {
    const override = readEnvString(entry.env);
    if (!override) continue;
    setNested(resolved, entry.path, override);
  }
  return resolved;
}

function normalizeTopicQueries(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function normalizeMvpTopics(rawTopics) {
  const byTag = new Map();
  for (const rawTopic of (Array.isArray(rawTopics) ? rawTopics : [])) {
    const canonicalTag = canonicalizeMvpTopicTag(rawTopic?.tag);
    if (!canonicalTag || byTag.has(canonicalTag)) continue;
    byTag.set(canonicalTag, {
      ...(rawTopic && typeof rawTopic === "object" ? rawTopic : {}),
      tag: canonicalTag,
      queries: normalizeTopicQueries(rawTopic?.queries),
    });
  }
  return MVP_TOPIC_TAGS
    .filter((tag) => byTag.has(tag))
    .map((tag) => byTag.get(tag));
}

function normalizeMvpConfig(config) {
  const resolved = JSON.parse(JSON.stringify(config));
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
    if (!resolved.digest || typeof resolved.digest !== "object" || Array.isArray(resolved.digest)) {
      resolved.digest = {};
    }
    resolved.digest.itemCount = 5;
    const configuredSourceCap = Number(resolved.digest.maxItemsPerSourceDomain);
    resolved.digest.maxItemsPerSourceDomain = Number.isFinite(configuredSourceCap)
      ? Math.max(5, Math.trunc(configuredSourceCap))
      : 5;
    resolved.topics = normalizeMvpTopics(resolved.topics);
  }
  return resolved;
}

function loadConfig(opts = {}) {
  if (!opts.reload && cachedConfig) return cachedConfig;
  const configPath = resolveConfigPath(opts.configPath);

  let raw = "";
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw configError("read_failed", configPath, err);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw configError("parse_failed", configPath, err);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw configError("invalid_shape", configPath, new Error("config root must be an object"));
  }

  const merged = normalizeMvpConfig(applyEnvOverrides(parsed));
  const validation = validateConfigSchema(merged);
  if (!validation.ok) {
    throw configError("schema_failed", configPath, new Error(validation.errors.join("; ")));
  }

  cachedConfig = merged;
  return cachedConfig;
}

function getNodeEnv() {
  return readEnvString(["NODE_ENV"], "");
}

function isProductionRuntime() {
  return getNodeEnv().toLowerCase() === "production";
}

function getBaseUrl(defaultValue = "https://getsignalbrief.com") {
  return readEnvString(["BASE_URL"], defaultValue) || defaultValue;
}

function isAllowExampleSignupsEnabled() {
  return readEnvBoolean(["ALLOW_EXAMPLE_SIGNUPS"], false) || !isProductionRuntime();
}

function isDigestDryRunEnabled() {
  return readEnvBoolean(["DIGEST_DRY_RUN"], false);
}

function getOpsAlertEmail() {
  return readEnvString(["OPS_ALERT_EMAIL"], "");
}

function getDigestTriggerSource() {
  return readEnvString(["SIGNALBRIEF_DIGEST_TRIGGER_SOURCE"], "");
}

function getRollingZeroValueCapUsd() {
  return readEnvNumber(["ROLLING_ZERO_VALUE_CAP_USD"], 1.00);
}

function getDailyZeroValueCapUsd() {
  return readEnvNumber(["DAILY_ZERO_VALUE_CAP_USD"], 2.50);
}

function getRollingZeroValueWindowHours() {
  return Math.trunc(readEnvNumber(["ROLLING_ZERO_VALUE_WINDOW_HOURS"], 6));
}

function getDigestLockStaleMs() {
  return Math.max(5 * 60 * 1000, readEnvNumber(["DIGEST_LOCK_STALE_MS"], 2 * 60 * 60 * 1000));
}

function getProviderEnvOverrides(prefix) {
  const normalized = String(prefix || "").trim().toUpperCase();
  return {
    timeoutMs: readEnvString([`${normalized}_TIMEOUT_MS`], ""),
    retries: readEnvString([`${normalized}_RETRIES`], ""),
    retryDelayMs: readEnvString([`${normalized}_RETRY_DELAY_MS`], ""),
    retryStatusCodes: readEnvString([`${normalized}_RETRY_STATUS_CODES`], ""),
  };
}

function getPerplexityProviderEnvOverrides() {
  return getProviderEnvOverrides("SIGNALBRIEF_PERPLEXITY");
}

function getAnthropicProviderEnvOverrides() {
  return getProviderEnvOverrides("SIGNALBRIEF_ANTHROPIC");
}

function getPerplexityMaxConcurrentFetchesOverride() {
  return readEnvString(["SIGNALBRIEF_PERPLEXITY_MAX_CONCURRENT_FETCHES"], "");
}

function isStandardEvidenceResolverEnabled() {
  return readEnvBoolean(["SIGNALBRIEF_ENABLE_STANDARD_EVIDENCE_RESOLVER"], false);
}

function getDigestRunnerPollMinMs() {
  return Math.max(250, readEnvNumber(["DIGEST_RUNNER_POLL_MIN_MS"], 1000));
}

function getDigestRunnerPollMaxMs() {
  return Math.max(getDigestRunnerPollMinMs(), readEnvNumber(["DIGEST_RUNNER_POLL_MAX_MS"], 8000));
}

function getDigestRunnerStartConfirmMs() {
  return Math.max(
    500,
    readEnvNumber(["DIGEST_RUNNER_START_CONFIRM_MS", "DIGEST_RUNNER_QUEUE_CONFIRM_MS"], 4000)
  );
}

function getDigestRunnerStartConfirmPollMs() {
  return Math.max(
    50,
    readEnvNumber(["DIGEST_RUNNER_START_CONFIRM_POLL_MS", "DIGEST_RUNNER_QUEUE_CONFIRM_POLL_MS"], 120)
  );
}

function isDigestRunnerDebugEnabled() {
  return readEnvBoolean(["DEBUG_DIGEST_RUNNER"], false);
}

function getSchedulerPollMs() {
  return Math.max(60 * 1000, readEnvNumber(["DIGEST_POLL_MS"], 5 * 60 * 1000));
}

function getSchedulerStartupDelayMs() {
  return Math.max(0, readEnvNumber(["DIGEST_STARTUP_DELAY_MS"], 3000));
}

function isSchedulerRunOnStartupEnabled() {
  return readEnvBoolean(["DIGEST_RUN_ON_STARTUP"], true);
}

function getSchedulerRunTimeoutMs() {
  return Math.max(60 * 1000, readEnvNumber(["DIGEST_RUN_TIMEOUT_MS"], 25 * 60 * 1000));
}

function getInventoryRefreshMs() {
  return Math.max(0, readEnvNumber(["DIGEST_INVENTORY_REFRESH_MS"], 4 * 60 * 60 * 1000));
}

function isInventoryRefreshOnStartupEnabled() {
  return readEnvBoolean(["DIGEST_INVENTORY_REFRESH_ON_STARTUP"], true);
}

function getInventoryStartupDelayMs(fallbackMs) {
  return Math.max(60 * 1000, readEnvNumber(["DIGEST_INVENTORY_STARTUP_DELAY_MS"], fallbackMs));
}

function getDigestWorkerArgsEnv() {
  return readEnvString(["DIGEST_WORKER_ARGS"], "");
}

function getDigestLockUnhealthyBlockThreshold() {
  return Math.max(1, readEnvNumber(["DIGEST_LOCK_UNHEALTHY_BLOCK_THRESHOLD"], 3));
}

function getMailerTimeoutMs() {
  return Math.max(1000, readEnvNumber(["SIGNALBRIEF_MAILER_TIMEOUT_MS"], 15_000));
}

function getUnsubscribeSigningSecretOverride() {
  return readEnvString(["SIGNALBRIEF_UNSUBSCRIBE_SIGNING_SECRET"], "");
}

function getStoreBackendOverride() {
  return readEnvString(["SIGNALBRIEF_STORE_BACKEND"], "");
}

function getStoreCanaryChatIdsEnv() {
  return readEnvString(["SIGNALBRIEF_STORE_CANARY_CHAT_IDS"], "");
}

function getStoreCanaryMirrorWritesEnv() {
  return readEnvString(["SIGNALBRIEF_STORE_CANARY_MIRROR_WRITES"], "");
}

function getStoreSqlitePathOverride() {
  return readEnvString(["SIGNALBRIEF_SQLITE_PATH"], "");
}

module.exports = {
  CONFIG_PATH,
  CONFIG_EXAMPLE_PATH,
  readEnvString,
  readEnvNumber,
  readEnvBoolean,
  resolveConfigPath,
  applyEnvOverrides,
  loadConfig,
  validateConfigSchema,
  normalizeMvpConfig,
  getNodeEnv,
  isProductionRuntime,
  getBaseUrl,
  isAllowExampleSignupsEnabled,
  isDigestDryRunEnabled,
  getOpsAlertEmail,
  getDigestTriggerSource,
  getRollingZeroValueCapUsd,
  getDailyZeroValueCapUsd,
  getRollingZeroValueWindowHours,
  getDigestLockStaleMs,
  getPerplexityProviderEnvOverrides,
  getAnthropicProviderEnvOverrides,
  getPerplexityMaxConcurrentFetchesOverride,
  isStandardEvidenceResolverEnabled,
  getDigestRunnerPollMinMs,
  getDigestRunnerPollMaxMs,
  getDigestRunnerStartConfirmMs,
  getDigestRunnerStartConfirmPollMs,
  isDigestRunnerDebugEnabled,
  getSchedulerPollMs,
  getSchedulerStartupDelayMs,
  isSchedulerRunOnStartupEnabled,
  getSchedulerRunTimeoutMs,
  getInventoryRefreshMs,
  isInventoryRefreshOnStartupEnabled,
  getInventoryStartupDelayMs,
  getDigestWorkerArgsEnv,
  getDigestLockUnhealthyBlockThreshold,
  getMailerTimeoutMs,
  getUnsubscribeSigningSecretOverride,
  getStoreBackendOverride,
  getStoreCanaryChatIdsEnv,
  getStoreCanaryMirrorWritesEnv,
  getStoreSqlitePathOverride,
};
