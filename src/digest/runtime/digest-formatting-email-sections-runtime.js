"use strict";

function createDigestEmailSectionsRuntime(deps) {
  const {
    BASE_URL,
    formatTopicDisplay,
    escapeHtml,
  } = deps;

  function buildWelcomeBanner(isFirstDigest, filterNote, userToken) {
    if (!isFirstDigest) return "";
    return `
  <div style="padding:24px 28px 22px;background:#F0FDF4;border-bottom:1px solid #BBF7D0;">
    <div style="font-size:21px;font-weight:700;color:#15803D;margin-bottom:8px;">👋 Welcome to SignalBrief</div>
    <div style="font-size:14px;color:#166534;line-height:1.6;margin-bottom:20px;">Your first briefing is below — ${filterNote}. Here's what you're looking at:</div>
    <div style="font-size:13px;color:#374151;margin-bottom:20px;">
      <div style="margin-bottom:12px;">
        <strong>📰 The same core signals at every depth</strong><br>
        <span style="color:#6B7280;">Scan, Brief, and Deep all use the same selected items. Your depth setting only changes how much context appears under each story.</span>
      </div>
      <div style="margin-bottom:12px;">
        <strong>🎯 Signal scores</strong> — shown as signal pills like <span style="display:inline-block;background:#ECFDF5;color:#065F46;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10B981;box-shadow:0 0 5px rgba(16,185,129,0.35);vertical-align:middle;margin-right:5px;"></span>8.5</span><br>
        <span style="color:#6B7280;">Ranked 0–10 per story using topic fit, strategic value, source quality, novelty, and duplication penalties.</span>
      </div>
      <div>
        <strong>⚙️ Configured around your topics</strong><br>
        <span style="color:#6B7280;">This digest is ${filterNote}. Update your topics, delivery schedule, or read depth anytime from settings below.</span>
      </div>
    </div>
    <a href="${BASE_URL}/settings?token=${userToken}" style="display:inline-block;background:#15803D;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:999px;">Update preferences →</a>
  </div>`;
  }

  function buildPersonalizationNote(learningSummary) {
    const summary = String(learningSummary || "").trim();
    if (!summary) return "";
    return `
  <div style="padding:12px 28px;background:#F8FAFC;border-bottom:1px solid #EAECEF;">
    <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748B;margin-bottom:4px;">Personalization update</div>
    <div style="font-size:13px;line-height:1.5;color:#334155;">🧠 ${escapeHtml(summary)}</div>
  </div>`;
  }

  function buildEditorialNote(editorialNoteText) {
    const text = String(editorialNoteText || "").trim();
    if (!text) return "";
    return `
  <div style="padding:10px 28px;background:#F0F4FF;border-bottom:1px solid #EAECEF;">
    <p style="margin:0;font-size:13px;color:#4B5563;font-style:italic;">${escapeHtml(text)}</p>
  </div>`;
  }

  function renderSettingsFooter(user, userToken) {
    if (!user) return "";
    const prefs = user.preferences || {};
    const [sh, sm] = (prefs.delivery_time || "07:00").split(":").map(Number);
    const sampm = sh >= 12 ? "PM" : "AM";
    const shour = sh % 12 || 12;
    const sTimeStr = `${shour}${sm === 0 ? "" : `:${String(sm).padStart(2, "0")}`} ${sampm} ET`;
    const sDays = prefs.days_of_week || [1, 2, 3, 4, 5];
    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let sDaysStr;
    if (sDays.length === 7) sDaysStr = "Every day";
    else if (sDays.length === 5 && !sDays.includes(0) && !sDays.includes(6)) sDaysStr = "Mon–Fri";
    else sDaysStr = sDays.map((d) => DAY_NAMES[d]).join(", ");
    const SDEPTH = { headline_only: "Scan", scan: "Scan", headline_plus_oneliner: "Brief", headline_plus_why: "Deep", full: "Deep", deep: "Deep" };
    const sDepth = SDEPTH[prefs.depth] || "Deep";
    const sTopics = (user.topics || []).map((topic) => formatTopicDisplay(topic)).join(" · ") || "—";
    const sSettingsUrl = `${BASE_URL}/settings?token=${userToken}`;
    return `
    <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #EAECEF;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9CA3AF;margin-bottom:8px;">Your digest settings</div>
      <div style="font-size:13px;color:#6B7280;line-height:1.75;">
        <div><span style="color:#4B5563;font-weight:600;">Topics:</span> ${escapeHtml(sTopics)}</div>
        <div><span style="color:#4B5563;font-weight:600;">Delivery:</span> ${escapeHtml(`${sTimeStr} • ${sDaysStr}`)}</div>
        <div><span style="color:#4B5563;font-weight:600;">Depth:</span> ${escapeHtml(sDepth)}</div>
      </div>
      <div style="margin-top:6px;">
        <a href="${sSettingsUrl}" style="font-size:13px;font-weight:600;color:#2563EB;text-decoration:none;">Edit settings →</a>
      </div>
    </div>`;
  }

  return {
    buildWelcomeBanner,
    buildPersonalizationNote,
    buildEditorialNote,
    renderSettingsFooter,
  };
}

module.exports = {
  createDigestEmailSectionsRuntime,
};
