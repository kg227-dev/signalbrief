"use strict";

function createDigestEmailItemsRuntime(deps) {
  const {
    BASE_URL,
    topicVisual,
    scoreColor,
    escapeHtml,
  } = deps;

  function renderDigestItemHtml(item, index, opts = {}) {
    const userToken = String(opts.userToken || "");
    const digestId = String(opts.digestId || "");
    const depth = String(opts.depth || "headline_plus_why");
    const linkUrl = item.url && item.url !== "#" ? item.url : `https://${item.source}`;
    const trackedLinkUrl = userToken && digestId
      ? `${BASE_URL}/api/click?token=${encodeURIComponent(userToken)}&did=${encodeURIComponent(digestId)}&item=${index + 1}&url=${encodeURIComponent(linkUrl)}`
      : linkUrl;
    const topic = topicVisual(item.tag);
    const tagText = escapeHtml(String(item.tag || "NEWS"));

    const score = Number(item.relevanceScore);
    const scoreHtml = Number.isFinite(score) ? (() => {
      const color = scoreColor(score);
      return `<span style="display:inline-block;font-size:12px;font-weight:700;color:${color.text};background:${color.bg};padding:4px 10px;border-radius:999px;letter-spacing:0.01em;line-height:1;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color.dot};box-shadow:${color.glow};vertical-align:middle;margin-right:6px;"></span>
      <span style="vertical-align:middle;">${score.toFixed(1)}</span>
    </span>`;
    })() : "";

    const wimHtml = item.wim
      ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#2563EB;margin-bottom:5px;">Why it matters</div>\n        <div style="font-size:14px;color:#374151;line-height:1.65;margin-bottom:10px;">${item.wim}</div>`
      : "";

    const isDeep = depth === "headline_plus_why" || depth === "full" || depth === "deep";
    const implHtml = (isDeep && item.implications)
      ? `<div style="font-size:13px;color:#1D4ED8;line-height:1.6;margin-bottom:6px;font-weight:500;">→ ${item.implications}</div>`
      : "";
    const watchHtml = (isDeep && item.watch_next)
      ? `<div style="font-size:12px;color:#6B7280;line-height:1.6;margin-bottom:12px;font-style:italic;">👀 ${item.watch_next}</div>`
      : "";
    const whyShownHtml = Array.isArray(item.why_shown) && item.why_shown.length
      ? `<div style="font-size:11px;color:#6B7280;line-height:1.5;margin-bottom:10px;">Why shown: ${item.why_shown.map((key) => String(key).replace(/_/g, " ")).join(" · ")}</div>`
      : "";

    const itemStyle = "background:#FFFFFF;border-radius:14px;border:1px solid #ECEFF3;box-shadow:0 2px 6px rgba(0,0,0,0.04);padding:20px;margin:0 0 18px;";
    return `
      <div class="item" style="${itemStyle}">
        <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-bottom:10px;">
          <tr>
            <td style="vertical-align:middle;padding:0 8px 0 0;">
              <span style="font-size:15px;color:#6B7280;font-weight:700;margin-right:8px;">${index + 1}</span>
              <span style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${topic.chipText};background:${topic.chipBg};padding:4px 9px;border-radius:7px;">${topic.icon} ${tagText}</span>
            </td>
            <td style="text-align:right;vertical-align:middle;padding:0;white-space:nowrap;">${scoreHtml}</td>
          </tr>
        </table>
        <div style="font-size:20px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em;margin-bottom:10px;">${item.headline}</div>
        <div style="font-size:15px;color:#374151;line-height:1.6;margin-bottom:14px;">${item.summary}</div>
        ${wimHtml}
        ${implHtml}
        ${watchHtml}
        ${whyShownHtml}
        <div style="font-size:14px;"><a href="${trackedLinkUrl}" style="color:#2563EB;text-decoration:none;font-weight:600;">Read more →</a><span style="font-size:12px;color:#9CA3AF;">&nbsp;&nbsp;${escapeHtml(item.source || "")}</span></div>
      </div>`;
  }

  return {
    renderDigestItemHtml,
  };
}

module.exports = {
  createDigestEmailItemsRuntime,
};
