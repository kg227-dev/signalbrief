"use strict";

const {
  buildDigestDataExtractionPrompt,
  buildDigestDataFormattingRetryPrompt,
  buildDigestDataWimFallbackPrompt,
  buildDigestDataWimPrompt,
  buildDigestDataWimRepairPrompt,
} = require("./digest-data-enrich-prompt-runtime");
const {
  applyBatchWriteupValidation,
  deriveWimBrief,
  normalizeImplicationType,
  normalizeStringArray,
  parseJsonObjectLenient,
  validateExtractionOutput,
  validateStrategicWriteup,
} = require("./digest-data-enrich-result-runtime");
const {
  buildAttemptPolicy,
  buildFailedItem,
  buildPassedItem,
  buildProviderFailureDetail,
  defaultStageRecord,
  buildStageRawRecord,
  buildUsage,
  deriveImplicationType,
  mapRepairType,
  mapWithConcurrency,
  mergeUsage,
  resolveAnthropicResilience,
  collectWriteupStats,
} = require("./digest-data-enrich-policy-runtime");

function createDigestDataEnrichRuntime(deps) {
  const {
    CONFIG,
    log,
    httpsPostWithRetry,
  } = deps;

  const DEFAULT_TOPIC_ACTORS = Object.freeze({
    HEALTHCARE: "hospital operators and payer teams",
    "FINANCIAL SERVICES": "bank operators and lending teams",
    "PE×M&A": "deal teams and corporate operators",
    ENERGY: "utility operators and power buyers",
    CONSUMER: "retail operators and brand teams",
    "LIFE SCIENCES": "biopharma operators and commercialization teams",
    TECHNOLOGY: "enterprise operators and platform teams",
    INDUSTRIALS: "industrial operators and procurement teams",
    "REAL ESTATE": "owners, lenders, and portfolio operators",
    "PUBLIC SECTOR": "government contractors and compliance operators",
    "AI×TECH": "AI operators and infrastructure buyers",
    STRATEGY: "operators and strategy leaders",
    "POLICY×REGULATORY": "regulated operators and compliance teams",
    SUSTAINABILITY: "operators and capital planning teams",
    DIGITAL: "digital operators and CIO teams",
    "M&A ADVISORY": "advisory teams and transaction operators",
    TALENT: "operators and workforce planners",
  });

  const IMPLICATION_FALLBACKS = Object.freeze({
    cost: "pricing, margin, and budget decisions",
    competition: "competitive positioning and customer retention decisions",
    regulation: "compliance timing, enforcement exposure, and regulatory planning",
    workflow: "operational throughput, staffing, and workflow decisions",
    capital: "capex, capital allocation, and investment pacing",
    demand: "demand planning, capacity, and revenue expectations",
    structure: "market structure, channel leverage, and partnership choices",
    other: "operating priorities and strategic planning",
  });
  const ABSOLUTE_FALLBACK_WIM = "A market development is shaping near-term decisions for operators in this space.";

  function cleanSentenceFragment(value, maxLength = 180) {
    return String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.?!]+$/g, "")
      .slice(0, maxLength);
  }

  function titleCase(text) {
    const value = cleanSentenceFragment(text, 220);
    if (!value) return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function deriveFallbackExtraction(item) {
    const headline = cleanSentenceFragment(item?.headline, 180);
    const summary = cleanSentenceFragment(item?.summary, 240);
    const tag = String(item?.tag || "").trim().toUpperCase();
    return {
      what_happened: headline || summary || "A relevant market update emerged",
      mechanism: summary || "the reported move changes operating conditions for the affected market",
      who_it_impacts: DEFAULT_TOPIC_ACTORS[tag] || "operators and planning teams",
      implication: summary || "operators may need to adjust near-term plans as conditions shift",
      confidence: "low",
    };
  }

  function buildDeterministicWim(item, extractionOutput) {
    try {
      const extraction = extractionOutput || deriveFallbackExtraction(item);
      const whatHappened = titleCase(extraction?.what_happened || item?.headline || item?.summary || "A material development emerged");
      const mechanism = cleanSentenceFragment(extraction?.mechanism || item?.summary || "the reported change alters operating conditions");
      const actor = cleanSentenceFragment(extraction?.who_it_impacts || deriveFallbackExtraction(item).who_it_impacts, 120) || "operators and planning teams";
      const implicationType = deriveImplicationType(extraction, "");
      const lever = IMPLICATION_FALLBACKS[implicationType] || IMPLICATION_FALLBACKS.other;
      const firstSentence = `${whatHappened}, and ${mechanism || "the reported change alters operating conditions"}.`;
      const secondSentence = `For ${actor}, this affects ${lever}.`;
      const result = `${firstSentence} ${secondSentence}`.replace(/\s+/g, " ").trim();
      return result || ABSOLUTE_FALLBACK_WIM;
    } catch (_error) {
      return ABSOLUTE_FALLBACK_WIM;
    }
  }

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
      fallback: {
        ...defaultStageRecord("fallback"),
        attempted: false,
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
      return {
        item: buildFailedItem(
          item,
          policy,
          stages,
          stages.extraction.failure_reason || "provider_request_failed",
          [stages.extraction.failure_reason || "provider_request_failed"],
          null
        ),
        usage,
        degraded,
        degradation,
        providerFailureDetails,
      };
    }
    const extractionOutput = extractionResult.ok
      ? extractionResult.stageRecord.output
      : deriveFallbackExtraction(item);
    const generationValidation = (_item, candidate) => validateStrategicWriteup(_item, {
      ...candidate,
      mechanism: extractionOutput?.mechanism,
      what_happened: extractionOutput?.what_happened,
      who_it_impacts: extractionOutput?.who_it_impacts,
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
    let repairValidationResult = null;
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
      repairValidationResult = repairResult.validation && typeof repairResult.validation === "object"
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

    const hardInvalidWriteup = generationValidationResult?.validation_tier === "hard_fail"
      || repairValidationResult?.validation_tier === "hard_fail";
    if (hardInvalidWriteup) {
      const failureStage = stages.repair.attempted ? stages.repair : stages.generation;
      const rejectionReasons = Array.isArray(failureStage.hard_failure_reasons) && failureStage.hard_failure_reasons.length > 0
        ? failureStage.hard_failure_reasons
        : Array.isArray(failureStage.validator_reasons) && failureStage.validator_reasons.length > 0
          ? failureStage.validator_reasons
          : [failureStage.failure_reason || "validator_failure"];
      return {
        item: buildFailedItem(
          item,
          policy,
          stages,
          failureStage.failure_reason || "validator_failure",
          rejectionReasons,
          extractionOutput
        ),
        usage,
        degraded,
        degradation,
        providerFailureDetails,
      };
    }

    const fallbackReasons = Array.from(new Set([
      ...(Array.isArray(stages.generation.validator_reasons) ? stages.generation.validator_reasons : []),
      ...(Array.isArray(stages.repair.validator_reasons) ? stages.repair.validator_reasons : []),
      ...(Array.isArray(stages.repair.hard_failure_reasons) ? stages.repair.hard_failure_reasons : []),
      ...(Array.isArray(stages.repair.soft_failure_reasons) ? stages.repair.soft_failure_reasons : []),
    ]));
    stages.fallback.attempted = true;
    const fallbackResult = await executeJsonStage({
      item,
      stage: "fallback",
      promptBuilder: () => buildDigestDataWimFallbackPrompt(
        item,
        extractionOutput,
        fallbackReasons,
        stages.repair.output?.wim || stages.generation.output?.wim || ""
      ),
      validationFn: generationValidation,
      maxAttempts: 1,
      maxTokens: policy.fallbackMaxTokens,
      model: enrichModel,
      providerPolicy,
    });
    stages.fallback = {
      ...fallbackResult.stageRecord,
      attempted: true,
    };
    usage = mergeUsage(usage, fallbackResult.stageRecord.usage);
    if (fallbackResult.degradation) {
      degraded = true;
      degradation = degradation || fallbackResult.degradation;
      providerFailureDetails.push(buildProviderFailureDetail(index, item, stages.fallback));
    }
    const fallbackValidationResult = fallbackResult.validation && typeof fallbackResult.validation === "object"
      ? fallbackResult.validation
      : null;
    const fallbackSoftFail = fallbackValidationResult?.validation_tier === "soft_fail";
    const fallbackAcceptWithoutRepair = fallbackValidationResult?.minimum_viable_accept === true;
    if (fallbackResult.ok && (!fallbackSoftFail || fallbackAcceptWithoutRepair)) {
      return {
        item: buildPassedItem(
          item,
          policy,
          stages,
          extractionOutput,
          String(stages.fallback.output?.wim || "").trim(),
          "fallback_pass",
          { missingPrevented: true }
        ),
        usage,
        degraded,
        degradation,
        providerFailureDetails,
      };
    }

    const deterministicWim = buildDeterministicWim(item, extractionOutput);
    stages.fallback.status = stages.fallback.status === "not_started" ? "failed" : stages.fallback.status;
    const finalWim = deterministicWim || ABSOLUTE_FALLBACK_WIM;
    const wimUsedAbsoluteFallback = !deterministicWim;
    stages.fallback.output = stages.fallback.output || { wim: finalWim };

    // Ship through the deterministic fallback when the item still has recoverable context.
    const hasMinimalItemData = Boolean(item?.headline || item?.summary || extractionOutput?.what_happened);
    if (hasMinimalItemData) {
      if (typeof log === "function" && finalWim.split(/[.!?]/).filter(Boolean).length < 2) {
        log(`[wim_single_sentence] item ${index} shipped with 1-sentence WIM: ${String(item?.headline || "").slice(0, 60)}`);
      }
      return {
        item: buildPassedItem(
          item,
          policy,
          stages,
          extractionOutput,
          finalWim,
          "deterministic_fallback_pass",
          {
            missingPrevented: true,
            wimContractSource: wimUsedAbsoluteFallback ? "absolute_fallback" : "deterministic_fallback",
          }
        ),
        usage,
        degraded,
        degradation,
        providerFailureDetails,
      };
    }

    // True failure path: no recoverable item data survived generation, repair, or fallback.
    const failureStage = stages.fallback.attempted ? stages.fallback : (stages.repair.attempted ? stages.repair : stages.generation);
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

    const concurrency = items.length >= 12 ? 3 : 4;
    const results = await mapWithConcurrency(items, concurrency, async (item, index) => {
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
