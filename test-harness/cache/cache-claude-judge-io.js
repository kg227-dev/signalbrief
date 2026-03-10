const fs = require("fs");
const path = require("path");

const { CACHE_CLAUDE_DIR, sanitizeCacheKey, readJson, writeJson } = require("../config");
const { stableHash } = require("./cache-common");

function buildJudgeCacheFile({ kind, payload, prompt, maxTokens, judgeModel }) {
  const keyHash = stableHash({ kind, payload, prompt, maxTokens, model: judgeModel });
  const file = path.join(CACHE_CLAUDE_DIR, `judge_${sanitizeCacheKey(kind)}_${keyHash}.json`);
  return { keyHash, file };
}

function readJudgeCache(file) {
  if (!fs.existsSync(file)) return null;
  const cached = readJson(file, {});
  return {
    result: cached.result || null,
    usage: cached.usage || { input_tokens: 0, output_tokens: 0 },
    from_cache: true,
    cache_file: file,
    cost_usd: 0,
    cache_key: path.basename(file),
  };
}

function writeJudgeCache({
  file,
  kind,
  judgeModel,
  payload,
  prompt,
  maxTokens,
  rawResponseBody,
  rawText,
  usage,
  costUsd,
  parsed,
}) {
  writeJson(file, {
    timestamp: new Date().toISOString(),
    api: "anthropic.messages",
    endpoint: "/v1/messages",
    model: judgeModel,
    kind,
    input: {
      payload,
      prompt,
      max_tokens: maxTokens,
    },
    raw_response: rawResponseBody,
    raw_text: rawText,
    usage,
    cost_usd: costUsd,
    result: parsed,
  });
}

module.exports = {
  buildJudgeCacheFile,
  readJudgeCache,
  writeJudgeCache,
};
