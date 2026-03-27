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
  if (outcome.busy) {
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: { reason: "digest lock active", state: outcome.lockState || "valid" },
    });
    return json(res, { error: "Digest run already in progress. Try again shortly." }, 409);
  }
  if (outcome.lockUnhealthy) {
    const detail = outcome.lockError || "digest lock requires manual intervention";
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: { reason: "digest lock unhealthy", state: outcome.code, error: detail },
    });
    return json(res, {
      error: `Digest lock unhealthy (${outcome.code}). Clear or repair lock before retrying.`,
      detail,
      code: outcome.code,
    }, 503);
  }
  if (outcome.status !== "queued" && outcome.status !== "ok") {
    logAdminActionEvent(req, {
      action: "run_digest_full",
      success: false,
      details: { reason: outcome.code || "spawn_failed", error: outcome.raw.error || null },
    });
    return json(res, { error: "Failed to trigger full digest run." }, 500);
  }
  logAdminActionEvent(req, {
    action: "run_digest_full",
    success: true,
  });
  return json(res, { success: true, message: "Full scheduled digest run triggered" });
}

module.exports = {
  handleFullDigestRun,
};
