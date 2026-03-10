const {
  IMPROVEMENT_LOG_FILE,
  readJson,
  writeJson,
} = require("../config");

function allSuitesPass(payload) {
  if (!payload?.suites) return false;
  const statuses = Object.values(payload.suites).map((suite) => String(suite.status || "").toLowerCase());
  if (!statuses.length) return false;
  return statuses.every((status) => status === "pass");
}

function hardFailSuiteCount(payload) {
  if (!payload?.suites || typeof payload.suites !== "object") return 0;
  return Object.values(payload.suites)
    .map((suite) => String(suite?.status || "").toLowerCase())
    .filter((status) => status === "fail")
    .length;
}

function compositeAvg(payload) {
  return Number(
    payload?.suites?.["end-to-end"]?.score
      || payload?.suites?.end_to_end?.score
      || payload?.suites?.["end-to-end-composite"]?.score
      || 0
  );
}

function buildOpenSignature(payload) {
  const suites = payload?.suites && typeof payload.suites === "object" ? payload.suites : {};
  const parts = Object.entries(suites)
    .map(([suiteId, suite]) => ({
      suiteId,
      status: String(suite?.status || "").toLowerCase(),
    }))
    .filter((row) => row.status === "fail" || row.status === "warn")
    .sort((a, b) => a.suiteId.localeCompare(b.suiteId))
    .map((row) => `${row.suiteId}:${row.status}`);
  return parts.length ? parts.join("|") : "all_pass";
}

function readImprovementLogEntries() {
  const raw = readJson(IMPROVEMENT_LOG_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function writeImprovementLogEntries(entries) {
  writeJson(IMPROVEMENT_LOG_FILE, Array.isArray(entries) ? entries : []);
}

function hasAcknowledgedSignature(entries, signature) {
  const target = String(signature || "").trim();
  if (!target || target === "all_pass") return true;

  return entries.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (String(entry.type || "") !== "matrix_signature_ack") return false;
    if (String(entry.signature || "") !== target) return false;
    const state = String(entry.state || "active").toLowerCase();
    return state !== "revoked";
  });
}

function appendSignatureAck(entries, signature, note = "") {
  const next = Array.isArray(entries) ? entries.slice() : [];
  next.push({
    type: "matrix_signature_ack",
    signature: String(signature || "").trim(),
    note: String(note || "").trim() || "acknowledged by operator",
    acknowledged_at: new Date().toISOString(),
    state: "active",
  });
  return next;
}

function isCertificationPathRecoverable({
  currentPassTailStreak,
  remainingWindows,
  requiredStreak,
}) {
  const tail = Math.max(0, Number(currentPassTailStreak || 0));
  const remaining = Math.max(0, Number(remainingWindows || 0));
  const required = Math.max(1, Number(requiredStreak || 1));
  return tail + remaining >= required;
}

module.exports = {
  allSuitesPass,
  hardFailSuiteCount,
  compositeAvg,
  buildOpenSignature,
  readImprovementLogEntries,
  writeImprovementLogEntries,
  hasAcknowledgedSignature,
  appendSignatureAck,
  isCertificationPathRecoverable,
};
