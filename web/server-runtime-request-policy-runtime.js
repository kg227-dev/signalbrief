"use strict";

function normalizeOrigin(rawOrigin) {
  const candidate = String(rawOrigin || "").trim();
  if (!candidate) return "";
  try {
    return new URL(candidate).origin.toLowerCase();
  } catch {
    return "";
  }
}

function resolveAllowedCorsOrigin({ req, trustedCorsOrigins }) {
  const origin = normalizeOrigin(req?.headers?.origin || "");
  if (!origin) return "";
  if (!(trustedCorsOrigins instanceof Set) || trustedCorsOrigins.size === 0) return "";
  return trustedCorsOrigins.has(origin) ? origin : "";
}

function applyResponseCorsPolicy({ req, res, trustedCorsOrigins }) {
  const allowedOrigin = resolveAllowedCorsOrigin({ req, trustedCorsOrigins });
  if (!allowedOrigin) return "";
  res.__corsOrigin = allowedOrigin;
  return allowedOrigin;
}

function applyCanonicalHostPolicy({
  req,
  res,
  url,
  pathname,
  getRequestHost,
  getRequestScheme,
  canonicalHost,
  publicHosts,
}) {
  const host = getRequestHost(req);
  const scheme = getRequestScheme(req);
  if (!publicHosts.has(host) || (host === canonicalHost && scheme === "https")) {
    return false;
  }

  const location = `https://${canonicalHost}${pathname}${url.search}`;
  res.writeHead(301, {
    Location: location,
    "Cache-Control": "public, max-age=300",
  });
  res.end();
  return true;
}

function handleCorsPreflightPolicy({ req, res, trustedCorsOrigins }) {
  if (req.method !== "OPTIONS") return false;
  const allowedOrigin = resolveAllowedCorsOrigin({ req, trustedCorsOrigins });
  if (!allowedOrigin) {
    res.writeHead(403, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ error: "origin not allowed" }));
    return true;
  }

  const requestHeaders = String(req.headers?.["access-control-request-headers"] || "Content-Type")
    .split(",")
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");

  res.writeHead(204, {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": requestHeaders || "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
  res.end();
  return true;
}

function handleRequestErrorPolicy({ req, res, error, logger = console.error }) {
  const message = error && error.message ? error.message : String(error || "unknown error");
  logger(`[server error] ${req.method} ${req.url} ->`, message);
  if (!res.headersSent) {
    res.writeHead(500);
    res.end("Internal server error");
  }
}

module.exports = {
  normalizeOrigin,
  resolveAllowedCorsOrigin,
  applyResponseCorsPolicy,
  applyCanonicalHostPolicy,
  handleCorsPreflightPolicy,
  handleRequestErrorPolicy,
};
