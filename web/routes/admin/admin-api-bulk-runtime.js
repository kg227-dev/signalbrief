const {
  BULK_ACTIONS,
  normalizeBulkEmails,
  planBulkActionEntries,
  mapBulkAffected,
  applyBulkActionEntries,
} = require("./admin-api-bulk-actions-runtime");

async function handleAdminBulkRoute(ctx, deps) {
  const { req, pathname } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    normalizeDeliveryTimeInput,
    allUsers,
    writeUser,
    sendMagicLinkEmail,
    logAdminActionEvent,
  } = deps;

  if (pathname !== "/api/admin/bulk-action" || req.method !== "POST") return false;
  if (!isAdminAuthed(req)) {
    json(ctx.res, { error: "admin access only" }, 403);
    return true;
  }

  const body = await requireJsonBody(req, ctx.res);
  if (body == null) return true;

  const action = String(body.action || "").toLowerCase().trim();
  const dryRun = body.dry_run !== false;
  const uniqueEmails = normalizeBulkEmails(body.emails);
  if (!uniqueEmails.length) {
    json(ctx.res, { error: "at least one email required" }, 400);
    return true;
  }
  if (!BULK_ACTIONS.has(action)) {
    json(ctx.res, { error: "unsupported bulk action" }, 400);
    return true;
  }

  let normalizedTime = null;
  if (action === "set_time") {
    normalizedTime = normalizeDeliveryTimeInput(body.delivery_time);
    if (!normalizedTime) {
      json(ctx.res, { error: "invalid delivery_time" }, 400);
      return true;
    }
  }

  const usersByEmail = new Map(
    allUsers()
      .filter((user) => user.email)
      .map((user) => [String(user.email).toLowerCase().trim(), user])
  );

  const { planned, skipped } = planBulkActionEntries({
    action,
    normalizedTime,
    uniqueEmails,
    usersByEmail,
  });
  const affected = mapBulkAffected(planned, "planned");

  if (dryRun) {
    json(ctx.res, {
      success: true,
      dry_run: true,
      action,
      requested: uniqueEmails.length,
      applicable: planned.length,
      skipped,
      affected,
    });
    return true;
  }

  const { applied, skipped: finalSkipped } = await applyBulkActionEntries({
    req,
    planned,
    skipped,
    writeUser,
    sendMagicLinkEmail,
    logAdminActionEvent,
  });

  json(ctx.res, {
    success: true,
    dry_run: false,
    action,
    requested: uniqueEmails.length,
    applicable: planned.length,
    applied: applied.length,
    skipped: finalSkipped,
    affected: mapBulkAffected(applied, "applied"),
  });
  return true;
}

module.exports = {
  handleAdminBulkRoute,
};
