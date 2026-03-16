async function handleCoreRequestLinkRoute(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    json,
    requireJsonBody,
    allUsers,
    sendMagicLinkEmail,
    checkMagicLinkRateLimit,
    getClientIp,
  } = deps;

  if (pathname !== "/api/request-link" || req.method !== "POST") return false;

  const body = await requireJsonBody(req, res);
  if (body == null) return true;
  const email = String(body.email || "").toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    json(res, { error: "valid email required" }, 400);
    return true;
  }

  // Rate limit: apply before user lookup to prevent enumeration via timing.
  // Return generic success even when limited or when email is not found.
  if (checkMagicLinkRateLimit && getClientIp) {
    const ip = getClientIp(req);
    const rl = checkMagicLinkRateLimit(ip, email);
    if (rl.limited) {
      json(res, { success: true }, 200);
      return true;
    }
  }

  const user = allUsers().find((row) => (row.email || "").toLowerCase().trim() === email);
  if (!user || !user.token) {
    // Return generic success to prevent user enumeration.
    json(res, { success: true }, 200);
    return true;
  }

  try {
    await sendMagicLinkEmail(user);
    json(res, { success: true });
  } catch (error) {
    console.error("[magic link]", error);
    json(res, { success: false, error: "Could not send link right now." }, 502);
  }
  return true;
}

module.exports = {
  handleCoreRequestLinkRoute,
};
