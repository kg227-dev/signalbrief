const { createRenderPublicPages } = require("./server-render-public-pages-runtime");

function normalizeReferralToken(raw) {
  const token = String(raw || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizePublicUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function stripHtml(raw) {
  return String(raw || "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPublicDigestDateLabel(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return dateKey || "SignalBrief";
  const [year, month, day] = String(dateKey).split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const {
  renderPublicDigestPage,
  renderPublicDigestMissingPage,
} = createRenderPublicPages({
  normalizeReferralToken,
  escapeHtml,
  sanitizePublicUrl,
  stripHtml,
  formatPublicDigestDateLabel,
});

module.exports = {
  normalizeReferralToken,
  escapeHtml,
  formatPublicDigestDateLabel,
  renderPublicDigestPage,
  renderPublicDigestMissingPage,
};
