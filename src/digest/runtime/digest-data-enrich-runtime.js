"use strict";

const { buildDigestDataEnrichPrompt } = require("./digest-data-enrich-prompt-runtime");
const { parseJsonArrayLenient, normalizeEnrichedItems } = require("./digest-data-enrich-result-runtime");

function createDigestDataEnrichRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
  } = deps;

  async function enrichItems(items, enrichOpts = {}) {
    const enrichModel = enrichOpts.model || "claude-haiku-4-5";
    log(`Enriching with ${enrichModel}...`);

    const res = await httpsPostWithRetry(
      "api.anthropic.com",
      "/v1/messages",
      {
        "Content-Type": "application/json",
        "x-api-key": CONFIG.keys.anthropic,
        "anthropic-version": "2023-06-01",
      },
      {
        model: enrichModel,
        max_tokens: 4500,
        messages: [{ role: "user", content: buildDigestDataEnrichPrompt(items) }],
      }
    );

    const usage = {
      input_tokens: res.body?.usage?.input_tokens || 0,
      output_tokens: res.body?.usage?.output_tokens || 0,
    };

    try {
      const enriched = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
      if (!Array.isArray(enriched)) throw new Error("Claude response was not a JSON array");
      return {
        items: normalizeEnrichedItems(items, enriched),
        usage,
      };
    } catch (err) {
      log(`Claude parse error: ${err.message}`);
      return {
        items: items.map((item) => ({ ...item, wim: null, implications: null, watch_next: null })),
        usage,
      };
    }
  }

  return {
    enrichItems,
  };
}

module.exports = {
  createDigestDataEnrichRuntime,
};
