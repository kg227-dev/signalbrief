"use strict";

const NUM_LABELS = ["1⃣", "2⃣", "3⃣", "4⃣", "5⃣", "6⃣", "7⃣", "8⃣", "9⃣", "🔟"];

function buildCommandMenu(state) {
  const isNewUser = state.digests_received < 5;
  if (isNewUser) {
    return [
      "───",
      "📧 Deeper takes in your email",
      "",
      "💾 save 3 → bookmarks item 3",
      "💾 save 1,4,6 → bookmarks multiple",
      "📊 more AI → see more AI stories",
      "📉 less M&A → see fewer M&A stories",
      "➕ add GLP-1 → track a new topic",
      "⚙️ settings → view/change all preferences",
    ].join("\n");
  }
  return [
    "───",
    "📧 Deeper takes in your email",
    "💾 save [#] · 📊 more/less [topic] · ⚙️ settings",
  ].join("\n");
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

function extractWimLead(rawWim) {
  if (typeof rawWim !== "string" || !rawWim.trim()) return null;
  const firstSentence = rawWim
    .replace(/<\/?[^>]+>/g, "")
    .split(/(?<=[a-z][.!?]|[!?])\s+(?=[A-Z])/)[0];
  if (!firstSentence) return null;
  return firstSentence.length > 250
    ? `${firstSentence.slice(0, 247).replace(/\s+\S*$/, "")}…`
    : firstSentence;
}

function formatWhyShown(whyShown) {
  if (!Array.isArray(whyShown) || !whyShown.length) return null;
  return whyShown.map((key) => String(key).replace(/_/g, " ")).join(", ");
}

function formatTelegram(items, dateStr, state, opts = {}) {
  const quality = digestQualityLabel(opts.digestQuality);
  const learningSummary = String(opts.learningSummary || "").trim();
  const publicDigestUrl = String(opts.publicDigestUrl || "").trim();
  const lines = [
    `☀️ *SignalBrief — ${dateStr}*`,
    "_Your daily signal across AI, strategy, and business_",
  ];

  if (quality) lines.push(`🎯 Digest quality: ${quality.score}% · ${quality.band}`);
  if (learningSummary) lines.push(`🧠 ${learningSummary}`);
  if (publicDigestUrl) lines.push(`🔗 [Share today's brief](${publicDigestUrl})`);
  lines.push("");

  items.forEach((item, i) => {
    const num = NUM_LABELS[i] || `${i + 1}.`;
    const wim = extractWimLead(item.wim);
    const whyShown = formatWhyShown(item.why_shown);

    lines.push(`${num} *[${item.tag}]* ${item.headline}`);
    if (item?.delivery_confidence === "lower") lines.push(`⚠️ Lower-confidence signal`);
    if (wim) lines.push(`_${wim}_`);
    if (whyShown) lines.push(`· why shown: ${whyShown}`);
    if (item.url && item.url !== "#") lines.push(`→ [${item.source}](${item.url})`);
    else lines.push(`→ ${item.source}`);
    lines.push("");
  });

  lines.push(buildCommandMenu(state));
  return lines.join("\n");
}

module.exports = {
  formatTelegram,
};
