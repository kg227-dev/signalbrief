async function handleAdminAuthRoutes(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    json,
    getClientIp,
    checkLoginRate,
    requireJsonBody,
    CONFIG,
    verifyAdminPassword,
    createAdminSession,
    clearAdminSessionByRequest,
    BASE_URL,
    getBaseUrl,
    isAdminAuthed,
  } = deps;

  const resolveBaseUrl = typeof getBaseUrl === "function"
    ? () => String(getBaseUrl() || "http://localhost:3003")
    : () => String(BASE_URL || "http://localhost:3003");

  if (pathname === "/api/admin/login" && req.method === "POST") {
    const ip = getClientIp(req);
    if (checkLoginRate(ip)) {
      json(res, { error: "Too many attempts. Try again in 15 minutes." }, 429);
      return true;
    }

    const body = await requireJsonBody(req, res);
    if (body == null) return true;
    const { email, password } = body;
    if (!email || !password) {
      json(res, { error: "Email and password required" }, 400);
      return true;
    }

    const adminEmail = (CONFIG.admin && CONFIG.admin.email) || "";
    if (email.toLowerCase().trim() !== adminEmail.toLowerCase() || !verifyAdminPassword(password, CONFIG.admin || {})) {
      json(res, { error: "Invalid credentials" }, 401);
      return true;
    }

    const sessionToken = createAdminSession(email);
    const isSecure = resolveBaseUrl().startsWith("https");
    const cookieFlags = [
      `sb_admin=${sessionToken}`,
      "HttpOnly",
      "Path=/",
      `Max-Age=${7 * 24 * 60 * 60}`,
      "SameSite=Strict",
      isSecure ? "Secure" : "",
    ].filter(Boolean).join("; ");

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": cookieFlags,
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  if (pathname === "/api/admin/logout" && req.method === "POST") {
    clearAdminSessionByRequest(req);
    const isSecure = resolveBaseUrl().startsWith("https");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": [
        "sb_admin=deleted",
        "HttpOnly",
        "Path=/",
        "Max-Age=0",
        "SameSite=Strict",
        isSecure ? "Secure" : "",
      ].filter(Boolean).join("; "),
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  }

  if (pathname === "/api/admin/check" && req.method === "GET") {
    json(res, { authenticated: isAdminAuthed(req) });
    return true;
  }

  return false;
}

module.exports = {
  handleAdminAuthRoutes,
};
