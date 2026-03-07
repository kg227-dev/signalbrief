const fs = require("fs");
const path = require("path");

const {
  ROOT_DIR,
  RESULTS_DIR,
  CACHE_DIR,
  CACHE_PERPLEXITY_DIR,
  CACHE_CLAUDE_DIR,
} = require("./config-constants");

function ensureHarnessPaths() {
  [RESULTS_DIR, CACHE_DIR, CACHE_PERPLEXITY_DIR, CACHE_CLAUDE_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadAppConfig() {
  const configPath = path.join(ROOT_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("config.json not found. Copy config.example.json and fill API keys first.");
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

module.exports = {
  ensureHarnessPaths,
  readJson,
  writeJson,
  loadAppConfig,
};
