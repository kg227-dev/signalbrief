"use strict";

function createDigestOrchestratorIncidentRuntime(deps) {
  const {
    fs,
    path,
    incidentLogPath,
    log,
    formatEtDateKey,
    resolveOpsChatId,
    sendTelegram,
    nowProvider = () => new Date(),
  } = deps || {};
  const logger = typeof log === "function" ? log : () => {};
  const getOpsChatId = typeof resolveOpsChatId === "function" ? resolveOpsChatId : () => null;
  const sendTelegramMessage = typeof sendTelegram === "function" ? sendTelegram : async () => {};

  function appendIncidentLog(entry) {
    try {
      const dir = path.dirname(incidentLogPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(incidentLogPath, `${JSON.stringify(entry)}\n`);
    } catch (e) {
      logger(`WARN Incident log write failed: ${e.message}`);
    }
  }

  function incidentKeySeenRecently(eventKey, maxAgeHours = 24) {
    try {
      if (!eventKey || !fs.existsSync(incidentLogPath)) return false;
      const cutoff = nowProvider().getTime() - Math.max(1, Number(maxAgeHours || 24)) * 60 * 60 * 1000;
      const lines = fs.readFileSync(incidentLogPath, "utf8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const row = JSON.parse(lines[i]);
          const ts = Date.parse(row?.ts_utc || "");
          if (Number.isFinite(ts) && ts < cutoff) break;
          if (String(row?.event_key || "") === String(eventKey)) return true;
        } catch (err) {
          logger(`WARN Incident log row parse failed: ${err.message}`);
        }
      }
    } catch (err) {
      logger(`WARN Incident log read failed: ${err.message}`);
    }
    return false;
  }

  async function emitDigestIncident(type, summary, metadata = {}) {
    const now = nowProvider();
    const hourBucket = now.toISOString().slice(0, 13);
    const eventKey = `digest-incident:${String(type || "unknown")}:${hourBucket}`;
    if (incidentKeySeenRecently(eventKey, 48)) return false;

    const entry = {
      ts_utc: now.toISOString(),
      date_et: formatEtDateKey(now),
      event_key: eventKey,
      type: String(type || "unknown"),
      summary: String(summary || "").trim(),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    };
    appendIncidentLog(entry);

    const opsChatId = getOpsChatId();
    if (opsChatId) {
      const lines = [
        "ALERT SignalBrief incident",
        `Type: ${entry.type}`,
        `Summary: ${entry.summary}`,
        `ET date: ${entry.date_et}`,
        `Mode: ${entry.metadata.mode || "scheduled"}`,
        `Due users: ${entry.metadata.due_users != null ? entry.metadata.due_users : "-"}`,
        `Standard topics: ${entry.metadata.standard_topics != null ? entry.metadata.standard_topics : "-"}`,
        `Selected items: ${entry.metadata.selected_items != null ? entry.metadata.selected_items : "-"}`,
      ];
      try {
        await sendTelegramMessage(lines.join("\n"), opsChatId);
      } catch (e) {
        logger(`WARN Incident alert send failed: ${e.message}`);
      }
    }
    return true;
  }

  return {
    appendIncidentLog,
    incidentKeySeenRecently,
    emitDigestIncident,
  };
}

module.exports = {
  createDigestOrchestratorIncidentRuntime,
};
