"use strict";

const {
  loadEditorialOverrides,
  saveEditorialOverrides,
} = require("../../src/digest/domain/editorial-overrides-runtime");

const PREFIX = "/api/admin/editorial-overrides";

function sanitizeDate(val) {
  const s = String(val || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function sanitizeUrl(val) {
  const s = String(val || "").trim();
  return s.startsWith("http") ? s : "";
}

function sanitizeDomain(val) {
  return String(val || "").trim().toLowerCase();
}

async function handleAdminEditorialOverridesRoutes(ctx, deps) {
  const { req, res, pathname, url } = ctx;
  const {
    json,
    isAdminAuthed,
    requireJsonBody,
    editorialOverridesPath,
    todayStr,
    fs,
    path,
  } = deps;

  if (!pathname.startsWith(PREFIX)) return false;

  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  const today = todayStr || new Date().toISOString().slice(0, 10);
  const overrides = loadEditorialOverrides(String(editorialOverridesPath || ""), fs);

  // GET /api/admin/editorial-overrides
  if (pathname === PREFIX && req.method === "GET") {
    json(res, { ok: true, overrides });
    return true;
  }

  // POST /api/admin/editorial-overrides/pins
  if (pathname === `${PREFIX}/pins` && req.method === "POST") {
    const body = await requireJsonBody(req);
    const pinUrl = sanitizeUrl(body?.url);
    const date = sanitizeDate(body?.date) || today;
    if (!pinUrl) {
      json(res, { ok: false, error: "validation_failed", errors: ["url is required"] }, 400);
      return true;
    }
    const topic = String(body?.topic || "").trim().toUpperCase();
    const note = String(body?.note || "").trim();
    overrides.pins = overrides.pins.filter((p) => String(p?.url || "") !== pinUrl);
    overrides.pins.push({ url: pinUrl, topic, date, note });
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, overrides });
    return true;
  }

  // POST /api/admin/editorial-overrides/excludes
  if (pathname === `${PREFIX}/excludes` && req.method === "POST") {
    const body = await requireJsonBody(req);
    const exUrl = sanitizeUrl(body?.url);
    const date = sanitizeDate(body?.date) || today;
    if (!exUrl) {
      json(res, { ok: false, error: "validation_failed", errors: ["url is required"] }, 400);
      return true;
    }
    const note = String(body?.note || "").trim();
    overrides.excludes = overrides.excludes.filter((e) => String(e?.url || "") !== exUrl);
    overrides.excludes.push({ url: exUrl, date, note });
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, overrides });
    return true;
  }

  // POST /api/admin/editorial-overrides/suppressions
  if (pathname === `${PREFIX}/suppressions` && req.method === "POST") {
    const body = await requireJsonBody(req);
    const domain = sanitizeDomain(body?.domain);
    const date = sanitizeDate(body?.date) || today;
    if (!domain) {
      json(res, { ok: false, error: "validation_failed", errors: ["domain is required"] }, 400);
      return true;
    }
    const note = String(body?.note || "").trim();
    overrides.source_suppressions = overrides.source_suppressions.filter(
      (s) => String(s?.domain || "").toLowerCase() !== domain
    );
    overrides.source_suppressions.push({ domain, date, note });
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, overrides });
    return true;
  }

  // DELETE /api/admin/editorial-overrides/pins?url=...
  if (pathname === `${PREFIX}/pins` && req.method === "DELETE") {
    const targetUrl = sanitizeUrl(url.searchParams.get("url"));
    if (!targetUrl) {
      json(res, { ok: false, error: "url query param required" }, 400);
      return true;
    }
    const before = overrides.pins.length;
    overrides.pins = overrides.pins.filter((p) => String(p?.url || "") !== targetUrl);
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, removed: before - overrides.pins.length, overrides });
    return true;
  }

  // DELETE /api/admin/editorial-overrides/excludes?url=...
  if (pathname === `${PREFIX}/excludes` && req.method === "DELETE") {
    const targetUrl = sanitizeUrl(url.searchParams.get("url"));
    if (!targetUrl) {
      json(res, { ok: false, error: "url query param required" }, 400);
      return true;
    }
    const before = overrides.excludes.length;
    overrides.excludes = overrides.excludes.filter((e) => String(e?.url || "") !== targetUrl);
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, removed: before - overrides.excludes.length, overrides });
    return true;
  }

  // DELETE /api/admin/editorial-overrides/suppressions?domain=...
  if (pathname === `${PREFIX}/suppressions` && req.method === "DELETE") {
    const targetDomain = sanitizeDomain(url.searchParams.get("domain"));
    if (!targetDomain) {
      json(res, { ok: false, error: "domain query param required" }, 400);
      return true;
    }
    const before = overrides.source_suppressions.length;
    overrides.source_suppressions = overrides.source_suppressions.filter(
      (s) => String(s?.domain || "").toLowerCase() !== targetDomain
    );
    saveEditorialOverrides(String(editorialOverridesPath), overrides, today, fs, path);
    json(res, { ok: true, removed: before - overrides.source_suppressions.length, overrides });
    return true;
  }

  json(res, { ok: false, error: "method_not_allowed" }, 405);
  return true;
}

module.exports = { handleAdminEditorialOverridesRoutes };
