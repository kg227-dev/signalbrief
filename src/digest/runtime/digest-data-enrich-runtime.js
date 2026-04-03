"use strict";

const { getAnthropicProviderEnvOverrides } = require("../../runtime/config-provider");
const { buildDigestDataEnrichPrompt } = require("./digest-data-enrich-prompt-runtime");
const {
  buildDigestDataEnrichRepairPrompt,
} = require("./digest-data-enrich-prompt-runtime");
const {
  parseJsonArrayLenient,
  normalizeEnrichedItems,
  validateStrategicWriteup,
} = require("./digest-data-enrich-result-runtime");
const { ANTHROPIC_PROVIDER_DEFAULTS } = require("../../platform/config/provider-defaults");

function toBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function normalizeStatusCodes(rawValue, fallback) {
  const source = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "").split(",");
  const out = [];
  for (const entry of source) {
    const code = Number(String(entry || "").trim());
    if (!Number.isInteger(code) || code < 100 || code > 599) continue;
    if (out.includes(code)) continue;
    out.push(code);
  }
  return out.length > 0 ? out : fallback.slice();
}

function resolveAnthropicResilience(configDigest) {
  const configured = configDigest?.providerResilience?.anthropic || {};
  const env = getAnthropicProviderEnvOverrides();
  return {
    timeoutMs: toBoundedInt(
      env.timeoutMs || configured.timeoutMs,
      ANTHROPIC_PROVIDER_DEFAULTS.timeoutMs,
      { min: 1_000, max: 180_000 }
    ),
    retries: toBoundedInt(
      env.retries || configured.retries,
      ANTHROPIC_PROVIDER_DEFAULTS.retries,
      { min: 0, max: 8 }
    ),
    retryDelayMs: toBoundedInt(
      env.retryDelayMs || configured.retryDelayMs,
      ANTHROPIC_PROVIDER_DEFAULTS.retryDelayMs,
      { min: 100, max: 60_000 }
    ),
    retryStatusCodes: normalizeStatusCodes(
      env.retryStatusCodes || configured.retryStatusCodes,
      ANTHROPIC_PROVIDER_DEFAULTS.retryStatusCodes
    ),
  };
}

function buildFallbackItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    wim: null,
    implications: null,
    watch_next: null,
  }));
}

function buildUsage(payload) {
  return {
    input_tokens: Number(payload?.usage?.input_tokens || 0),
    output_tokens: Number(payload?.usage?.output_tokens || 0),
  };
}

function degradedResult(items, usage, degradation) {
  return {
    items: buildFallbackItems(items),
    usage,
    degraded: true,
    degradation,
  };
}

function collectWeakWriteupIndexes(items = []) {
  const weak = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const reasons = Array.isArray(item?.writeup_validation_reasons)
      ? item.writeup_validation_reasons.slice()
      : [];
    if (String(item?.writeup_origin || "").trim().toLowerCase() === "fallback" || reasons.length > 0) {
      weak.push({ index, reasons });
    }
  }
  return weak;
}

function mergeRepairedItems(baseItems = [], repairedItems = [], weakIndexes = []) {
  const out = Array.isArray(baseItems) ? baseItems.map((item) => ({ ...item })) : [];
  for (let i = 0; i < weakIndexes.length; i += 1) {
    const targetIndex = Number(weakIndexes[i]?.index);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= out.length) continue;
    if (!repairedItems[i]) continue;
    out[targetIndex] = {
      ...out[targetIndex],
      ...repairedItems[i],
    };
  }
  return out;
}

function createDigestDataEnrichRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
  } = deps;

  async function enrichItems(items, enrichOpts = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return { items: [], usage: { input_tokens: 0, output_tokens: 0 }, degraded: false, degradation: null };
    }

    const enrichModel = enrichOpts.model || "claude-haiku-4-5";
    const providerPolicy = resolveAnthropicResilience(CONFIG?.digest);
    log(`Enriching with ${enrichModel}...`);

    let res;
    try {
      res = await httpsPostWithRetry(
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
        },
        {
          retries: providerPolicy.retries,
          retryDelayMs: providerPolicy.retryDelayMs,
          timeoutMs: providerPolicy.timeoutMs,
          retryStatusCodes: providerPolicy.retryStatusCodes,
        }
      );
    } catch (err) {
      const message = String(err?.message || err).slice(0, 180);
      log(`⚠️ Claude request failed: ${message}`);
      return degradedResult(items, { input_tokens: 0, output_tokens: 0 }, {
        provider: "anthropic",
        reason: "request_failed",
        message,
        timeout_ms: providerPolicy.timeoutMs,
        retries: providerPolicy.retries,
      });
    }

    const usage = buildUsage(res.body);
    if (Number(res.status || 0) >= 400) {
      const detail = res.body?.error?.message || res.body?.error || res.body?.message || `status ${res.status}`;
      const message = String(detail).slice(0, 180);
      log(`⚠️ Claude request returned ${res.status}: ${message}`);
      return degradedResult(items, usage, {
        provider: "anthropic",
        reason: "status_failure",
        status_code: Number(res.status || 0) || null,
        message,
        retries: providerPolicy.retries,
      });
    }

    try {
      const enriched = parseJsonArrayLenient(res.body?.content?.[0]?.text || "[]");
      if (!Array.isArray(enriched)) throw new Error("Claude response was not a JSON array");
      let normalized = normalizeEnrichedItems(items, enriched, { validateWriteups: true });
      const weakIndexes = collectWeakWriteupIndexes(normalized);
      if (weakIndexes.length > 0) {
        log(`Claude writeup repair: retrying ${weakIndexes.length}/${items.length} weak item(s)`);
        try {
          const { buildDigestDataEnrichRepairPrompt: buildRepairPrompt } = require("./digest-data-enrich-prompt-runtime");
          const repairItems = weakIndexes.map(({ index, reasons }) => ({
            ...items[index],
            failed_writeup_reasons: reasons,
            prior_wim: normalized[index]?.wim || null,
            prior_wim_brief: normalized[index]?.wim_brief || null,
          }));
          const repairRes = await httpsPostWithRetry(
            "api.anthropic.com",
            "/v1/messages",
            {
              "Content-Type": "application/json",
              "x-api-key": CONFIG.keys.anthropic,
              "anthropic-version": "2023-06-01",
            },
            {
              model: enrichModel,
              max_tokens: 2200,
              messages: [{ role: "user", content: buildRepairPrompt(repairItems) }],
            },
            {
              retries: providerPolicy.retries,
              retryDelayMs: providerPolicy.retryDelayMs,
              timeoutMs: providerPolicy.timeoutMs,
              retryStatusCodes: providerPolicy.retryStatusCodes,
            }
          );
          if (Number(repairRes?.status || 0) < 400) {
            const repaired = parseJsonArrayLenient(repairRes.body?.content?.[0]?.text || "[]");
            if (Array.isArray(repaired)) {
              const repairedNormalized = normalizeEnrichedItems(repairItems, repaired, { validateWriteups: true });
              normalized = mergeRepairedItems(normalized, repairedNormalized, weakIndexes);
              usage.input_tokens += Number(repairRes.body?.usage?.input_tokens || 0);
              usage.output_tokens += Number(repairRes.body?.usage?.output_tokens || 0);
            }
          }
        } catch (err) {
          log(`Claude writeup repair skipped: ${String(err?.message || err).slice(0, 180)}`);
        }
      }
      return {
        items: normalized,
        usage,
        degraded: false,
        degradation: null,
      };
    } catch (err) {
      log(`Claude parse error: ${err.message}`);
      return degradedResult(items, usage, {
        provider: "anthropic",
        reason: "parse_failure",
        message: String(err.message || err).slice(0, 180),
      });
    }
  }

  return {
    enrichItems,
  };
}

module.exports = {
  createDigestDataEnrichRuntime,
};
