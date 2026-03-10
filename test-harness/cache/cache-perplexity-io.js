const fs = require("fs");
const path = require("path");

const { CACHE_PERPLEXITY_DIR, sanitizeCacheKey, readJson } = require("../config");

function findLatestTopicCacheFile(topicTag) {
  const prefix = `${sanitizeCacheKey(topicTag)}_`;
  if (!fs.existsSync(CACHE_PERPLEXITY_DIR)) return null;
  const candidates = fs
    .readdirSync(CACHE_PERPLEXITY_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  if (!candidates.length) return null;
  return path.join(CACHE_PERPLEXITY_DIR, candidates[candidates.length - 1]);
}

function readPerplexityCacheFile(file, topicTag, stale = false) {
  const cached = readJson(file, {});
  return {
    items: Array.isArray(cached.parsed_items) ? cached.parsed_items : [],
    from_cache: true,
    cache_file: file,
    stale_fallback: stale,
    cost_usd: 0,
    raw_response: cached.raw_response || null,
    topic_tag: topicTag,
  };
}

function tryPerplexityCacheFallback(file, latestFallback, topicTag, stale = true) {
  if (file && fs.existsSync(file)) return readPerplexityCacheFile(file, topicTag, stale);
  if (latestFallback) return readPerplexityCacheFile(latestFallback, topicTag, true);
  return null;
}

module.exports = {
  findLatestTopicCacheFile,
  tryPerplexityCacheFallback,
};
