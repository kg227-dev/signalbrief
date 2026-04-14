"use strict";

const SPECIFICITY_GENERIC_PATTERN = /\ba development\b|emerged|occurred|\ba relevant\b|material development/i;
const SPECIFICITY_ENTITY_PATTERN = /\d+%?|\b[A-Z][a-z]+\s+[A-Z][a-z]+|\$[\d.]+[BMK]?/;
const CAUSAL_CONNECTORS = /\b(by|through|forcing|enabling|preventing|requiring|because|causing|allowing|driving)\b/i;
const DECISION_PRESSURE = /\b(must|face|risk|forces|pressure|margin|budget|exposure|penalty|compete)\b/i;
const WIM_ERROR_PATTERN = /unable to generate|content required/i;

function checkHardReject(item) {
  const wim = String(item?.wim || "");
  if (!wim || wim.length < 20) return "wim_too_short";
  if (WIM_ERROR_PATTERN.test(wim)) return "wim_error_text";
  if (
    String(item?.source_domain || "").includes("federalregister.gov") &&
    !item?.wim_extraction?.implication
  ) return "procedural_no_implication";
  return null;
}

function scoreSpecificity(item) {
  const text = String(item?.wim_extraction?.what_happened || "");
  if (SPECIFICITY_GENERIC_PATTERN.test(text) || text.length <= 20) return 0;
  if (SPECIFICITY_ENTITY_PATTERN.test(text) && text.length > 60) return 2;
  if (text.length > 40 || /\b[A-Z][a-z]+\b/.test(text)) return 1;
  return 0;
}

function scoreMechanism(item) {
  const mechanism = String(item?.wim_extraction?.mechanism || "");
  const wim = String(item?.wim || "");
  const hasCausal = CAUSAL_CONNECTORS.test(wim);
  if (mechanism.length > 40 && hasCausal) return 2;
  if (mechanism.length > 20 || hasCausal) return 1;
  return 0;
}

function scoreStrategicImplication(item) {
  const implication = String(item?.wim_extraction?.implication || "");
  const implType = String(item?.implication_type || "");
  const wim = String(item?.wim || "");
  const typeClassified = implType !== "" && implType !== "null" && implType !== "other";
  const hasDecisionPressure = DECISION_PRESSURE.test(wim);
  if (implication.length > 50 && typeClassified && hasDecisionPressure) return 2;
  if (implication.length > 20 || typeClassified) return 1;
  return 0;
}

function scoreNonObviousness(item) {
  const softFailures = Array.isArray(item?.soft_failure_reasons) ? item.soft_failure_reasons : [];
  const wim = String(item?.wim || "");

  if (softFailures.includes("descriptive_only")) return 0;
  if (wim.length < 40) return 0;

  const headline = String(item?.headline || "").toLowerCase();
  const wimWords = wim.split(/\W+/).filter((word) => word.length > 4 && /^[A-Z]/.test(word));
  const hasNewEntities = wimWords.some((word) => !headline.includes(word.toLowerCase()));

  return hasNewEntities ? 2 : 1;
}

function scoreSignalQuality(item) {
  const hardRejectReason = checkHardReject(item);
  if (hardRejectReason) {
    return {
      total: 0,
      specificity: 0,
      mechanism: 0,
      strategic_implication: 0,
      non_obviousness: 0,
      hard_rejected: true,
      hard_reject_reason: hardRejectReason,
    };
  }

  const specificity = scoreSpecificity(item);
  const mechanism = scoreMechanism(item);
  const strategicImplication = scoreStrategicImplication(item);
  const nonObviousness = scoreNonObviousness(item);

  return {
    total: specificity + mechanism + strategicImplication + nonObviousness,
    specificity,
    mechanism,
    strategic_implication: strategicImplication,
    non_obviousness: nonObviousness,
    hard_rejected: false,
    hard_reject_reason: null,
  };
}

module.exports = { scoreSignalQuality };
