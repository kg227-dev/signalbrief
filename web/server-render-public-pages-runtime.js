function createRenderPublicPages(deps) {
  const {
    normalizeReferralToken,
    escapeHtml,
    sanitizePublicUrl,
    stripHtml,
    formatPublicDigestDateLabel,
  } = deps;

  function truncateText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function escapeJsonString(value) {
    return JSON.stringify(String(value || ""));
  }

  function normalizeBaseUrl(rawBaseUrl) {
    try {
      const parsed = new URL(String(rawBaseUrl || "http://localhost:3003"));
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      return "http://localhost:3003";
    }
  }

  function normalizeQuickScan(rawQuickScan) {
    return String(rawQuickScan || "")
      .replace(/&amp;nbsp;/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/&#xA0;/gi, " ")
      .replace(/&amp;middot;/gi, "·")
      .replace(/&middot;/gi, "·")
      .replace(/&#183;/gi, "·")
      .replace(/&#xB7;/gi, "·")
      .replace(/\u00a0/g, " ")
      .replace(/\s*·\s*/g, " · ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractQuickScanPoints(normalizedQuickScan) {
    const text = String(normalizedQuickScan || "").trim();
    if (!text) return [];

    const points = text
      .split(/\s+·\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (points.length > 1) return points.slice(0, 8);

    // Fallback for older rows that used sentence-style delimiters instead of middot separators.
    const sentencePoints = text
      .split(/\s+\.\s+(?=[A-Z0-9#])/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (sentencePoints.length > 1) return sentencePoints.slice(0, 8);

    return [text];
  }

  function readItemScore(item) {
    const directScore = Number(item?.relevanceScore);
    if (Number.isFinite(directScore)) return directScore;
    const legacyScore = Number(item?.relevance_score);
    if (Number.isFinite(legacyScore)) return legacyScore;
    return null;
  }

  function scoreTone(score) {
    if (score >= 8.0) {
      return { dot: "#10B981", text: "#065F46", bg: "#ECFDF5", glow: "0 0 6px rgba(16,185,129,0.35)" };
    }
    if (score >= 6.0) {
      return { dot: "#34D399", text: "#065F46", bg: "#ECFDF5", glow: "0 0 6px rgba(52,211,153,0.3)" };
    }
    if (score >= 4.0) {
      return { dot: "#F59E0B", text: "#92400E", bg: "#FFFBEB", glow: "0 0 5px rgba(245,158,11,0.24)" };
    }
    return { dot: "#EF4444", text: "#991B1B", bg: "#FEF2F2", glow: "0 0 5px rgba(239,68,68,0.24)" };
  }

  function renderScorePill(score, className = "score-pill") {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return "";
    const tone = scoreTone(numericScore);
    return `<span class="${className}" style="--score-dot:${tone.dot};--score-text:${tone.text};--score-bg:${tone.bg};--score-glow:${tone.glow};">
      <span class="score-dot" aria-hidden="true"></span>
      <span>${numericScore.toFixed(1)}</span>
    </span>`;
  }

  const FLAG_LABELS = {
    earnings: "Earnings", guidance: "Guidance", m_and_a: "Deal",
    regulatory: "Regulatory", leadership: "Leadership", ipo: "IPO",
  };

  function renderSourceBadge(tier) {
    if (tier === "premium") return `<span class="src-badge src-badge--premium">Primary</span>`;
    if (tier === "strong") return `<span class="src-badge src-badge--strong">Verified</span>`;
    if (tier === "corporate") return `<span class="src-badge src-badge--corp">Press release</span>`;
    if (tier === "weak" || tier === "suspect") return `<span class="src-badge src-badge--weak">Use caution</span>`;
    return "";
  }

  function renderCorroborationNote(crossSourceCount, supportingSources) {
    const n = Number(crossSourceCount) || 0;
    if (n < 2) return "";
    const extra = n - 1;
    const title = (Array.isArray(supportingSources) ? supportingSources : []).join(", ");
    return `<span class="corr-note"${title ? ` title="${escapeHtml(title)}"` : ""}>+${extra} source${extra > 1 ? "s" : ""}</span>`;
  }

  function renderContentFlags(flags) {
    const known = (Array.isArray(flags) ? flags : []).filter((f) => FLAG_LABELS[f]);
    if (!known.length) return "";
    return `<span class="content-flags">${known.map((f) => `<span class="flag-chip">${FLAG_LABELS[f]}</span>`).join("")}</span>`;
  }

  function renderFreshnessLabel(publishedDate, digestDateKey) {
    if (!publishedDate) return "";
    const pub = new Date(String(publishedDate));
    if (isNaN(pub.getTime())) return "";
    const digest = new Date(`${digestDateKey}T12:00:00Z`);
    const diffDays = Math.round((digest.getTime() - pub.getTime()) / 86400000);
    if (diffDays <= 0) return `<span class="freshness-label">Today</span>`;
    if (diffDays === 1) return `<span class="freshness-label">Yesterday</span>`;
    if (diffDays <= 3) return `<span class="freshness-label">${diffDays}d ago</span>`;
    return `<span class="freshness-label freshness-label--stale">${diffDays}d ago</span>`;
  }

  function buildWhyShownText(item) {
    if (Array.isArray(item.why_shown) && item.why_shown.length) {
      return item.why_shown.map((k) => String(k).replace(/_/g, " ")).join(" · ");
    }
    const entities = (Array.isArray(item.entity_keys) ? item.entity_keys : [])
      .slice(0, 2)
      .map((k) => String(k).split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    if (entities.length) return `${item.tag || "Signal"} · ${entities.join(", ")}`;
    return item.tag || "";
  }

  function normalizeHeadlineLookup(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&amp;/g, "and")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderPublicDigestPage({
    dateKey,
    dateLabel,
    quickScan,
    items,
    refToken = "",
    baseUrl = "http://localhost:3003",
    isPersonalized = false,
  }) {
    const referralToken = normalizeReferralToken(refToken);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const canonicalUrl = `${normalizedBaseUrl}/digest/${dateKey}`;
    const shareUrl = canonicalUrl;
    const signupUrl = referralToken
      ? `${normalizedBaseUrl}/?ref=${encodeURIComponent(referralToken)}`
      : `${normalizedBaseUrl}/`;
    const rawDateLabel = String(dateLabel || formatPublicDigestDateLabel(dateKey) || "");
    const safeDateLabel = escapeHtml(rawDateLabel);
    const safeItems = Array.isArray(items) ? items : [];
    const scoreByHeadline = new Map();
    safeItems.forEach((item) => {
      const headlineKey = normalizeHeadlineLookup(item?.headline);
      const score = readItemScore(item);
      if (!headlineKey || !Number.isFinite(score) || scoreByHeadline.has(headlineKey)) return;
      scoreByHeadline.set(headlineKey, score);
    });
    const quickScanPoints = extractQuickScanPoints(normalizeQuickScan(quickScan));
    const digestDescription = truncateText(
      quickScanPoints.length > 0
        ? `${rawDateLabel}: ${quickScanPoints.join(" · ")}`
        : `SignalBrief public digest for ${rawDateLabel}.`,
      155
    );
    const safeDigestDescription = escapeHtml(digestDescription);
    const robotsContent = isPersonalized
      ? "noindex,nofollow,noarchive"
      : "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1";
    const quickScanHtml = quickScanPoints
      .map((point) => {
        const pointScore = scoreByHeadline.get(normalizeHeadlineLookup(point));
        return `<li class="scan-pill">
          <span class="scan-pill-text">${escapeHtml(point)}</span>
          ${renderScorePill(pointScore, "score-pill score-pill-compact")}
        </li>`;
      })
      .join("");
    const safeRefToken = escapeHtml(String(refToken || ""));
    const cards = safeItems.map((item, idx) => {
      const tag = escapeHtml(item?.tag || "Signal");
      const headline = escapeHtml(item?.headline || "Untitled item");
      const summary = escapeHtml(item?.summary || "");
      const wim = escapeHtml(stripHtml(item?.wim || ""));
      const source = escapeHtml(item?.source || "source");
      const href = sanitizePublicUrl(item?.url);
      const scoreHtml = renderScorePill(readItemScore(item));
      const sourceBadge = renderSourceBadge(item?.source_tier);
      const corrNote = renderCorroborationNote(item?.cross_source_count, item?.supporting_sources);
      const flagsHtml = renderContentFlags(item?.content_flags);
      const freshnessHtml = isPersonalized ? renderFreshnessLabel(item?.published_date, dateKey) : "";
      const whyShownText = isPersonalized ? escapeHtml(buildWhyShownText(item)) : "";
      const sourceLink = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Read more → ${source}</a>`
        : `<span>${source}</span>`;
      const feedbackRow = isPersonalized && safeRefToken
        ? `<div class="feedback-row" data-item="${idx}" data-digest="${escapeHtml(dateKey)}" data-token="${safeRefToken}">
          <button class="fb-btn fb-btn--pos" data-type="positive" title="More like this">+ More</button>
          <button class="fb-btn fb-btn--neg" data-type="negative" title="Less like this">− Less</button>
          <button class="fb-btn fb-btn--more">···</button>
          <div class="fb-more-menu" hidden>
            <button class="fb-menu-item" data-type="repetitive">Too repetitive</button>
            <button class="fb-menu-item" data-type="weak_source">Weak source</button>
            <button class="fb-menu-item" data-type="not_relevant">Not relevant</button>
          </div>
          <span class="fb-sent" hidden>Noted</span>
        </div>`
        : "";
      return `
      <article class="item-card">
        <div class="item-meta">
          <div class="item-meta-left">
            <span class="item-index">${idx + 1}</span>
            <span class="item-tag">${tag}</span>
            ${flagsHtml}
          </div>
          ${scoreHtml}
        </div>
        <h2>${headline}</h2>
        ${summary ? `<p class="item-summary">${summary}</p>` : ""}
        ${wim ? `<p class="item-wim">${wim}</p>` : ""}
        <div class="item-link">
          ${freshnessHtml}${sourceLink}${sourceBadge ? ` ${sourceBadge}` : ""}${corrNote ? ` ${corrNote}` : ""}
        </div>
        ${feedbackRow}
      </article>
    `;
    }).join("");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SignalBrief - ${safeDateLabel}</title>
  <meta name="description" content="${safeDigestDescription}">
  <meta name="robots" content="${robotsContent}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="SignalBrief">
  <meta property="og:title" content="SignalBrief - ${safeDateLabel}">
  <meta property="og:description" content="${safeDigestDescription}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="SignalBrief - ${safeDateLabel}">
  <meta name="twitter:description" content="${safeDigestDescription}">
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "name": ${escapeJsonString(`SignalBrief - ${safeDateLabel}`)},
      "description": ${escapeJsonString(digestDescription)},
      "url": ${escapeJsonString(canonicalUrl)},
      "isPartOf": {
        "@type": "WebSite",
        "name": "SignalBrief",
        "url": ${escapeJsonString(normalizedBaseUrl)}
      }
    }
  </script>
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
    .scan { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 14px; padding: 12px 14px; margin-top: 14px; }
    .scan-heading { margin: 0 0 9px; color: #1e3a8a; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; }
    .scan-list { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
    .scan-pill { color: #1e3a8a; background: #fff; border: 1px solid #c7d2fe; border-radius: 999px; padding: 6px 10px; font-size: 13px; line-height: 1.35; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; }
    .scan-pill-text { min-width: 0; }
    .item-list { display: grid; gap: 14px; }
    .item-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 18px 16px; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04); }
    .item-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .item-meta-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
    .item-index { font-size: 12px; color: #64748b; font-weight: 700; }
    .item-tag { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; background: var(--tag-bg); color: var(--tag-ink); border-radius: 999px; padding: 4px 8px; }
    .score-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--score-bg); color: var(--score-text); font-size: 12px; font-weight: 700; line-height: 1; white-space: nowrap; flex-shrink: 0; }
    .score-pill-compact { padding: 4px 8px; font-size: 11px; }
    .score-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--score-dot); box-shadow: var(--score-glow); flex-shrink: 0; }
    h2 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; letter-spacing: -0.01em; }
    .item-summary { margin: 0 0 8px; color: #334155; line-height: 1.6; font-size: 15px; }
    .item-wim { margin: 0 0 10px; color: #0f172a; line-height: 1.6; font-size: 14px; font-family: Georgia, 'Times New Roman', serif; font-weight: 700; }
    .item-link { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .item-link a { color: #2563eb; text-decoration: none; font-weight: 600; font-size: 14px; }
    .item-link span { color: #64748b; font-size: 14px; }
    .src-badge { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; letter-spacing: 0.04em; white-space: nowrap; }
    .src-badge--premium { background: #dbeafe; color: #1d4ed8; }
    .src-badge--strong { background: #dcfce7; color: #15803d; }
    .src-badge--corp { background: #fef3c7; color: #92400e; }
    .src-badge--weak { background: #fee2e2; color: #b91c1c; }
    .corr-note { font-size: 11px; color: #64748b; font-weight: 600; white-space: nowrap; cursor: default; }
    .content-flags { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .flag-chip { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; }
    .freshness-label { font-size: 12px; color: #64748b; font-weight: 500; }
    .freshness-label--stale { color: #d97706; }
    .why-shown { margin: 8px 0 0; font-size: 12px; color: #64748b; line-height: 1.5; }
    .feedback-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); position: relative; }
    .fb-btn { background: none; border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--muted); font-family: inherit; }
    .fb-btn:hover { background: #f1f5f9; }
    .fb-more-menu { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; margin-top: 2px; }
    .fb-menu-item { background: none; border: none; padding: 0; font-size: 12px; color: var(--muted); cursor: pointer; text-decoration: underline; font-family: inherit; }
    .fb-sent { font-size: 12px; color: #15803d; font-weight: 600; }
    .footer { margin-top: 18px; text-align: center; color: #64748b; font-size: 13px; }
    @media (max-width: 640px) {
      h1 { font-size: 28px; }
      .hero { padding: 18px; }
      .item-card { padding: 16px; }
      .scan-list { gap: 6px; }
      .scan-pill { width: 100%; border-radius: 10px; justify-content: space-between; }
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
      ${quickScanHtml ? `<div class="scan"><p class="scan-heading">Quick scan</p><ul class="scan-list">${quickScanHtml}</ul></div>` : ""}
    </section>
    <section class="item-list">
      ${cards || `<div class="item-card"><p class="item-summary">No items available for this date.</p></div>`}
    </section>
    <p class="footer">Built with SignalBrief · <a href="https://getsignalbrief.com" target="_blank" rel="noopener">getsignalbrief.com</a></p>
  </main>
${isPersonalized ? `<script>
(function() {
  function sendFeedback(digestId, token, itemIndex, type) {
    if (!token) return;
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, digest_id: digestId, item_index: Number(itemIndex), feedback_type: type }),
    }).catch(function() {});
  }
  document.querySelectorAll(".feedback-row").forEach(function(row) {
    var idx = row.dataset.item;
    var did = row.dataset.digest;
    var tok = row.dataset.token;
    function markSent() {
      row.querySelectorAll(".fb-btn, .fb-more-menu").forEach(function(el) { el.hidden = true; });
      var sent = row.querySelector(".fb-sent");
      if (sent) sent.hidden = false;
    }
    row.querySelectorAll(".fb-btn--pos, .fb-btn--neg").forEach(function(btn) {
      btn.addEventListener("click", function() {
        sendFeedback(did, tok, idx, btn.dataset.type);
        markSent();
      });
    });
    var moreBtn = row.querySelector(".fb-btn--more");
    if (moreBtn) {
      moreBtn.addEventListener("click", function() {
        var menu = row.querySelector(".fb-more-menu");
        if (menu) menu.hidden = !menu.hidden;
      });
    }
    row.querySelectorAll(".fb-menu-item").forEach(function(btn) {
      btn.addEventListener("click", function() {
        sendFeedback(did, tok, idx, btn.dataset.type);
        markSent();
      });
    });
  });
})();
</script>` : ""}
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
  <meta name="robots" content="noindex,nofollow,noarchive">
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
