const { compositeAvg } = require("./guardrails");

function buildRunRow({
  window,
  payload,
  suitesAllPass,
  openSignature,
  stalledCount,
  hardFailCount,
  hardFailStreak,
  passTailStreak,
  certificationPathRecoverable,
}) {
  return {
    label: window.label,
    timestamp: payload?.timestamp || new Date().toISOString(),
    run_id: payload?.run_id || null,
    suites_all_pass: suitesAllPass,
    composite_avg: Number(compositeAvg(payload).toFixed(2)),
    budget_spent: Number(payload?.budget?.spent || 0),
    sample_sizes: payload?.sample_sizes || {},
    open_signature: openSignature,
    stalled_signature_windows: openSignature === "all_pass" ? 0 : stalledCount,
    hard_fail_suite_count: hardFailCount,
    hard_fail_streak_windows: hardFailStreak,
    certification_tail_streak: passTailStreak,
    certification_path_recoverable: certificationPathRecoverable,
  };
}

function assertGuardrails({
  openSignature,
  stalledCount,
  effectiveStalledThreshold,
  allowStalledRerun,
  hasSignatureAck,
  hardFailCount,
  hardFailStreak,
  effectiveHardFailThreshold,
  allowHardFailRerun,
  certificationPathRecoverable,
  passTailStreak,
  effectiveRequiredStreak,
  allowUnrecoverablePath,
  windowLabel,
  remainingWindows,
}) {
  if (
    openSignature !== "all_pass"
    && stalledCount >= effectiveStalledThreshold
    && !allowStalledRerun
    && !hasSignatureAck
  ) {
    throw new Error(
      `Matrix guardrail: fail/warn signature persisted for ${stalledCount} windows (${openSignature}). `
      + "Acknowledge an improvement plan before rerunning: "
      + `node test-harness/run-matrix.js --ack-signature=\"${openSignature}\" --ack-note=\"<what changed>\" `
      + "or override once with --allow-stalled-rerun"
    );
  }

  if (
    hardFailCount > 0
    && hardFailStreak >= effectiveHardFailThreshold
    && !allowStalledRerun
    && !allowHardFailRerun
    && !hasSignatureAck
  ) {
    throw new Error(
      `Matrix guardrail: at least one FAIL suite persisted for ${hardFailStreak} windows. `
      + `Current signature: ${openSignature}. `
      + `Acknowledge with --ack-signature=\"${openSignature}\" and a concrete fix note, `
      + "or override once with --allow-hard-fail-rerun"
    );
  }

  if (
    !certificationPathRecoverable
    && passTailStreak < effectiveRequiredStreak
    && !allowStalledRerun
    && !allowUnrecoverablePath
  ) {
    throw new Error(
      `Matrix guardrail: certification path is unrecoverable after window ${windowLabel}. `
      + `Pass-tail streak=${passTailStreak}, remaining windows=${remainingWindows}, required streak=${effectiveRequiredStreak}. `
      + "Stop and fix open issues before rerunning, or override once with --allow-unrecoverable-path"
    );
  }
}

module.exports = {
  buildRunRow,
  assertGuardrails,
};
