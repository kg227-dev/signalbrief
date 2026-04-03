"use strict";

const { getAnthropicProviderEnvOverrides } = require("../../runtime/config-provider");
const {
  buildDigestDataEnrichPrompt,
  buildDigestDataEnrichRepairPrompt,
} = require("./digest-data-enrich-prompt-runtime");
const {
  parseJsonArrayLenient,
  normalizeEnrichedItems,
  applyBatchWriteupValidation,
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

function buildFailedWriteupItems(items, rejectionReason = "provider_failure", attemptCount = 1) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    signal_shift: null,
    implication_type: null,
    wim_brief: null,
    wim: null,
    implications: null,
    watch_next: null,
    writeup_status: "failed_dropped",
    writeup_attempt_count: Math.max(1, Number(attemptCount || 1)),
    writeup_rejection_reasons: [String(rejectionReason || "provider_failure")],
    writeup_version: "v2",
  }));
}

function buildUsage(payload) {
  return {
    input_tokens: Number(payload?.usage?.input_tokens || 0),
    output_tokens: Number(payload?.usage?.output_tokens || 0),
  };
}

function degradedResult(items, usage, degradation) {
  const rejectionReason = degradation?.reason
    ? `provider_${String(degradation.reason).trim().toLowerCase()}`
    : "provider_failure";
  return {
    items: buildFailedWriteupItems(items, rejectionReason, 1),
    usage,
    degraded: true,
    degradation,
    writeupDiagnostics: {
      total_items: Array.isArray(items) ? items.length : 0,
      first_pass_success_count: 0,
      first_pass_failure_count: Array.isArray(items) ? items.length : 0,
      repair_attempted_count: 0,
      repair_success_count: 0,
      drop_count: Array.isArray(items) ? items.length : 0,
      underfill_due_writeup_count: 0,
      repeated_phrase_rejection_count: 0,
      model_generated_count: 0,
      model_generated_share_pct: 0,
      dropped_share_pct: 100,
    },
  };
}

function collectFailedWriteupIndexes(items = []) {
  const weak = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const reasons = Array.isArray(item?.writeup_validation_reasons)
      ? item.writeup_validation_reasons.slice()
      : Array.isArray(item?.writeup_rejection_reasons)
        ? item.writeup_rejection_reasons.slice()
        : [];
    if (String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped" || reasons.length > 0) {
      weak.push({ index, reasons });
    }
  }
  return weak;
}

function collectWriteupStats(items = [], repeatedPhraseRejectCount = 0, firstPassFailedIndexes = []) {
  const rows = Array.isArray(items) ? items : [];
  const totalItems = rows.length;
  const firstPassFailureCount = Array.isArray(firstPassFailedIndexes) ? firstPassFailedIndexes.length : 0;
  const modelGeneratedCount = rows.filter((item) => {
    const status = String(item?.writeup_status || "").trim().toLowerCase();
    return status === "model_pass" || status === "repair_pass";
  }).length;
  const repairSuccessCount = rows.filter((item) => String(item?.writeup_status || "").trim().toLowerCase() === "repair_pass").length;
  const dropCount = rows.filter((item) => String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped").length;
  return {
    total_items: totalItems,
    first_pass_success_count: Math.max(0, totalItems - firstPassFailureCount),
    first_pass_failure_count: firstPassFailureCount,
    repair_attempted_count: firstPassFailureCount,
    repair_success_count: repairSuccessCount,
    drop_count: dropCount,
    underfill_due_writeup_count: dropCount,
    repeated_phrase_rejection_count: Math.max(0, Number(repeatedPhraseRejectCount || 0)),
    model_generated_count: modelGeneratedCount,
    model_generated_share_pct: totalItems > 0 ? Number(((modelGeneratedCount / totalItems) * 100).toFixed(2)) : 0,
    dropped_share_pct: totalItems > 0 ? Number(((dropCount / totalItems) * 100).toFixed(2)) : 0,
  };
}

function normalizeWriteupPass(items, enriched, opts = {}) {
  const normalizedPass = normalizeEnrichedItems(items, enriched, opts);
  const batchChecked = applyBatchWriteupValidation(normalizedPass.items);
  return {
    items: batchChecked.items,
    diagnostics: normalizedPass.diagnostics,
    repeatedPhraseRejectCount: Number(batchChecked.repeatedPhraseRejectCount || 0),
  };
}

function collectRejectionReasons(item = {}) {
  return Array.isArray(item?.writeup_rejection_reasons)
    ? item.writeup_rejection_reasons.slice()
      : [];
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
      let normalizedPass = normalizeWriteupPass(items, enriched, {
        validateWriteups: true,
        writeupAttemptCount: 1,
        writeupStatusOnPass: "model_pass",
      });
      let normalized = normalizedPass.items;
      let repeatedPhraseRejectCount = Number(normalizedPass.repeatedPhraseRejectCount || 0);
      const weakIndexes = collectFailedWriteupIndexes(normalized);
      if (weakIndexes.length > 0) {
        log(`Claude writeup repair: retrying ${weakIndexes.length}/${items.length} weak item(s)`);
        try {
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
              messages: [{ role: "user", content: buildDigestDataEnrichRepairPrompt(repairItems) }],
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
              const repairedNormalized = normalizeWriteupPass(repairItems, repaired, {
                validateWriteups: true,
                writeupAttemptCount: 2,
                writeupStatusOnPass: "repair_pass",
              });
              repeatedPhraseRejectCount += Number(repairedNormalized.repeatedPhraseRejectCount || 0);
              normalized = mergeRepairedItems(normalized, repairedNormalized.items, weakIndexes);
              const postRepairBatch = applyBatchWriteupValidation(normalized);
              normalized = postRepairBatch.items;
              repeatedPhraseRejectCount += Number(postRepairBatch.repeatedPhraseRejectCount || 0);
              usage.input_tokens += Number(repairRes.body?.usage?.input_tokens || 0);
              usage.output_tokens += Number(repairRes.body?.usage?.output_tokens || 0);
            }
          }
        } catch (err) {
          log(`Claude writeup repair skipped: ${String(err?.message || err).slice(0, 180)}`);
        }
      }
      const firstPassFailedIndexes = weakIndexes.slice();
      normalized = normalized.map((item) => ({
        ...item,
        writeup_validation_reasons: collectRejectionReasons(item),
      }));
      return {
        items: normalized,
        usage,
        degraded: false,
        degradation: null,
        writeupDiagnostics: collectWriteupStats(normalized, repeatedPhraseRejectCount, firstPassFailedIndexes),
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
