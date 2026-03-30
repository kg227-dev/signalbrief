"use strict";

function createDigestEmailItemsRuntime(deps) {
  const {
    BASE_URL,
    topicVisual,
    scoreColor,
    escapeHtml,
  } = deps;

  const EMAIL_FLAG_LABELS = { earnings: "Earnings", guidance: "Guidance", m_and_a: "Deal", regulatory: "Regulatory", leadership: "Leadership", ipo: "IPO" };

  function renderEmailSourceBadge(tier) {
    if (tier === "premium") return " · <span style=\"font-size:11px;color:#1d4ed8;font-weight:600;\">Primary</span>";
    if (tier === "strong") return " · <span style=\"font-size:11px;color:#15803d;font-weight:600;\">Verified</span>";
    if (tier === "corporate") return " · <span style=\"font-size:11px;color:#92400e;font-weight:600;\">Press release</span>";
    if (tier === "weak" || tier === "suspect") return " · <span style=\"font-size:11px;color:#b91c1c;font-weight:600;\">Use caution</span>";
    return "";
  }

  function renderEmailFreshness(publishedDate, digestDateKey) {
    if (!publishedDate || !digestDateKey) return "";
    const pub = new Date(publishedDate);
    if (isNaN(pub)) return "";
    const digest = new Date(digestDateKey + "T12:00:00Z");
    const diffDays = Math.round((digest - pub) / 86400000);
    if (diffDays <= 0) return " · <span style=\"font-size:11px;color:#6B7280;\">Today</span>";
    if (diffDays === 1) return " · <span style=\"font-size:11px;color:#6B7280;\">Yesterday</span>";
    if (diffDays <= 3) return ` · <span style="font-size:11px;color:#6B7280;">${diffDays}d ago</span>`;
    return ` · <span style="font-size:11px;color:#b45309;">${diffDays}d ago</span>`;
  }

  function renderDigestItemHtml(item, index, opts = {}) {
    const userToken = String(opts.userToken || "");
    const digestId = String(opts.digestId || "");
    const depth = String(opts.depth || "headline_plus_why");
    const digestDateKey = String(opts.digestDateKey || "");
    const linkUrl = item.url && item.url !== "#" ? item.url : `https://${item.source}`;
    const trackedLinkUrl = userToken && digestId
      ? `${BASE_URL}/api/click?token=${encodeURIComponent(userToken)}&did=${encodeURIComponent(digestId)}&item=${index + 1}&url=${encodeURIComponent(linkUrl)}`
      : linkUrl;
    const topic = topicVisual(item.tag);
    const tagText = escapeHtml(String(item.tag || "NEWS"));

    const score = Number(item.relevanceScore);
    const scoreHtml = Number.isFinite(score) ? (() => {
      const color = scoreColor(score);
      return `<span style="display:inline-block;font-size:12px;font-weight:700;color:#fff;background:${color.solid};padding:3px 9px;border-radius:5px;letter-spacing:0.02em;line-height:1.4;">${score.toFixed(1)}</span>`;
    })() : "";

    const isDeep = depth === "headline_plus_why" || depth === "full" || depth === "deep";

    // Content flag chips (muted text, before headline)
    const knownFlags = (item.content_flags || []).filter((f) => EMAIL_FLAG_LABELS[f]);
    const flagsHtml = knownFlags.length
      ? `<div style="margin-bottom:8px;">${knownFlags.map((f) => `<span style="font-size:11px;font-weight:600;color:#6B7280;background:#F3F4F6;padding:2px 7px;border-radius:100px;margin-right:4px;">${EMAIL_FLAG_LABELS[f]}</span>`).join("")}</div>`
      : "";

    // WIM: show analysis when present; fall back to truncated summary so raw RSS walls of text don't appear in place of analysis
    const bodyHtml = (() => {
      const wim = item.wim || "";
      if (wim) {
        return `<div style="font-size:15px;color:#111827;line-height:1.65;margin-bottom:12px;">${wim}</div>`;
      }
      const summary = String(item.summary || "").trim();
      if (!summary) return "";
      const truncated = summary.length > 200 ? `${summary.slice(0, 197)}…` : summary;
      return `<div style="font-size:15px;color:#6B7280;line-height:1.65;margin-bottom:12px;">${escapeHtml(truncated)}</div>`;
    })();

    const implHtml = (isDeep && item.implications)
      ? `<div style="font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:8px;font-style:italic;">${item.implications}</div>`
      : "";
    const watchHtml = (isDeep && item.watch_next)
      ? `<div style="font-size:12px;color:#9CA3AF;line-height:1.6;margin-bottom:8px;font-style:italic;">👀 ${item.watch_next}</div>`
      : "";

    const sourceBadgeHtml = renderEmailSourceBadge(item.source_tier);
    const corrobHtml = Number(item.cross_source_count) >= 2
      ? ` · <span style="font-size:11px;color:#6B7280;">+${Number(item.cross_source_count) - 1} source${Number(item.cross_source_count) > 2 ? "s" : ""}</span>`
      : "";
    const freshnessHtml = renderEmailFreshness(item.published_date, digestDateKey);

    const itemStyle = "padding:22px 28px;border-bottom:1px solid #EAECEF;";
    return `
      <div class="item" style="${itemStyle}">
        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:10px;">
          <tr>
            <td style="vertical-align:middle;padding:0 8px 0 0;">
              <span style="font-size:14px;color:#9CA3AF;font-weight:700;margin-right:8px;">${index + 1}</span>
              <span style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};background:${topic.chipBg};padding:3px 8px;border-radius:6px;">${topic.icon} ${tagText}</span>
            </td>
            <td style="text-align:right;vertical-align:middle;padding:0;white-space:nowrap;">${scoreHtml}</td>
          </tr>
        </table>
        ${flagsHtml}
        <a href="${trackedLinkUrl}" style="text-decoration:none;color:inherit;">
          <div style="font-size:20px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em;margin-bottom:12px;font-family:'Playfair Display',Georgia,serif;">${item.headline}</div>
        </a>
        ${bodyHtml}
        ${implHtml}
        ${watchHtml}
        <div style="font-size:14px;"><a href="${trackedLinkUrl}" style="color:#2563EB;text-decoration:none;font-weight:600;">Read more →</a><span style="font-size:12px;color:#9CA3AF;">&nbsp;&nbsp;${escapeHtml(item.source || "")}${sourceBadgeHtml}${corrobHtml}${freshnessHtml}</span></div>
      </div>`;
  }

  return {
    renderDigestItemHtml,
  };
}

module.exports = {
  createDigestEmailItemsRuntime,
};
