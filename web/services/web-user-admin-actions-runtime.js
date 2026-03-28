function resolveTodayEtDateKey(formatEtDateKey) {
  if (typeof formatEtDateKey === "function") {
    const formatted = String(formatEtDateKey(new Date()) || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  }
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function normalizeDigestAuditDateKey(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeDigestAuditTopicTag(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDigestTriggerOutcome(result) {
  const outcome = result && typeof result === "object" ? result : {};
  if (outcome.busy) return { ok: false, kind: "busy", outcome };
  if (outcome.lockUnhealthy) return { ok: false, kind: "lock_unhealthy", outcome };
  if (outcome.status !== "queued" && outcome.status !== "ok") {
    return { ok: false, kind: "spawn_failed", outcome };
  }
  return { ok: true, kind: "queued", outcome };
}

function writeBusyDigestResponse({ req, res, json, logAdminActionEvent, outcome, action, details, failureMessage }) {
  logAdminActionEvent(req, {
    action,
    success: false,
    details: { ...details, reason: "digest lock active", state: outcome.lockState || "valid" },
  });
  return json(res, { error: failureMessage || "Digest run already in progress. Try again shortly." }, 409);
}

function writeUnhealthyDigestResponse({ req, res, json, logAdminActionEvent, outcome, action, details, failurePrefix }) {
  const detail = outcome.lockError || "digest lock requires manual intervention";
  logAdminActionEvent(req, {
    action,
    success: false,
    details: { ...details, reason: "digest lock unhealthy", state: outcome.code, error: detail },
  });
  return json(res, {
    error: `${failurePrefix || "Digest lock unhealthy"} (${outcome.code}). Clear or repair lock before retrying.`,
    detail,
    code: outcome.code,
  }, 503);
}

function writeFailedDigestTriggerResponse({ req, res, json, logAdminActionEvent, outcome, action, details, failureMessage }) {
  logAdminActionEvent(req, {
    action,
    success: false,
    details: { ...details, reason: outcome.code || "spawn_failed", error: outcome.raw?.error || null },
  });
  return json(res, { error: failureMessage || "Failed to trigger digest run." }, 500);
}

async function handleFullDigestRun({
  req,
  res,
  json,
  startDigestTrigger,
  logAdminActionEvent,
}) {
  const outcome = await startDigestTrigger({
    source: "web:scheduled_recovery",
    trigger: "scheduled",
    suppressWelcome: true,
  });
  const trigger = normalizeDigestTriggerOutcome(outcome);
  if (!trigger.ok && trigger.kind === "busy") {
    return writeBusyDigestResponse({
      req,
      res,
      json,
      logAdminActionEvent,
      outcome,
      action: "run_digest_full",
      details: {},
      failureMessage: "Digest run already in progress. Try again shortly.",
    });
  }
  if (!trigger.ok && trigger.kind === "lock_unhealthy") {
    return writeUnhealthyDigestResponse({
      req,
      res,
      json,
      logAdminActionEvent,
      outcome,
      action: "run_digest_full",
      details: {},
      failurePrefix: "Digest lock unhealthy",
    });
  }
  if (!trigger.ok) {
    return writeFailedDigestTriggerResponse({
      req,
      res,
      json,
      logAdminActionEvent,
      outcome,
      action: "run_digest_full",
      details: {},
      failureMessage: "Failed to trigger full digest run.",
    });
  }
  logAdminActionEvent(req, {
    action: "run_digest_full",
    success: true,
  });
  return json(res, { success: true, message: "Full scheduled digest run triggered" });
}

async function handleTopicAuditRerun({
  req,
  res,
  json,
  body,
  startDigestTrigger,
  logAdminActionEvent,
  formatEtDateKey,
}) {
  const topicTag = normalizeDigestAuditTopicTag(body?.topic || body?.topic_tag);
  const dateKey = normalizeDigestAuditDateKey(body?.date_et);
  const todayEt = resolveTodayEtDateKey(formatEtDateKey);

  if (!topicTag) {
    return json(res, { error: "topic required" }, 400);
  }
  if (!dateKey) {
    return json(res, { error: "valid date_et required" }, 400);
  }
  if (dateKey !== todayEt) {
    logAdminActionEvent(req, {
      action: "run_digest_topic_audit",
      success: false,
      details: {
        topic_tag: topicTag,
        date_et: dateKey,
        reason: "historical_rerun_not_supported",
        today_et: todayEt,
      },
    });
    return json(res, {
      error: `Topic audit reruns only support today ET (${todayEt}) to avoid fake historical backfills.`,
      today_et: todayEt,
    }, 409);
  }

  const outcome = await startDigestTrigger({
    source: "web:topic_audit_rerun",
    trigger: "admin_topic_audit_rerun",
    suppressWelcome: true,
    extraArgs: [
      "--auditOnly",
      `--auditDate=${dateKey}`,
      `--auditTopic=${topicTag}`,
    ],
  });

  const trigger = normalizeDigestTriggerOutcome(outcome);
  if (!trigger.ok && trigger.kind === "busy") {
    return writeBusyDigestResponse({
      req,
      res,
      json,
      logAdminActionEvent,
      outcome,
      action: "run_digest_topic_audit",
      details: { topic_tag: topicTag, date_et: dateKey },
      failureMessage: "Digest run already in progress. Try again shortly.",
    });
  }
  if (!trigger.ok && trigger.kind === "lock_unhealthy") {
    return writeUnhealthyDigestResponse({
      req,
      res,
      json,
      logAdminActionEvent,
      outcome,
      action: "run_digest_topic_audit",
      details: { topic_tag: topicTag, date_et: dateKey },
      failurePrefix: "Digest lock unhealthy",
    });
  }
  if (!trigger.ok) {
    return writeFailedDigestTriggerResponse({
      req,
      res,
      json,
      logAdminActionEvent,
      outcome,
      action: "run_digest_topic_audit",
      details: { topic_tag: topicTag, date_et: dateKey },
      failureMessage: "Failed to queue topic audit rerun.",
    });
  }

  logAdminActionEvent(req, {
    action: "run_digest_topic_audit",
    success: true,
    details: {
      topic_tag: topicTag,
      date_et: dateKey,
      scope: "audit_only",
    },
  });
  return json(res, {
    success: true,
    topic_tag: topicTag,
    date_et: dateKey,
    today_et: todayEt,
    message: `Topic audit rerun queued for ${topicTag} (${dateKey})`,
  });
}

module.exports = {
  handleFullDigestRun,
  handleTopicAuditRerun,
  normalizeDigestAuditDateKey,
  normalizeDigestAuditTopicTag,
  resolveTodayEtDateKey,
};
