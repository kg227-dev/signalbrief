"use strict";

function parseSourceDomain(item, opts = {}) {
  const rawUrl = String(item?.url || "").trim();
  if (rawUrl) {
    try {
      return new URL(rawUrl).hostname.replace(/^www\./i, "").toLowerCase();
    } catch (err) {
      if (typeof opts.onUrlParseError === "function") opts.onUrlParseError(err);
    }
  }

  const rawSource = String(item?.source || "").trim().toLowerCase();
  if (!rawSource) return "unknown";
  return rawSource.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/\s]/)[0] || "unknown";
}

module.exports = {
  parseSourceDomain,
};

