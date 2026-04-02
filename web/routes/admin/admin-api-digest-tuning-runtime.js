"use strict";

const {
  loadDigestTuning,
  validateDigestTuning,
  ALLOWED_TUNING_KEYS,
  LOCKED_TUNING_KEYS,
} = require("../../../src/runtime/digest-tuning-runtime");

/**
 * GET  /api/admin/digest-tuning  — read current overrides
 * PUT  /api/admin/digest-tuning  — replace overrides (validated)
 * DELETE not supported (use PUT with {})
 */
async function handleAdminDigestTuningRoutes(ctx, deps) {
  const { req, res, pathname } = ctx;
  const { json, isAdminAuthed, requireJsonBody, digestTuningPath, fs, path } = deps;

  if (pathname !== "/api/admin/digest-tuning") return false;

  if (!isAdminAuthed(req)) {
    json(res, { ok: false, error: "unauthorized" }, 401);
    return true;
  }

  if (req.method === "GET") {
    const tuning = loadDigestTuning(String(digestTuningPath || ""), fs);
    json(res, { ok: true, tuning, allowed_keys: ALLOWED_TUNING_KEYS, locked_keys: LOCKED_TUNING_KEYS });
    return true;
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await requireJsonBody(req);
    } catch (_) {
      json(res, { ok: false, error: "invalid_json" }, 400);
      return true;
    }

    const { ok, errors } = validateDigestTuning(body || {});
    if (!ok) {
      json(res, { ok: false, error: "validation_failed", errors }, 400);
      return true;
    }

    const tuningPath = String(digestTuningPath || "");
    if (!tuningPath) {
      json(res, { ok: false, error: "tuning_path_not_configured" }, 500);
      return true;
    }

    try {
      const dir = path.dirname(tuningPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tuningPath, JSON.stringify(body, null, 2), "utf8");
    } catch (err) {
      json(res, { ok: false, error: "write_failed", detail: String(err?.message || err).slice(0, 120) }, 500);
      return true;
    }

    json(res, { ok: true, tuning: body, message: "Tuning saved. Changes take effect on the next digest run." });
    return true;
  }

  json(res, { ok: false, error: "method_not_allowed", allowed: ["GET", "PUT"] }, 405);
  return true;
}

module.exports = { handleAdminDigestTuningRoutes };
