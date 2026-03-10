function getClientIp(req) {
  return (req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function getRequestHost(req) {
  return String(req.headers.host || "").split(":")[0].trim().toLowerCase();
}

function getRequestScheme(req) {
  const cfVisitor = String(req.headers["cf-visitor"] || "").trim();
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor);
      const scheme = String(parsed?.scheme || "").toLowerCase();
      if (scheme === "http" || scheme === "https") return scheme;
    } catch (err) {
      if (process.env.DEBUG_WEB_SERVER === "1") {
        console.warn(`[web] malformed cf-visitor header ignored: ${err.message}`);
      }
    }
  }

  const xForwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (xForwardedProto === "http" || xForwardedProto === "https") return xForwardedProto;

  return req.socket.encrypted ? "https" : "http";
}

module.exports = {
  getClientIp,
  getRequestHost,
  getRequestScheme,
};
