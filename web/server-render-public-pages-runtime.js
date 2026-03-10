function createRenderPublicPages(deps) {
  const {
    normalizeReferralToken,
    escapeHtml,
    sanitizePublicUrl,
    stripHtml,
    formatPublicDigestDateLabel,
  } = deps;

  function renderPublicDigestPage({
    dateKey,
    dateLabel,
    quickScan,
    items,
    refToken = "",
    baseUrl = "http://localhost:3003",
  }) {
    const referralToken = normalizeReferralToken(refToken);
    const shareUrl = referralToken
      ? `${baseUrl}/digest/${dateKey}?ref=${encodeURIComponent(referralToken)}`
      : `${baseUrl}/digest/${dateKey}`;
    const signupUrl = referralToken
      ? `${baseUrl}/?ref=${encodeURIComponent(referralToken)}`
      : `${baseUrl}/`;
    const safeDateLabel = escapeHtml(dateLabel || formatPublicDigestDateLabel(dateKey));
    const safeQuickScan = escapeHtml(String(quickScan || ""));
    const safeItems = Array.isArray(items) ? items : [];
    const cards = safeItems.map((item, idx) => {
      const tag = escapeHtml(item?.tag || "Signal");
      const headline = escapeHtml(item?.headline || "Untitled item");
      const summary = escapeHtml(item?.summary || "");
      const wim = escapeHtml(stripHtml(item?.wim || ""));
      const source = escapeHtml(item?.source || "source");
      const href = sanitizePublicUrl(item?.url);
      const sourceLink = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Read more -> ${source}</a>`
        : `<span>${source}</span>`;
      return `
      <article class="item-card">
        <div class="item-meta">
          <span class="item-index">${idx + 1}</span>
          <span class="item-tag">${tag}</span>
        </div>
        <h2>${headline}</h2>
        ${summary ? `<p class="item-summary">${summary}</p>` : ""}
        ${wim ? `<p class="item-wim">${wim}</p>` : ""}
        <div class="item-link">${sourceLink}</div>
      </article>
    `;
    }).join("");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SignalBrief - ${safeDateLabel}</title>
  <meta name="description" content="SignalBrief public digest for ${safeDateLabel}.">
  <style>
    :root {
      --bg: #f7f8fc;
      --ink: #0f172a;
      --muted: #475569;
      --line: #dbe2ea;
      --card: #ffffff;
      --tag-bg: #e8f0ff;
      --tag-ink: #1d4ed8;
      --accent: #0f766e;
      --accent-ink: #ffffff;
      --accent-soft: #dcfce7;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: radial-gradient(circle at top right, #dbeafe 0%, var(--bg) 45%); }
    .wrap { max-width: 820px; margin: 0 auto; padding: 28px 16px 56px; }
    .hero { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 24px; margin-bottom: 18px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05); }
    .kicker { font-size: 11px; letter-spacing: 0.11em; text-transform: uppercase; color: #334155; font-weight: 700; margin-bottom: 8px; }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em; }
    .hero-sub { margin: 10px 0 0; color: var(--muted); line-height: 1.5; font-size: 15px; }
    .hero-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .btn { text-decoration: none; border-radius: 999px; padding: 10px 16px; font-size: 13px; font-weight: 700; display: inline-block; }
    .btn-primary { background: var(--accent); color: var(--accent-ink); }
    .btn-secondary { background: var(--accent-soft); color: #166534; }
    .scan { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 14px; padding: 12px 14px; color: #1e3a8a; font-size: 13px; line-height: 1.6; margin-top: 14px; }
    .item-list { display: grid; gap: 14px; }
    .item-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 18px 16px; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04); }
    .item-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .item-index { font-size: 12px; color: #64748b; font-weight: 700; }
    .item-tag { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; background: var(--tag-bg); color: var(--tag-ink); border-radius: 999px; padding: 4px 8px; }
    h2 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; letter-spacing: -0.01em; }
    .item-summary { margin: 0 0 8px; color: #334155; line-height: 1.6; font-size: 15px; }
    .item-wim { margin: 0 0 10px; color: #0f172a; line-height: 1.6; font-size: 14px; }
    .item-link a { color: #2563eb; text-decoration: none; font-weight: 600; font-size: 14px; }
    .item-link span { color: #64748b; font-size: 14px; }
    .footer { margin-top: 18px; text-align: center; color: #64748b; font-size: 13px; }
    @media (max-width: 640px) {
      h1 { font-size: 28px; }
      .hero { padding: 18px; }
      .item-card { padding: 16px; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="kicker">SignalBrief Public Digest</div>
      <h1>${safeDateLabel}</h1>
      <p class="hero-sub">A shareable briefing from SignalBrief: daily intelligence across AI, strategy, and business.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${escapeHtml(signupUrl)}" target="_blank" rel="noopener">Get your own personalized brief</a>
        <a class="btn btn-secondary" href="mailto:?subject=SignalBrief%20Digest&body=${encodeURIComponent(shareUrl)}">Forward this brief</a>
      </div>
      ${safeQuickScan ? `<div class="scan"><strong>Quick scan:</strong> ${safeQuickScan}</div>` : ""}
    </section>
    <section class="item-list">
      ${cards || `<div class="item-card"><p class="item-summary">No items available for this date.</p></div>`}
    </section>
    <p class="footer">Built with SignalBrief · <a href="https://getsignalbrief.com" target="_blank" rel="noopener">getsignalbrief.com</a></p>
  </main>
</body>
</html>`;
  }

  function renderPublicDigestMissingPage(dateKey) {
    const safeDate = escapeHtml(dateKey || "");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SignalBrief - Digest Not Found</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 520px; background: #fff; border: 1px solid #dbe2ea; border-radius: 14px; padding: 24px; text-align: center; }
    .kicker { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 8px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 16px; color: #475569; line-height: 1.6; }
    a { display: inline-block; text-decoration: none; background: #0f766e; color: #fff; border-radius: 999px; padding: 10px 16px; font-weight: 700; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <div class="kicker">SignalBrief</div>
      <h1>Digest not found</h1>
      <p>We could not find a public digest for ${safeDate || "that date"}.</p>
      <a href="https://getsignalbrief.com" target="_blank" rel="noopener">Get your own personalized brief</a>
    </div>
  </main>
</body>
</html>`;
  }

  return {
    renderPublicDigestPage,
    renderPublicDigestMissingPage,
  };
}

module.exports = {
  createRenderPublicPages,
};
