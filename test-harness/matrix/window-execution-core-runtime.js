const { runHarness } = require("../run-tests");
const { buildWindowArgs } = require("./config");
const {
  allSuitesPass,
  hardFailSuiteCount,
  buildOpenSignature,
  hasAcknowledgedSignature,
  isCertificationPathRecoverable,
} = require("./guardrails");
const {
  buildRunRow,
  assertGuardrails,
} = require("./window-execution-steps-runtime");

async function executeMatrixWindows({
  plan,
  matrixConfig,
  passthrough,
  guardrails,
  allowStalledRerun,
  allowHardFailRerun,
  allowUnrecoverablePath,
  improvementLog,
}) {
  const runRows = [];
  let priorSignature = null;
  let stalledCount = 0;
  let hardFailStreak = 0;
  let passTailStreak = 0;

  for (let i = 0; i < plan.length; i++) {
    const window = plan[i];
    const refreshNow = matrixConfig.refresh_every > 0 && i > 0 && i % matrixConfig.refresh_every === 0;
    const runArgs = buildWindowArgs({
      window,
      matrixConfig,
      passthrough,
      refreshNow,
    });
    const result = await runHarness(runArgs);
    const payload = result?.report?.payload || null;
    const suitesAllPass = allSuitesPass(payload);
    const openSignature = buildOpenSignature(payload);
    const hardFailCount = hardFailSuiteCount(payload);

    if (openSignature === "all_pass") {
      priorSignature = null;
      stalledCount = 0;
    } else if (openSignature === priorSignature) {
      stalledCount += 1;
    } else {
      priorSignature = openSignature;
      stalledCount = 1;
    }

    if (hardFailCount > 0) {
      hardFailStreak += 1;
    } else {
      hardFailStreak = 0;
    }

    passTailStreak = suitesAllPass ? passTailStreak + 1 : 0;
    const remainingWindows = plan.length - (i + 1);
    const certificationPathRecoverable = isCertificationPathRecoverable({
      currentPassTailStreak: passTailStreak,
      remainingWindows,
      requiredStreak: guardrails.required,
    });
    const hasSignatureAck = hasAcknowledgedSignature(improvementLog, openSignature);

    runRows.push(buildRunRow({
      window,
      payload,
      suitesAllPass,
      openSignature,
      stalledCount,
      hardFailCount,
      hardFailStreak,
      passTailStreak,
      certificationPathRecoverable,
    }));

    assertGuardrails({
      openSignature,
      stalledCount,
      effectiveStalledThreshold: guardrails.stalled,
      allowStalledRerun,
      hasSignatureAck,
      hardFailCount,
      hardFailStreak,
      effectiveHardFailThreshold: guardrails.hardFail,
      allowHardFailRerun,
      certificationPathRecoverable,
      passTailStreak,
      effectiveRequiredStreak: guardrails.required,
      allowUnrecoverablePath,
      windowLabel: window.label,
      remainingWindows,
    });
  }

  return {
    runRows,
    passTailStreak,
  };
}

function buildMatrixSummary({
  matrixPath,
  runRows,
  passTailStreak,
  effectiveStalledThreshold,
  effectiveHardFailThreshold,
  effectiveRequiredStreak,
}) {
  return {
    generated_at: new Date().toISOString(),
    matrix_path: matrixPath || null,
    total_windows: runRows.length,
    certification_streak: passTailStreak,
    required_streak: effectiveRequiredStreak,
    ready_for_release: passTailStreak >= effectiveRequiredStreak,
    guardrails: {
      stalled_signature_threshold: effectiveStalledThreshold,
      hard_fail_streak_threshold: effectiveHardFailThreshold,
      required_streak: effectiveRequiredStreak,
    },
    runs: runRows,
  };
}

module.exports = {
  buildMatrixSummary,
  executeMatrixWindows,
};
