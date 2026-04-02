"use strict";

function normalizeDigestHeadlinePreview(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  normalizeDigestHeadlinePreview,
};
