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
      return `<span style="display:inline-block;font-size:12px;font-weight:700;color:#fff;background:${color.solid};padding:3px 9px;border-radius:5px;letter-spacing:0.02em;line-height:1.4;">${score.toFixed(1)}</span>`;
    })() : "";

    const isDeep = depth === "headline_plus_why" || depth === "full" || depth === "deep";

    // WIM (already contains <strong> markup from enrichment) merged with summary
    const bodyHtml = (() => {
      const wim = item.wim || "";
      const summary = item.summary || "";
      return (wim || summary)
        ? `<div style="font-size:15px;color:#111827;line-height:1.65;margin-bottom:12px;">${wim}${summary ? " " + summary : ""}</div>`
        : "";
    })();

    const implHtml = (isDeep && item.implications)
      ? `<div style="font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:8px;font-style:italic;">${item.implications}</div>`
      : "";
    const watchHtml = (isDeep && item.watch_next)
      ? `<div style="font-size:12px;color:#9CA3AF;line-height:1.6;margin-bottom:8px;font-style:italic;">👀 ${item.watch_next}</div>`
      : "";
    const whyShownHtml = Array.isArray(item.why_shown) && item.why_shown.length
      ? `<div style="font-size:11px;color:#6B7280;line-height:1.5;margin-bottom:10px;">Why shown: ${item.why_shown.map((key) => String(key).replace(/_/g, " ")).join(" · ")}</div>`
      : "";

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
        <a href="${trackedLinkUrl}" style="text-decoration:none;color:inherit;">
          <div style="font-size:20px;font-weight:700;color:#111827;line-height:1.3;letter-spacing:-0.01em;margin-bottom:12px;font-family:'Playfair Display',Georgia,serif;">${item.headline}</div>
        </a>
        ${bodyHtml}
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
