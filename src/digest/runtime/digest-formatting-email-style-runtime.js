"use strict";

function createDigestEmailStyleRuntime() {
  function scoreColor(score) {
    if (score >= 8.0) {
      return { dot: "#10B981", text: "#065F46", bg: "#ECFDF5", glow: "0 0 6px rgba(16,185,129,0.35)", solid: "#10B981" };
    }
    if (score >= 6.0) {
      return { dot: "#34D399", text: "#065F46", bg: "#ECFDF5", glow: "0 0 6px rgba(52,211,153,0.3)", solid: "#34D399" };
    }
    if (score >= 4.0) {
      return { dot: "#F59E0B", text: "#92400E", bg: "#FFFBEB", glow: "0 0 5px rgba(245,158,11,0.24)", solid: "#F59E0B" };
    }
    return { dot: "#9CA3AF", text: "#4B5563", bg: "#F3F4F6", glow: "none", solid: "#9CA3AF" };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function digestQualityLabel(digestQuality) {
    const score = Number(digestQuality?.score);
    if (!Number.isFinite(score)) return null;
    const rounded = Math.max(0, Math.min(100, Math.round(score)));
    const band = String(digestQuality?.band || "").toLowerCase();
    const bandLabel = band === "strong" ? "strong" : (band === "watch" ? "watch" : "tuning");
    return {
      score: rounded,
      band: bandLabel,
    };
  }

  function buildEmailHeaderMeta(itemsCount, digestQuality) {
    const quality = digestQualityLabel(digestQuality);
    const readMins = Math.max(2, Math.ceil(Number(itemsCount || 0) * 0.6));
    return `${itemsCount} signals · ${readMins} min read`;
  }

  return {
    scoreColor,
    escapeHtml,
    buildEmailHeaderMeta,
  };
}

module.exports = {
  createDigestEmailStyleRuntime,
};
