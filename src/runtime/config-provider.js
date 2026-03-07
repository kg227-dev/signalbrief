const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(APP_ROOT, "config.json");
let cachedConfig = null;

function configError(stage, err) {
  const wrapped = new Error(`[config] ${stage} (${CONFIG_PATH}): ${err.message}`);
  wrapped.code = `config_${stage}`;
  wrapped.cause = err;
  return wrapped;
}

function loadConfig(opts = {}) {
  if (!opts.reload && cachedConfig) return cachedConfig;

  let raw = "";
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    throw configError("read_failed", err);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw configError("parse_failed", err);
  }

  if (!parsed || typeof parsed !== "object") {
    throw configError("invalid_shape", new Error("config root must be an object"));
  }

  cachedConfig = parsed;
  return cachedConfig;
}

module.exports = {
  CONFIG_PATH,
  loadConfig,
};
