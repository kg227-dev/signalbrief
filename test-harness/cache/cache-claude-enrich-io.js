const fs = require("fs");
const path = require("path");

const { CACHE_CLAUDE_DIR, readJson, writeJson } = require("../config");
const { stableHash } = require("./cache-common");
const { ENRICH_PROMPT_VERSION } = require("./cache-claude-enrichment");

function buildEnrichmentCacheFile({ items, enrichModel, prompt }) {
  const normalizedItems = (items || []).map((item) => ({
    headline: item.headline,
    summary: item.summary,
    tag: item.tag,
  }));
  const hash = stableHash({
    type: "enrichment",
    model: enrichModel,
    prompt_version: ENRICH_PROMPT_VERSION,
    prompt,
    items: normalizedItems,
  });
  const file = path.join(CACHE_CLAUDE_DIR, `enrichment_${hash}.json`);
  return { hash, file };
}

function readEnrichmentCache(file) {
  if (!fs.existsSync(file)) return null;
  const cached = readJson(file, {});
  return {
    items: Array.isArray(cached.enriched_items) ? cached.enriched_items : [],
    usage: cached.usage || { input_tokens: 0, output_tokens: 0 },
    from_cache: true,
    cache_file: file,
    cost_usd: 0,
    cache_key: path.basename(file),
  };
}

function writeEnrichmentCache({
  file,
  hash,
  prompt,
  enrichModel,
  items,
  responseBody,
  usage,
  costUsd,
  enrichedItems,
}) {
  writeJson(file, {
    timestamp: new Date().toISOString(),
    api: "anthropic.messages",
    endpoint: "/v1/messages",
    model: enrichModel,
    input: {
      item_count: (items || []).length,
      hash,
      prompt,
    },
    raw_response: responseBody,
    usage,
    cost_usd: costUsd,
    enriched_items: enrichedItems,
  });
}

module.exports = {
  buildEnrichmentCacheFile,
  readEnrichmentCache,
  writeEnrichmentCache,
};
