"use strict";

function parseCliOptionValue(args, name) {
  const rows = Array.isArray(args) ? args : [];
  const prefix = `${String(name || "").trim()}=`;
  for (let index = 0; index < rows.length; index += 1) {
    const current = String(rows[index] || "").trim();
    if (!current) continue;
    if (current === name) {
      const next = String(rows[index + 1] || "").trim();
      return next || "";
    }
    if (current.startsWith(prefix)) {
      return current.slice(prefix.length).trim();
    }
  }
  return "";
}

function normalizeAuditTopicTag(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAuditDateKey(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDigestRunArgs(args = [], deps = {}) {
  const formatDateKey = typeof deps.formatEtDateKey === "function"
    ? deps.formatEtDateKey
    : ((value) => String(value instanceof Date ? value.toISOString().slice(0, 10) : ""));
  const fallbackFormatEtDateKey = typeof deps.fallbackFormatEtDateKey === "function"
    ? deps.fallbackFormatEtDateKey
    : formatDateKey;
  const isDigestDryRunEnabled = typeof deps.isDigestDryRunEnabled === "function"
    ? deps.isDigestDryRunEnabled
    : (() => false);
  const dryRun = args.includes("--dry-run") || isDigestDryRunEnabled();
  const suppressWelcome = args.includes("--suppressWelcome");
  const auditOnly = args.includes("--auditOnly");
  const inventoryRefreshOnly = args.includes("--inventory-refresh-only");
  const auditTopicTag = normalizeAuditTopicTag(parseCliOptionValue(args, "--auditTopic"));
  const auditDateKey = normalizeAuditDateKey(parseCliOptionValue(args, "--auditDate"));
  const todayEt = normalizeAuditDateKey(formatDateKey(new Date())) || fallbackFormatEtDateKey(new Date());
  const auditTopicRerun = auditOnly && !!auditTopicTag;
  const runMode = inventoryRefreshOnly
    ? "inventory_refresh"
    : (auditTopicRerun ? "admin_topic_audit_rerun" : "scheduled");
  return {
    dryRun,
    suppressWelcome,
    auditOnly,
    inventoryRefreshOnly,
    auditTopicTag,
    auditDateKey,
    todayEt,
    auditTopicRerun,
    runMode,
  };
}

module.exports = {
  parseCliOptionValue,
  normalizeAuditTopicTag,
  normalizeAuditDateKey,
  parseDigestRunArgs,
};
