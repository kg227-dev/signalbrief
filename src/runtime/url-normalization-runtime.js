"use strict";

function normalizeCanonicalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString().toLowerCase();
  } catch {
    // Intentionally silent: invalid URLs are normalized as best-effort lowercase strings.
    return raw.toLowerCase();
  }
}

module.exports = {
  normalizeCanonicalUrl,
};
