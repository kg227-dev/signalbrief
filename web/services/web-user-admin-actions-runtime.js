function logTargetedResult({
  req,
  logAdminActionEvent,
  targetUser,
  targetChatId,
  success,
  details,
}) {
  logAdminActionEvent(req, {
    action: "run_digest_targeted",
    target_email: targetUser.email || null,
    target_chat_id: targetChatId,
    success,
    details: details || undefined,
  });
}

function findTargetUser(allUsers, targetChatId) {
  return allUsers().find((user) => String(user.chatId || "").trim() === targetChatId) || null;
}

async function handleTargetedDigestRun({
  req,
  res,
  json,
  allUsers,
  targetChatId,
  logAdminActionEvent,
}) {
  const targetUser = findTargetUser(allUsers, targetChatId);
  if (!targetUser) return json(res, { error: `No user found for chatId ${targetChatId}` }, 404);
  const detail = "Targeted digests are disabled in the reduced-scope email-only MVP.";
  logTargetedResult({
    req,
    logAdminActionEvent,
    targetUser,
    targetChatId,
    success: false,
    details: { reason: "targeted_mode_disabled", detail },
  });
  return json(res, { error: detail }, 410);
}

async function handleFullDigestRun({
  req,
  res,
  json,
  startDigestTrigger,
  logAdminActionEvent,
}) {
  const outcome = await startDigestTrigger({
    source: "web:admin_full",
    trigger: "admin_full",
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
  handleTargetedDigestRun,
  handleFullDigestRun,
};
