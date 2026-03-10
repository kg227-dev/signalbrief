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

function hasEnabledDeliveryChannel(targetUser) {
  const prefs = targetUser.preferences || {};
  const emailReady = !!targetUser.email && prefs.email_enabled !== false;
  const tgReady = !!(
    targetUser.chatId &&
    !String(targetUser.chatId).startsWith("email-") &&
    prefs.telegram_enabled !== false
  );
  return emailReady || tgReady;
}

function buildTargetedFailure(detail, fallback) {
  return detail || fallback || "unknown failure";
}

async function handleTargetedDigestRun({
  req,
  res,
  json,
  allUsers,
  targetChatId,
  runDigestTrigger,
  logAdminActionEvent,
}) {
  const targetUser = findTargetUser(allUsers, targetChatId);
  if (!targetUser) return json(res, { error: `No user found for chatId ${targetChatId}` }, 404);

  if ((targetUser.status || "active") !== "active") {
    logTargetedResult({
      req,
      logAdminActionEvent,
      targetUser,
      targetChatId,
      success: false,
      details: { reason: `user status ${targetUser.status}` },
    });
    return json(res, { error: `User is ${targetUser.status}; re-activate before sending.` }, 400);
  }

  if (!hasEnabledDeliveryChannel(targetUser)) {
    logTargetedResult({
      req,
      logAdminActionEvent,
      targetUser,
      targetChatId,
      success: false,
      details: { reason: "no enabled delivery channels" },
    });
    return json(res, { error: "No enabled delivery channels for this user." }, 400);
  }

  try {
    const outcome = await runDigestTrigger({
      source: "web:admin_targeted",
      trigger: "admin_targeted",
      chatId: targetChatId,
      suppressWelcome: true,
      timeoutMs: 12 * 60 * 1000,
    });

    if (outcome.busy) {
      const detail = outcome.raw.run?.stderr ? outcome.raw.run.stderr.slice(-260) : "digest run lock active";
      logTargetedResult({
        req,
        logAdminActionEvent,
        targetUser,
        targetChatId,
        success: false,
        details: { detail, reason: "digest lock active" },
      });
      return json(res, { error: "Digest run already in progress. Try again shortly.", detail }, 409);
    }

    if (outcome.lockUnhealthy) {
      const detail = outcome.lockError || "digest lock requires manual intervention";
      logTargetedResult({
        req,
        logAdminActionEvent,
        targetUser,
        targetChatId,
        success: false,
        details: { detail, reason: "digest lock unhealthy", state: outcome.code },
      });
      return json(res, {
        error: `Digest lock unhealthy (${outcome.code}). Clear or repair lock before retrying.`,
        detail,
        code: outcome.code,
      }, 503);
    }

    if (outcome.status !== "ok" || !outcome.raw.run || outcome.raw.run.code == null) {
      const detail = buildTargetedFailure(
        outcome.raw.run?.stderr ? outcome.raw.run.stderr.slice(-240) : null,
        outcome.raw.error || outcome.code
      );
      logTargetedResult({
        req,
        logAdminActionEvent,
        targetUser,
        targetChatId,
        success: false,
        details: { detail },
      });
      return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
    }

    if (outcome.raw.run.code !== 0) {
      const detail = buildTargetedFailure(
        outcome.raw.run.stderr ? outcome.raw.run.stderr.slice(-240) : null,
        `exit ${outcome.raw.run.code}`
      );
      logTargetedResult({
        req,
        logAdminActionEvent,
        targetUser,
        targetChatId,
        success: false,
        details: { detail },
      });
      return json(res, { error: `Digest failed for ${targetChatId}`, detail }, 500);
    }

    logTargetedResult({
      req,
      logAdminActionEvent,
      targetUser,
      targetChatId,
      success: true,
    });
    return json(res, { success: true, message: `Digest sent to ${targetUser.email || targetChatId}` });
  } catch (error) {
    logTargetedResult({
      req,
      logAdminActionEvent,
      targetUser,
      targetChatId,
      success: false,
      details: { detail: error.message },
    });
    return json(res, { error: `Failed to run digest: ${error.message}` }, 500);
  }
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
