"use strict";

const INCIDENT_STATUS_OPEN = "OPEN";
const INCIDENT_STATUS_ESCALATED = "ESCALATED";
const INCIDENT_STATUS_RESOLVED = "RESOLVED";
const INCIDENT_SEVERITY_WARNING = "WARNING";
const INCIDENT_SEVERITY_CRITICAL = "CRITICAL";
const INCIDENT_SEVERITY_FATAL = "FATAL";

function _computeSeverity(occurrenceCount) {
  if (occurrenceCount >= 3) return INCIDENT_SEVERITY_FATAL;
  if (occurrenceCount >= 2) return INCIDENT_SEVERITY_CRITICAL;
  return INCIDENT_SEVERITY_WARNING;
}

function _generateIncidentId(dateEt) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sb-inc-${dateEt}-${rand}`;
}

function createDigestOrchestratorIncidentRuntime(deps) {
  const {
    fs,
    path,
    incidentLogPath,
    incidentStorePath,
    log,
    formatEtDateKey,
    resolveOpsChatId,
    sendTelegram,
    nowProvider = () => new Date(),
  } = deps || {};

  // In-memory fallback when incidentStorePath is not provided (isolated per factory instance)
  let _inMemoryStore = { version: 1, updated_at: "", incidents: {} };

  const logger = typeof log === "function" ? log : () => {};
  const getOpsChatId = typeof resolveOpsChatId === "function" ? resolveOpsChatId : () => null;
  const sendTelegramMessage = typeof sendTelegram === "function" ? sendTelegram : async () => {};

  function _atomicWriteJson(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function _loadIncidentStore() {
    if (!incidentStorePath) {
      return _inMemoryStore;
    }
    try {
      const raw = fs.readFileSync(incidentStorePath, "utf8");
      return JSON.parse(raw);
    } catch (e) {
      return { version: 1, updated_at: "", incidents: {} };
    }
  }

  function _saveIncidentStore(store) {
    const now = nowProvider();
    store.updated_at = now.toISOString();
    if (!incidentStorePath) {
      _inMemoryStore = store;
      return;
    }
    try {
      _atomicWriteJson(incidentStorePath, store);
    } catch (e) {
      logger(`[warn] Incident store write failed: ${e.message}`);
    }
  }

  function appendIncidentLog(entry) {
    if (!incidentLogPath) return;
    try {
      const dir = path.dirname(incidentLogPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(incidentLogPath, `${JSON.stringify(entry)}\n`);
    } catch (e) {
      logger(`WARN Incident log write failed: ${e.message}`);
    }
  }

  async function _notifyTelegram(incident, transitionType, previousSeverity) {
    const opsChatId = getOpsChatId();
    if (!opsChatId) return;
    let lines;
    if (transitionType === "OPEN") {
      lines = [
        `⚠️ INCIDENT OPEN — SignalBrief`,
        `Type: ${incident.type}`,
        `Severity: ${incident.severity}`,
        `Summary: ${incident.summary}`,
        `ET date: ${incident.date_et}`,
        `Mode: ${incident.mode}`,
        `Occurrence: ${incident.occurrence_count}`,
      ];
    } else if (transitionType === "ESCALATED") {
      lines = [
        `🔴 INCIDENT ESCALATED — SignalBrief`,
        `Type: ${incident.type}`,
        `Severity: ${incident.severity}${previousSeverity ? ` (was ${previousSeverity})` : ""}`,
        `Summary: ${incident.summary}`,
        `ET date: ${incident.date_et}`,
        `Occurrence: ${incident.occurrence_count}`,
      ];
    } else if (transitionType === "RESOLVED") {
      lines = [
        `✅ INCIDENT RESOLVED — SignalBrief`,
        `Type: ${incident.type}`,
        `ET date: ${incident.date_et}`,
        `Occurrences: ${incident.occurrence_count}`,
      ];
    } else {
      return;
    }
    try {
      await sendTelegramMessage(lines.join("\n"), opsChatId);
    } catch (e) {
      logger(`[warn] Incident Telegram send failed: ${e.message}`);
    }
  }

  async function emitDigestIncident(type, summary, metadata = {}) {
    const now = nowProvider();
    const mode = String(metadata?.mode || "scheduled");
    const dateEt = String(metadata?.date_et || formatEtDateKey(now));
    const fingerprint = `${mode}:${type}:${dateEt}`;

    const store = _loadIncidentStore();
    let existing = store.incidents[fingerprint];

    // Re-open after RESOLVED: treat as no existing
    if (existing && existing.status === INCIDENT_STATUS_RESOLVED) {
      existing = null;
    }

    if (!existing) {
      // Create new record
      const record = {
        incident_id: _generateIncidentId(dateEt),
        fingerprint,
        status: INCIDENT_STATUS_OPEN,
        severity: INCIDENT_SEVERITY_WARNING,
        type: String(type || "unknown"),
        mode,
        date_et: dateEt,
        first_seen: now.toISOString(),
        last_seen: now.toISOString(),
        occurrence_count: 1,
        summary: String(summary || "").trim(),
        metadata: metadata && typeof metadata === "object" ? metadata : {},
        notified_statuses: [],
      };
      store.incidents[fingerprint] = record;
      appendIncidentLog({
        ts_utc: now.toISOString(),
        date_et: dateEt,
        event_key: fingerprint,
        type: record.type,
        summary: record.summary,
        status: INCIDENT_STATUS_OPEN,
        severity: INCIDENT_SEVERITY_WARNING,
        occurrence: 1,
        metadata: record.metadata,
      });
      _saveIncidentStore(store);
      await _notifyTelegram(record, "OPEN", null);
      record.notified_statuses.push("OPEN");
      _saveIncidentStore(store);
      return true;
    }

    // Existing incident (OPEN or ESCALATED)
    const previousSeverity = existing.severity;
    existing.occurrence_count += 1;
    existing.last_seen = now.toISOString();
    existing.summary = String(summary || existing.summary);
    // Optionally merge metadata fields
    if (metadata && typeof metadata === "object") {
      Object.assign(existing.metadata, metadata);
    }

    const newSeverity = _computeSeverity(existing.occurrence_count);
    const severityIncreased = newSeverity !== existing.severity;

    if (severityIncreased) {
      existing.severity = newSeverity;
      existing.status = INCIDENT_STATUS_ESCALATED;
    }

    appendIncidentLog({
      ts_utc: now.toISOString(),
      date_et: dateEt,
      event_key: fingerprint,
      type: existing.type,
      summary: existing.summary,
      status: existing.status,
      severity: existing.severity,
      occurrence: existing.occurrence_count,
      metadata: existing.metadata,
    });
    _saveIncidentStore(store);

    if (severityIncreased) {
      await _notifyTelegram(existing, "ESCALATED", previousSeverity);
      existing.notified_statuses.push("ESCALATED");
      _saveIncidentStore(store);
      return true;
    }

    return false;
  }

  async function resolveIncident(fingerprint) {
    const store = _loadIncidentStore();
    const incident = store.incidents[fingerprint];
    if (!incident || incident.status === INCIDENT_STATUS_RESOLVED) return false;
    incident.status = INCIDENT_STATUS_RESOLVED;
    incident.last_seen = nowProvider().toISOString();
    _saveIncidentStore(store);
    await _notifyTelegram(incident, "RESOLVED", null);
    incident.notified_statuses.push("RESOLVED");
    _saveIncidentStore(store);
    return true;
  }

  function getActiveIncidents(dateEt) {
    const store = _loadIncidentStore();
    return Object.values(store.incidents).filter(
      (inc) =>
        (inc.status === INCIDENT_STATUS_OPEN || inc.status === INCIDENT_STATUS_ESCALATED) &&
        inc.date_et === dateEt
    );
  }

  return {
    appendIncidentLog,
    emitDigestIncident,
    resolveIncident,
    getActiveIncidents,
  };
}

module.exports = {
  createDigestOrchestratorIncidentRuntime,
  INCIDENT_STATUS_OPEN,
  INCIDENT_STATUS_ESCALATED,
  INCIDENT_STATUS_RESOLVED,
  INCIDENT_SEVERITY_WARNING,
  INCIDENT_SEVERITY_CRITICAL,
  INCIDENT_SEVERITY_FATAL,
};
