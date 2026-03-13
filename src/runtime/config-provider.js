const fs = require("fs");
const path = require("path");
const { validateConfigSchema } = require("./config-schema-runtime");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(APP_ROOT, "config.json");
const CONFIG_EXAMPLE_PATH = path.join(APP_ROOT, "config.example.json");
const ENV_OVERRIDE_MAP = Object.freeze([
  { path: ["admin", "email"], env: ["SIGNALBRIEF_ADMIN_EMAIL", "ADMIN_EMAIL"] },
  { path: ["admin", "salt"], env: ["SIGNALBRIEF_ADMIN_SALT", "ADMIN_SALT"] },
  { path: ["admin", "passwordHash"], env: ["SIGNALBRIEF_ADMIN_PASSWORD_HASH", "ADMIN_PASSWORD_HASH"] },
  { path: ["keys", "perplexity"], env: ["SIGNALBRIEF_PERPLEXITY_API_KEY", "PERPLEXITY_API_KEY"] },
  { path: ["keys", "anthropic"], env: ["SIGNALBRIEF_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"] },
  { path: ["keys", "googleRefreshToken"], env: ["SIGNALBRIEF_GOOGLE_REFRESH_TOKEN", "GOOGLE_REFRESH_TOKEN"] },
  { path: ["keys", "googleClientId"], env: ["SIGNALBRIEF_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"] },
  { path: ["keys", "googleClientSecret"], env: ["SIGNALBRIEF_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"] },
  { path: ["keys", "telegramBotToken"], env: ["SIGNALBRIEF_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"] },
  { path: ["keys", "signalBriefBotToken"], env: ["SIGNALBRIEF_SIGNALBRIEF_BOT_TOKEN", "SIGNALBRIEF_BOT_TOKEN"] },
  { path: ["keys", "resendApiKey"], env: ["SIGNALBRIEF_RESEND_API_KEY", "RESEND_API_KEY"] },
  { path: ["keys", "fromEmail"], env: ["SIGNALBRIEF_FROM_EMAIL"] },
  { path: ["keys", "fromName"], env: ["SIGNALBRIEF_FROM_NAME"] },
]);
let cachedConfig = null;

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
  const envPath = normalizeConfigPath(process.env.SIGNALBRIEF_CONFIG_PATH || "");
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

function readEnvString(candidates) {
  for (const candidate of candidates) {
    const raw = process.env[candidate];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    return trimmed;
  }
  return "";
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

  const merged = applyEnvOverrides(parsed);
  const validation = validateConfigSchema(merged);
  if (!validation.ok) {
    throw configError("schema_failed", configPath, new Error(validation.errors.join("; ")));
  }

  cachedConfig = merged;
  return cachedConfig;
}

module.exports = {
  CONFIG_PATH,
  CONFIG_EXAMPLE_PATH,
  resolveConfigPath,
  applyEnvOverrides,
  loadConfig,
  validateConfigSchema,
};
