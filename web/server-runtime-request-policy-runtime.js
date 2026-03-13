"use strict";

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

function handleCorsPreflightPolicy({ req, res }) {
  if (req.method !== "OPTIONS") return false;
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
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
  applyCanonicalHostPolicy,
  handleCorsPreflightPolicy,
  handleRequestErrorPolicy,
};
