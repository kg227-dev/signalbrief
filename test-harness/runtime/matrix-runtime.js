const path = require("path");
const {
  RESULTS_DIR,
  CONFIDENCE_GATES,
  writeJson,
} = require("../config");
const {
  STALLED_SIGNATURE_THRESHOLD,
  HARD_FAIL_STREAK_THRESHOLD,
  parseFiniteNumber,
  parseCli,
  loadMatrixConfig,
  buildWindowPlan,
} = require("../matrix/config");
const {
  readImprovementLogEntries,
  writeImprovementLogEntries,
  appendSignatureAck,
} = require("../matrix/guardrails");
const {
  executeMatrixWindows,
  buildMatrixSummary,
} = require("../matrix/window-execution-runtime");

function resolveGuardrails({
  matrixConfig,
  stalledThreshold,
  hardFailThreshold,
  requiredStreak,
}) {
  return {
    stalled: parseFiniteNumber(
      stalledThreshold,
      matrixConfig.stalled_signature_threshold || STALLED_SIGNATURE_THRESHOLD,
      { min: 1, max: 100 }
    ),
    hardFail: parseFiniteNumber(
      hardFailThreshold,
      matrixConfig.hard_fail_streak_threshold || HARD_FAIL_STREAK_THRESHOLD,
      { min: 1, max: 100 }
    ),
    required: parseFiniteNumber(
      requiredStreak,
      matrixConfig.required_streak || CONFIDENCE_GATES?.certification_runs_required || 3,
      { min: 1, max: 50 }
    ),
  };
}

async function runMatrix(argv = process.argv.slice(2)) {
  const {
    matrixPath,
    passthrough,
    allowStalledRerun,
    allowHardFailRerun,
    allowUnrecoverablePath,
    stalledThreshold,
    hardFailThreshold,
    requiredStreak,
    ackSignature,
    ackNote,
  } = parseCli(argv);

  const matrixConfig = loadMatrixConfig(matrixPath);
  const plan = buildWindowPlan(matrixConfig);
  let improvementLog = readImprovementLogEntries();

  if (ackSignature) {
    improvementLog = appendSignatureAck(improvementLog, ackSignature, ackNote);
    writeImprovementLogEntries(improvementLog);
    console.log(`[run-matrix] acknowledged signature: ${ackSignature}`);
  }

  const guardrails = resolveGuardrails({
    matrixConfig,
    stalledThreshold,
    hardFailThreshold,
    requiredStreak,
  });

  const { runRows, passTailStreak } = await executeMatrixWindows({
    plan,
    matrixConfig,
    passthrough,
    guardrails,
    allowStalledRerun,
    allowHardFailRerun,
    allowUnrecoverablePath,
    improvementLog,
  });

  const matrixSummary = buildMatrixSummary({
    matrixPath,
    runRows,
    passTailStreak,
    effectiveStalledThreshold: guardrails.stalled,
    effectiveHardFailThreshold: guardrails.hardFail,
    effectiveRequiredStreak: guardrails.required,
  });
  const runId = matrixSummary.generated_at.replace(/[:.]/g, "-");
  const outFile = path.join(RESULTS_DIR, `matrix-${runId}.json`);
  writeJson(outFile, matrixSummary);

  console.log(`Matrix report written: ${outFile}`);
  console.log(`Certification streak: ${passTailStreak} / ${guardrails.required}`);

  return {
    matrixSummary,
    outFile,
    passTailStreak,
    requiredStreak: guardrails.required,
  };
}

module.exports = {
  runMatrix,
};
