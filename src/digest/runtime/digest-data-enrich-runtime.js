"use strict";

const { getAnthropicProviderEnvOverrides } = require("../../runtime/config-provider");
const { normalizeSourceTier } = require("../../domains/digest/candidate-quality-runtime");
const {
  buildDigestDataExtractionPrompt,
  buildDigestDataFormattingRetryPrompt,
  buildDigestDataWimPrompt,
  buildDigestDataWimRepairPrompt,
} = require("./digest-data-enrich-prompt-runtime");
const {
  applyBatchWriteupValidation,
  deriveWimBrief,
  normalizeBaseScore,
  normalizeImplicationType,
  normalizeStrategicValue,
  normalizeStringArray,
  parseJsonObjectLenient,
  validateExtractionOutput,
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

function buildUsage(payload) {
  return {
    input_tokens: Number(payload?.usage?.input_tokens || 0),
    output_tokens: Number(payload?.usage?.output_tokens || 0),
  };
}

function mergeUsage(left, right) {
  return {
    input_tokens: Number(left?.input_tokens || 0) + Number(right?.input_tokens || 0),
    output_tokens: Number(left?.output_tokens || 0) + Number(right?.output_tokens || 0),
  };
}

function resolveCandidateTier(item) {
  const tier = normalizeSourceTier(item);
  if (tier != null && tier <= 2) return "strong";
  if (tier === 3) return "standard";
  return "unknown";
}

function deriveImplicationType(extraction, wim) {
  const text = `${String(extraction?.implication || "")} ${String(wim || "")}`.toLowerCase();
  if (/\b(pricing|margin|cost|fee|fees)\b/.test(text)) return "cost";
  if (/\b(competition|competitive|share|rival|marketplace|platform)\b/.test(text)) return "competition";
  if (/\b(regulation|regulatory|rule|compliance|enforcement)\b/.test(text)) return "regulation";
  if (/\b(workflow|operations|operational|throughput|productivity)\b/.test(text)) return "workflow";
  if (/\b(capex|capital|funding|balance sheet|valuation)\b/.test(text)) return "capital";
  if (/\b(demand|traffic|volume|utilization)\b/.test(text)) return "demand";
  if (/\b(structure|consolidation|ecosystem|distribution)\b/.test(text)) return "structure";
  return "other";
}

function buildAttemptPolicy(item) {
  const candidateTier = resolveCandidateTier(item);
  if (candidateTier === "strong") {
    return {
      candidateTier,
      extractionAttempts: 2,
      generationAttempts: 2,
      allowRepair: true,
      extractionMaxTokens: 320,
      generationMaxTokens: 320,
      repairMaxTokens: 260,
    };
  }
  return {
    candidateTier,
    extractionAttempts: 1,
    generationAttempts: 1,
    allowRepair: true,
    extractionMaxTokens: 220,
    generationMaxTokens: 220,
    repairMaxTokens: 200,
  };
}

function defaultStageRecord(stage) {
  return {
    stage,
    status: "not_started",
    attempt_count: 0,
    formatting_retry_used: false,
    output: null,
    failure_reason: null,
    parse_failure_type: null,
    validator_reasons: [],
    validation_tier: null,
    minimum_viable_accept: false,
    hard_failure_reasons: [],
    soft_failure_reasons: [],
    raw_responses: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function buildStageRawRecord(rawText, extras = {}) {
  return {
    attempt: Number(extras.attempt || 1),
    retry_kind: extras.retry_kind || "primary",
    raw_preview: String(rawText || "").slice(0, 1000),
    raw_length: String(rawText || "").length,
    parse_failure_type: extras.parse_failure_type || null,
    validator_reasons: Array.isArray(extras.validator_reasons) ? extras.validator_reasons.slice() : [],
  };
}

function buildProviderFailureDetail(index, item, stageRecord, reason = null) {
  const lastRaw = stageRecord?.raw_responses?.[stageRecord.raw_responses.length - 1] || null;
  return {
    batch_index: index,
    provider: "anthropic",
    reason: reason || stageRecord?.failure_reason || null,
    stage: stageRecord?.stage || null,
    parse_failure_type: stageRecord?.parse_failure_type || null,
    raw_preview: lastRaw?.raw_preview || null,
    raw_length: lastRaw?.raw_length || null,
    url: String(item?.url || ""),
    headline: String(item?.headline || item?.title || "").slice(0, 180),
    source: String(item?.source || item?.source_domain || ""),
    source_domain: String(item?.source_domain || item?.source || ""),
    source_tier: item?.source_tier ?? null,
    source_type: String(item?.source_type || ""),
    topic: String(item?.tag || item?.topic_tag || "").trim().toUpperCase() || null,
  };
}

function mapRepairType(reasons = []) {
  const reasonSet = new Set(Array.isArray(reasons) ? reasons : []);
  if (reasonSet.has("vague_actor") || reasonSet.has("missing_operational_anchor")) return "anchor_actor_system";
  if (reasonSet.has("generic_language") || reasonSet.has("thematic_commentary")) return "sharpen_implication";
  if (reasonSet.has("sentence_clause_overload")) return "simplify_preserve_mechanism";
  if (reasonSet.has("too_long")) return "too_long";
  if (reasonSet.has("missing_mechanism")) return "missing_mechanism";
  if (
    reasonSet.has("descriptive_only")
    || reasonSet.has("thematic_commentary")
    || reasonSet.has("vague_actor")
    || reasonSet.has("missing_operational_anchor")
    || reasonSet.has("missing_lever")
  ) {
    return "not_strategic";
  }
  if (reasonSet.has("generic_language")) return "generic";
  return null;
}

function buildFailedItem(item, policy, stages, failureReason, rejectionReasons, extractionOutput = null) {
  const parseFailureType = stages.repair.parse_failure_type
    || stages.generation.parse_failure_type
    || stages.extraction.parse_failure_type
    || null;
  const validationTier = stages.repair.validation_tier
    || stages.generation.validation_tier
    || null;
  const minimumViableAccept = stages.repair.minimum_viable_accept === true
    || stages.generation.minimum_viable_accept === true;
  const hardFailureReasons = Array.isArray(stages.repair.hard_failure_reasons) && stages.repair.hard_failure_reasons.length > 0
    ? stages.repair.hard_failure_reasons.slice()
    : Array.isArray(stages.generation.hard_failure_reasons)
      ? stages.generation.hard_failure_reasons.slice()
      : [];
  const softFailureReasons = Array.isArray(stages.repair.soft_failure_reasons) && stages.repair.soft_failure_reasons.length > 0
    ? stages.repair.soft_failure_reasons.slice()
    : Array.isArray(stages.generation.soft_failure_reasons)
      ? stages.generation.soft_failure_reasons.slice()
      : [];
  return {
    ...item,
    signal_shift: extractionOutput?.what_happened || null,
    implication_type: null,
    wim_brief: null,
    wim: null,
    implications: null,
    watch_next: null,
    baseScore: normalizeBaseScore(item?.baseScore),
    strategic_value: normalizeStrategicValue(item?.strategic_value, item?.baseScore),
    content_flags: normalizeStringArray(item?.content_flags),
    storyline_hints: normalizeStringArray(item?.storyline_hints, 4),
    wim_extraction: extractionOutput,
    extraction_output: extractionOutput,
    wim_output: null,
    failure_reason: failureReason,
    repair_type: stages.repair.repair_type || null,
    parse_failure_type: parseFailureType,
    final_status: "failed_dropped",
    validation_tier: validationTier,
    minimum_viable_accept: minimumViableAccept,
    hard_failure_reasons: hardFailureReasons,
    soft_failure_reasons: softFailureReasons,
    first_pass_succeeded: false,
    writeup_status: "failed_dropped",
    writeup_attempt_count: Math.max(
      1,
      Number(stages.generation.attempt_count || 0) + (stages.repair.attempted === true ? 1 : 0)
    ),
    writeup_rejection_reasons: Array.isArray(rejectionReasons) ? rejectionReasons.slice() : [String(failureReason || "provider_failure")],
    writeup_version: "v3",
    writeup_stage_diagnostics: {
      candidate_tier: policy.candidateTier,
      extraction: stages.extraction,
      generation: stages.generation,
      repair: stages.repair,
      first_pass_succeeded: false,
    },
  };
}

function buildPassedItem(item, policy, stages, extractionOutput, wimText, status) {
  const derivedBrief = deriveWimBrief(wimText);
  return {
    ...item,
    signal_shift: extractionOutput?.what_happened || null,
    implication_type: normalizeImplicationType(deriveImplicationType(extractionOutput, wimText)),
    wim_brief: derivedBrief,
    wim: wimText,
    implications: null,
    watch_next: null,
    baseScore: normalizeBaseScore(item?.baseScore),
    strategic_value: normalizeStrategicValue(item?.strategic_value, item?.baseScore),
    content_flags: normalizeStringArray(item?.content_flags),
    storyline_hints: normalizeStringArray(item?.storyline_hints, 4),
    wim_extraction: extractionOutput,
    extraction_output: extractionOutput,
    wim_output: wimText,
    failure_reason: null,
    repair_type: stages.repair.repair_type || null,
    parse_failure_type: null,
    final_status: status,
    validation_tier: stages.repair.validation_tier || stages.generation.validation_tier || "pass",
    minimum_viable_accept: stages.repair.minimum_viable_accept === true || stages.generation.minimum_viable_accept === true,
    hard_failure_reasons: Array.isArray(stages.repair.hard_failure_reasons) && stages.repair.hard_failure_reasons.length > 0
      ? stages.repair.hard_failure_reasons.slice()
      : Array.isArray(stages.generation.hard_failure_reasons)
        ? stages.generation.hard_failure_reasons.slice()
        : [],
    soft_failure_reasons: Array.isArray(stages.repair.soft_failure_reasons) && stages.repair.soft_failure_reasons.length > 0
      ? stages.repair.soft_failure_reasons.slice()
      : Array.isArray(stages.generation.soft_failure_reasons)
        ? stages.generation.soft_failure_reasons.slice()
        : [],
    first_pass_succeeded: status === "model_pass",
    writeup_status: status,
    writeup_attempt_count: Math.max(
      1,
      Number(stages.generation.attempt_count || 0) + (stages.repair.attempted === true ? 1 : 0)
    ),
    writeup_rejection_reasons: [],
    writeup_version: "v3",
    writeup_stage_diagnostics: {
      candidate_tier: policy.candidateTier,
      extraction: stages.extraction,
      generation: stages.generation,
      repair: stages.repair,
      first_pass_succeeded: status === "model_pass",
    },
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const rows = Array.isArray(items) ? items : [];
  const out = new Array(rows.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(rows[index], index);
    }
  }
  const workers = [];
  const limit = Math.max(1, Number(concurrency || 1));
  for (let i = 0; i < Math.min(limit, rows.length); i += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return out;
}

function createDigestDataEnrichRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
  } = deps;

  async function callAnthropic(prompt, model, maxTokens, providerPolicy) {
    try {
      const res = await httpsPostWithRetry(
        "api.anthropic.com",
        "/v1/messages",
        {
          "Content-Type": "application/json",
          "x-api-key": CONFIG.keys.anthropic,
          "anthropic-version": "2023-06-01",
        },
        {
          model,
          max_tokens: Math.max(80, Number(maxTokens || 200)),
          temperature: 0.1,
          messages: [{ role: "user", content: String(prompt || "").trim() }],
        },
        {
          retries: providerPolicy.retries,
          retryDelayMs: providerPolicy.retryDelayMs,
          timeoutMs: providerPolicy.timeoutMs,
          retryStatusCodes: providerPolicy.retryStatusCodes,
        }
      );
      return {
        ok: Number(res?.status || 0) < 400,
        status: Number(res?.status || 0),
        body: res?.body || {},
        usage: buildUsage(res?.body),
        rawText: String(res?.body?.content?.[0]?.text || ""),
        message: String(res?.body?.error?.message || res?.body?.error || res?.body?.message || "").slice(0, 240) || null,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: {},
        usage: { input_tokens: 0, output_tokens: 0 },
        rawText: "",
        message: String(error?.message || error).slice(0, 240),
        requestFailed: true,
      };
    }
  }

  async function executeJsonStage(params) {
    const {
      item,
      stage,
      promptBuilder,
      validationFn,
      maxAttempts,
      maxTokens,
      model,
      providerPolicy,
    } = params;
    const stageRecord = defaultStageRecord(stage);
    for (let attempt = 1; attempt <= Math.max(1, Number(maxAttempts || 1)); attempt += 1) {
      stageRecord.attempt_count = attempt;
      const call = await callAnthropic(promptBuilder(), model, maxTokens, providerPolicy);
      stageRecord.usage = mergeUsage(stageRecord.usage, call.usage);
      if (!call.ok) {
        stageRecord.status = "failed";
        stageRecord.failure_reason = call.requestFailed === true ? "provider_request_failed" : "provider_status_failure";
        stageRecord.raw_responses.push(buildStageRawRecord(call.rawText, {
          attempt,
          parse_failure_type: null,
        }));
      return {
        ok: false,
        stageRecord,
        degradation: {
          provider: "anthropic",
          reason: call.requestFailed === true ? "request_failed" : "status_failure",
          message: call.message,
          status_code: call.status || null,
          raw_preview: stageRecord.raw_responses[stageRecord.raw_responses.length - 1]?.raw_preview || null,
          raw_length: stageRecord.raw_responses[stageRecord.raw_responses.length - 1]?.raw_length || null,
        },
      };
      }

      let parsed = parseJsonObjectLenient(call.rawText);
      stageRecord.raw_responses.push(buildStageRawRecord(call.rawText, {
        attempt,
        parse_failure_type: parsed.parseFailureType,
      }));

      if (!parsed.ok && (parsed.parseFailureType === "malformed_json" || parsed.parseFailureType === "truncation")) {
        stageRecord.formatting_retry_used = true;
        const repairCall = await callAnthropic(
          buildDigestDataFormattingRetryPrompt(call.rawText),
          model,
          maxTokens,
          providerPolicy
        );
        stageRecord.usage = mergeUsage(stageRecord.usage, repairCall.usage);
        if (!repairCall.ok) {
          stageRecord.status = "failed";
          stageRecord.failure_reason = repairCall.requestFailed === true ? "provider_request_failed" : "provider_status_failure";
          stageRecord.raw_responses.push(buildStageRawRecord(repairCall.rawText, {
            attempt,
            retry_kind: "formatting_retry",
          }));
          return {
            ok: false,
            stageRecord,
            degradation: {
              provider: "anthropic",
              reason: repairCall.requestFailed === true ? "request_failed" : "status_failure",
              message: repairCall.message,
              status_code: repairCall.status || null,
              raw_preview: stageRecord.raw_responses[stageRecord.raw_responses.length - 1]?.raw_preview || null,
              raw_length: stageRecord.raw_responses[stageRecord.raw_responses.length - 1]?.raw_length || null,
            },
          };
        }
        parsed = parseJsonObjectLenient(repairCall.rawText);
        stageRecord.raw_responses.push(buildStageRawRecord(repairCall.rawText, {
          attempt,
          retry_kind: "formatting_retry",
          parse_failure_type: parsed.parseFailureType,
        }));
      }

      if (!parsed.ok) {
        stageRecord.failure_reason = "provider_parse_failure";
        stageRecord.parse_failure_type = parsed.parseFailureType;
        continue;
      }

      const validation = validationFn(item, parsed.value);
      if (Object.prototype.hasOwnProperty.call(validation || {}, "validation_tier")) {
        stageRecord.validation_tier = validation.validation_tier || null;
        stageRecord.minimum_viable_accept = validation.minimum_viable_accept === true;
        stageRecord.hard_failure_reasons = Array.isArray(validation.hard_failure_reasons) ? validation.hard_failure_reasons.slice() : [];
        stageRecord.soft_failure_reasons = Array.isArray(validation.soft_failure_reasons) ? validation.soft_failure_reasons.slice() : [];
      }
      if (!validation.ok && validation.validation_tier !== "soft_fail") {
        stageRecord.failure_reason = "validator_failure";
        stageRecord.parse_failure_type = "validator_mismatch";
        stageRecord.validator_reasons = validation.reasons.slice();
        stageRecord.raw_responses[stageRecord.raw_responses.length - 1].validator_reasons = validation.reasons.slice();
        return {
          ok: false,
          stageRecord,
          degradation: null,
          validation,
        };
      }
      if (validation.validation_tier === "soft_fail") {
        stageRecord.status = "soft_fail";
        stageRecord.failure_reason = "validator_soft_failure";
        stageRecord.parse_failure_type = null;
        stageRecord.validator_reasons = validation.reasons.slice();
        stageRecord.raw_responses[stageRecord.raw_responses.length - 1].validator_reasons = validation.reasons.slice();
        stageRecord.output = validation.output || parsed.value;
        return {
          ok: true,
          stageRecord,
          degradation: null,
          validation,
        };
      }

      stageRecord.status = attempt === 1 && stageRecord.formatting_retry_used !== true ? "model_pass" : "retry_pass";
      stageRecord.failure_reason = null;
      stageRecord.parse_failure_type = null;
      stageRecord.validator_reasons = [];
      stageRecord.output = validation.output || parsed.value;
      return {
        ok: true,
        stageRecord,
        degradation: null,
        validation,
      };
    }

    stageRecord.status = "failed";
    if (!stageRecord.failure_reason) stageRecord.failure_reason = "validator_failure";
    return {
      ok: false,
      stageRecord,
      degradation: stageRecord.failure_reason === "provider_parse_failure"
      ? {
            provider: "anthropic",
            reason: "parse_failure",
            message: stageRecord.parse_failure_type,
            raw_preview: stageRecord.raw_responses[stageRecord.raw_responses.length - 1]?.raw_preview || null,
            raw_length: stageRecord.raw_responses[stageRecord.raw_responses.length - 1]?.raw_length || null,
          }
        : null,
      validation: null,
    };
  }

  async function processCandidate(item, index, enrichModel, providerPolicy) {
    const policy = buildAttemptPolicy(item);
    const stages = {
      extraction: defaultStageRecord("extraction"),
      generation: defaultStageRecord("generation"),
      repair: {
        ...defaultStageRecord("repair"),
        attempted: false,
        repair_type: null,
      },
    };
    let usage = { input_tokens: 0, output_tokens: 0 };
    const providerFailureDetails = [];
    let degraded = false;
    let degradation = null;

    const extractionResult = await executeJsonStage({
      item,
      stage: "extraction",
      promptBuilder: () => buildDigestDataExtractionPrompt(item),
      validationFn: validateExtractionOutput,
      maxAttempts: policy.extractionAttempts,
      maxTokens: policy.extractionMaxTokens,
      model: enrichModel,
      providerPolicy,
    });
    stages.extraction = extractionResult.stageRecord;
    usage = mergeUsage(usage, extractionResult.stageRecord.usage);
    if (extractionResult.degradation) {
      degraded = true;
      degradation = extractionResult.degradation;
      providerFailureDetails.push(buildProviderFailureDetail(index, item, stages.extraction));
    }
    if (!extractionResult.ok) {
      const reasons = stages.extraction.failure_reason === "provider_parse_failure"
        ? ["provider_parse_failure"]
        : Array.isArray(stages.extraction.validator_reasons) && stages.extraction.validator_reasons.length > 0
          ? stages.extraction.validator_reasons
          : [stages.extraction.failure_reason];
      return {
        item: buildFailedItem(item, policy, stages, stages.extraction.failure_reason, reasons, null),
        usage,
        degraded,
        degradation,
        providerFailureDetails,
      };
    }

    const extractionOutput = extractionResult.stageRecord.output;
    const generationValidation = (_item, candidate) => validateStrategicWriteup(_item, {
      ...candidate,
      mechanism: extractionOutput?.mechanism,
      what_happened: extractionOutput?.what_happened,
      implication_type: deriveImplicationType(extractionOutput, candidate?.wim),
      candidate_tier: policy.candidateTier,
    });
    const generationResult = await executeJsonStage({
      item,
      stage: "generation",
      promptBuilder: () => buildDigestDataWimPrompt(item, extractionOutput),
      validationFn: generationValidation,
      maxAttempts: policy.generationAttempts,
      maxTokens: policy.generationMaxTokens,
      model: enrichModel,
      providerPolicy,
    });
    stages.generation = generationResult.stageRecord;
    usage = mergeUsage(usage, generationResult.stageRecord.usage);
    if (generationResult.degradation) {
      degraded = true;
      degradation = degradation || generationResult.degradation;
      providerFailureDetails.push(buildProviderFailureDetail(index, item, stages.generation));
    }

    const generationValidationResult = generationResult.validation && typeof generationResult.validation === "object"
      ? generationResult.validation
      : null;
    const generationSoftFail = generationValidationResult?.validation_tier === "soft_fail";
    const generationAcceptWithoutRepair = generationValidationResult?.minimum_viable_accept === true;
    if (generationResult.ok && (!generationSoftFail || generationAcceptWithoutRepair)) {
      const initialPass = stages.extraction.attempt_count === 1
        && stages.extraction.formatting_retry_used !== true
        && stages.generation.attempt_count === 1
        && stages.generation.formatting_retry_used !== true;
      return {
        item: buildPassedItem(
          item,
          policy,
          stages,
          extractionOutput,
          String(stages.generation.output?.wim || "").trim(),
            initialPass ? "model_pass" : "retry_pass"
          ),
          usage,
          degraded,
          degradation,
          providerFailureDetails,
      };
    }

    const repairType = mapRepairType(
      generationValidationResult?.soft_failure_reasons?.length
        ? generationValidationResult.soft_failure_reasons
        : stages.generation.validator_reasons
    );
    stages.repair.attempted = repairType != null && policy.allowRepair === true;
    stages.repair.repair_type = repairType;
    if (stages.repair.attempted) {
      const repairResult = await executeJsonStage({
        item,
        stage: "repair",
        promptBuilder: () => buildDigestDataWimRepairPrompt(
          item,
          extractionOutput,
          stages.generation.validator_reasons,
          stages.generation.output?.wim || ""
        ),
        validationFn: generationValidation,
        maxAttempts: 1,
        maxTokens: policy.repairMaxTokens,
        model: enrichModel,
        providerPolicy,
      });
      stages.repair = {
        ...repairResult.stageRecord,
        attempted: true,
        repair_type: repairType,
      };
      usage = mergeUsage(usage, repairResult.stageRecord.usage);
      if (repairResult.degradation) {
        degraded = true;
        degradation = degradation || repairResult.degradation;
        providerFailureDetails.push(buildProviderFailureDetail(index, item, stages.repair));
      }
      const repairValidationResult = repairResult.validation && typeof repairResult.validation === "object"
        ? repairResult.validation
        : null;
      const repairHardFail = repairValidationResult?.validation_tier === "hard_fail";
      if (repairResult.ok && repairHardFail !== true) {
        return {
          item: buildPassedItem(
            item,
            policy,
            stages,
            extractionOutput,
            String(stages.repair.output?.wim || "").trim(),
            "repair_pass"
          ),
          usage,
          degraded,
          degradation,
          providerFailureDetails,
        };
      }
    }

    const failureStage = stages.repair.attempted ? stages.repair : stages.generation;
    const rejectionReasons = failureStage.failure_reason === "provider_parse_failure"
      ? ["provider_parse_failure"]
      : Array.isArray(failureStage.hard_failure_reasons) && failureStage.hard_failure_reasons.length > 0
        ? failureStage.hard_failure_reasons
        : Array.isArray(failureStage.validator_reasons) && failureStage.validator_reasons.length > 0
          ? failureStage.validator_reasons
          : [failureStage.failure_reason];
    const failureReason = failureStage.failure_reason === "validator_failure"
      && Array.isArray(failureStage.hard_failure_reasons)
      && failureStage.hard_failure_reasons.length > 0
      ? failureStage.hard_failure_reasons[0]
      : failureStage.failure_reason;
    return {
      item: buildFailedItem(item, policy, stages, Array.isArray(failureReason) ? failureReason[0] : failureReason, rejectionReasons, extractionOutput),
      usage,
      degraded,
      degradation,
      providerFailureDetails,
    };
  }

  function collectWriteupStats(items = [], repeatedPhraseRejectCount = 0, providerFailureDetails = []) {
    const rows = Array.isArray(items) ? items : [];
    const totalItems = rows.length;
    const firstPassSuccessCount = rows.filter((item) => item?.first_pass_succeeded === true).length;
    const repairAttemptedCount = rows.filter((item) => item?.writeup_stage_diagnostics?.repair?.attempted === true).length;
    const repairSuccessCount = rows.filter((item) => String(item?.writeup_status || "").trim().toLowerCase() === "repair_pass").length;
    const dropCount = rows.filter((item) => String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped").length;
    const modelGeneratedCount = rows.filter((item) => String(item?.writeup_status || "").trim().toLowerCase() !== "failed_dropped").length;
    const extractionSuccessCount = rows.filter((item) => item?.writeup_stage_diagnostics?.extraction?.status !== "failed").length;
    const generationAttemptedCount = rows.filter((item) => Number(item?.writeup_stage_diagnostics?.generation?.attempt_count || 0) > 0).length;
    const generationSuccessCount = rows.filter((item) => {
      const status = String(item?.writeup_stage_diagnostics?.generation?.status || "").trim().toLowerCase();
      return status === "model_pass"
        || status === "retry_pass"
        || (status === "soft_fail" && String(item?.writeup_status || "").trim().toLowerCase() !== "failed_dropped");
    }).length;
    const strongTierAttemptedCount = rows.filter((item) => item?.writeup_stage_diagnostics?.candidate_tier === "strong").length;
    const strongTierDropCount = rows.filter((item) =>
      item?.writeup_stage_diagnostics?.candidate_tier === "strong"
      && String(item?.writeup_status || "").trim().toLowerCase() === "failed_dropped"
    ).length;
    const hardFailCount = rows.filter((item) => String(item?.validation_tier || "").trim().toLowerCase() === "hard_fail").length;
    const softFailCount = rows.filter((item) => String(item?.validation_tier || "").trim().toLowerCase() === "soft_fail").length;
    const minimumViableAcceptCount = rows.filter((item) => item?.minimum_viable_accept === true).length;
    const softFailRecoveryCount = rows.filter((item) =>
      String(item?.validation_tier || "").trim().toLowerCase() === "soft_fail"
      && String(item?.writeup_status || "").trim().toLowerCase() !== "failed_dropped"
    ).length;
    const strongTierHardFailCount = rows.filter((item) =>
      item?.writeup_stage_diagnostics?.candidate_tier === "strong"
      && String(item?.validation_tier || "").trim().toLowerCase() === "hard_fail"
    ).length;
    const parseFailureCounts = Object.create(null);
    for (const item of rows) {
      const parseFailureType = String(item?.parse_failure_type || "").trim();
      if (!parseFailureType) continue;
      parseFailureCounts[parseFailureType] = (parseFailureCounts[parseFailureType] || 0) + 1;
    }
    return {
      total_items: totalItems,
      attempted_count: totalItems,
      extraction_attempted_count: totalItems,
      extraction_success_count: extractionSuccessCount,
      extraction_failure_count: Math.max(0, totalItems - extractionSuccessCount),
      generation_attempted_count: generationAttemptedCount,
      generation_success_count: generationSuccessCount,
      generation_failure_count: Math.max(0, generationAttemptedCount - generationSuccessCount),
      first_pass_success_count: firstPassSuccessCount,
      first_pass_failure_count: Math.max(0, totalItems - firstPassSuccessCount),
      first_pass_success_rate_pct: totalItems > 0 ? Number(((firstPassSuccessCount / totalItems) * 100).toFixed(2)) : 0,
      repair_attempted_count: repairAttemptedCount,
      repair_success_count: repairSuccessCount,
      repair_pass_success_rate_pct: repairAttemptedCount > 0 ? Number(((repairSuccessCount / repairAttemptedCount) * 100).toFixed(2)) : 0,
      drop_count: dropCount,
      hard_fail_count: hardFailCount,
      soft_fail_count: softFailCount,
      soft_fail_recovery_count: softFailRecoveryCount,
      soft_fail_recovery_rate_pct: softFailCount > 0 ? Number(((softFailRecoveryCount / softFailCount) * 100).toFixed(2)) : 0,
      minimum_viable_accept_count: minimumViableAcceptCount,
      underfill_due_writeup_count: dropCount,
      repeated_phrase_rejection_count: Math.max(0, Number(repeatedPhraseRejectCount || 0)),
      model_generated_count: modelGeneratedCount,
      model_generated_share_pct: totalItems > 0 ? Number(((modelGeneratedCount / totalItems) * 100).toFixed(2)) : 0,
      dropped_share_pct: totalItems > 0 ? Number(((dropCount / totalItems) * 100).toFixed(2)) : 0,
      strong_tier_attempted_count: strongTierAttemptedCount,
      strong_tier_drop_count: strongTierDropCount,
      strong_tier_drop_rate_pct: strongTierAttemptedCount > 0 ? Number(((strongTierDropCount / strongTierAttemptedCount) * 100).toFixed(2)) : 0,
      strong_tier_hard_fail_count: strongTierHardFailCount,
      strong_tier_hard_fail_rate_pct: strongTierAttemptedCount > 0 ? Number(((strongTierHardFailCount / strongTierAttemptedCount) * 100).toFixed(2)) : 0,
      parse_failure_counts: parseFailureCounts,
      provider_failure_details: Array.isArray(providerFailureDetails) ? providerFailureDetails : [],
    };
  }

  async function enrichItems(items, enrichOpts = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        items: [],
        usage: { input_tokens: 0, output_tokens: 0 },
        degraded: false,
        degradation: null,
        writeupDiagnostics: collectWriteupStats([], 0, []),
      };
    }

    const enrichModel = enrichOpts.model || "claude-haiku-4-5";
    const providerPolicy = resolveAnthropicResilience(CONFIG?.digest);
    log(`Enriching with ${enrichModel}...`);

    const results = await mapWithConcurrency(items, 4, async (item, index) => {
      const result = await processCandidate(item, index, enrichModel, providerPolicy);
      if (result.degraded && result.degradation) {
        log(`writeup stage degraded (${result.degradation.reason}) for ${String(item?.url || item?.headline || index).slice(0, 160)}`);
      }
      return result;
    });

    let usage = { input_tokens: 0, output_tokens: 0 };
    let degraded = false;
    let degradation = null;
    const providerFailureDetails = [];
    const normalized = [];
    for (const result of results) {
      usage = mergeUsage(usage, result.usage);
      degraded = degraded || result.degraded === true;
      degradation = degradation || result.degradation || null;
      providerFailureDetails.push(...(Array.isArray(result.providerFailureDetails) ? result.providerFailureDetails : []));
      normalized.push(result.item);
    }

    const batchChecked = applyBatchWriteupValidation(normalized);
    const finalItems = batchChecked.items.map((item) => {
      if (!Array.isArray(item?.writeup_rejection_reasons) || !item.writeup_rejection_reasons.includes("repeated_lead_phrase")) {
        return item;
      }
      return {
        ...item,
        failure_reason: item?.failure_reason || "repeated_lead_phrase",
        final_status: "failed_dropped",
      };
    });

    return {
      items: finalItems,
      usage,
      degraded,
      degradation,
      writeupDiagnostics: collectWriteupStats(finalItems, batchChecked.repeatedPhraseRejectCount, providerFailureDetails),
    };
  }

  return {
    enrichItems,
  };
}

module.exports = {
  createDigestDataEnrichRuntime,
};
