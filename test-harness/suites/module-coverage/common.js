function check(name, fn) {
  try {
    return { name, ok: !!fn() };
  } catch (err) {
    return { name, ok: false, error: err.message };
  }
}

function buildModuleCoverageResult({
  suiteId,
  suiteName,
  checks,
}) {
  const passed = checks.filter((row) => row.ok).length;
  const failedChecks = checks.filter((row) => !row.ok);
  const score = Number(((passed / checks.length) * 100).toFixed(2));
  const status = failedChecks.length ? "fail" : "pass";

  return {
    id: suiteId,
    name: suiteName,
    score,
    score_label: `${score.toFixed(1)}%`,
    status,
    per_persona: {
      module_coverage: {
        persona: "Module coverage checks",
        score,
        passed: failedChecks.length === 0,
        checks_total: checks.length,
        checks_passed: passed,
        checks_failed: failedChecks.length,
      },
    },
    failures: failedChecks.map((row) => ({
      persona: "module_coverage",
      issue: row.name,
      evidence: row.error || "assertion failed",
    })),
    suggestions: failedChecks.length
      ? ["Fix failing module coverage checks before shipping harness changes."]
      : [],
    details: {
      checks_total: checks.length,
      checks_passed: passed,
      checks_failed: failedChecks.length,
      failed_checks: failedChecks,
    },
    confidence: 0.95,
  };
}

module.exports = {
  check,
  buildModuleCoverageResult,
};
