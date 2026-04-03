const DIGEST_ROUTE_RE = /^\/digest(?:\/(\d{4}-\d{2}-\d{2})\/?)?$/;
const ADMIN_HTML_ROUTES = new Set(["/admin", "/admin.html", "/admin/user", "/admin/source-registry"]);
const NO_STORE_STATIC_ROUTES = new Set(["/admin/login", "/admin", "/admin.html", "/admin/user", "/admin/source-registry"]);
const SHORT_CACHE_STATIC_ROUTES = new Set(["/", "/index.html", "/signup", "/signup.html"]);
const NO_CACHE_STATIC_ROUTES = new Set(["/index.js"]);
const INDEX_ASSET_VERSION_TOKEN = "__ASSET_VERSION__";
const PUBLIC_DIGEST_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";
const PUBLIC_DIGEST_ITEM_LIMIT = 5;

const STATIC_ROUTE_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/settings", "settings.html"],
  ["/settings.html", "settings.html"],
  ["/archive", "archive.html"],
  ["/archive.html", "archive.html"],
  ["/admin/login", "admin-login.html"],
  ["/admin", "admin.html"],
  ["/admin.html", "admin.html"],
  ["/admin/user", "admin-user.html"],
  ["/admin/source-registry", "admin-source-registry.html"],
  ["/robots.txt", "robots.txt"],
  ["/style.css", "style.css"],
  ["/preferences-topic-runtime.js", "preferences-topic-runtime.js"],
  ["/preferences-schedule-runtime.js", "preferences-schedule-runtime.js"],
  ["/preferences-state-core-runtime.js", "preferences-state-core-runtime.js"],
  ["/preferences-state-model-runtime.js", "preferences-state-model-runtime.js"],
  ["/preferences-runtime.js", "preferences-runtime.js"],
  ["/preferences-state-runtime.js", "preferences-state-runtime.js"],
  ["/preferences-shared.js", "preferences-shared.js"],
  ["/settings-ui-topic-actions-runtime.js", "settings-ui-topic-actions-runtime.js"],
  ["/settings-ui-topic-runtime.js", "settings-ui-topic-runtime.js"],
  ["/settings-ui-preferences-actions-runtime.js", "settings-ui-preferences-actions-runtime.js"],
  ["/settings-ui-preferences-runtime.js", "settings-ui-preferences-runtime.js"],
  ["/settings-ui-runtime.js", "settings-ui-runtime.js"],
  ["/settings-runtime.js", "settings-runtime.js"],
  ["/index-helpers-runtime.js", "index-helpers-runtime.js"],
  ["/index-form-submit-runtime.js", "index-form-submit-runtime.js"],
  ["/index-form-context-runtime.js", "index-form-context-runtime.js"],
  ["/index-form-runtime.js", "index-form-runtime.js"],
  ["/index.js", "index.js"],
  ["/settings.js", "settings.js"],
  ["/signup", "signup.html"],
  ["/signup.html", "signup.html"],
  ["/signup-flow.js", "signup-flow.js"],
]);

function writeMissingDigest(res, dateKey, renderPublicDigestMissingPage) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  return res.end(renderPublicDigestMissingPage(dateKey));
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizePublicBaseUrl(rawBaseUrl) {
  try {
    const parsed = new URL(String(rawBaseUrl || "https://getsignalbrief.com"));
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "https://getsignalbrief.com";
  }
}

function buildSitemapXml({ baseUrl, digestEntries = [] }) {
  const normalizedBaseUrl = normalizePublicBaseUrl(baseUrl);
  const entries = [
    {
      loc: `${normalizedBaseUrl}/`,
      changefreq: "daily",
      priority: "1.0",
    },
    {
      loc: `${normalizedBaseUrl}/signup`,
      changefreq: "weekly",
      priority: "0.8",
    },
  ];
  entries.push(...(Array.isArray(digestEntries) ? digestEntries : []));

  const urlRows = entries.map((entry) => {
    const parts = [
      `    <loc>${escapeXml(entry.loc)}</loc>`,
      entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : "",
      entry.changefreq ? `    <changefreq>${escapeXml(entry.changefreq)}</changefreq>` : "",
      entry.priority ? `    <priority>${escapeXml(entry.priority)}</priority>` : "",
    ].filter(Boolean);
    return `  <url>\n${parts.join("\n")}\n  </url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urlRows}\n` +
    `</urlset>\n`;
}

function resolveDigestDateKey(pathname) {
  const match = pathname.match(DIGEST_ROUTE_RE);
  if (!match) return null;
  const explicit = match[1];
  if (explicit) return explicit;
  return null;
}

function buildArchiveRedirectUrl(dateKey, refToken) {
  const params = new URLSearchParams();
  params.set("token", String(refToken || "").trim());
  params.set("date", String(dateKey || "").trim());
  return `/archive?${params.toString()}`;
}

function buildAdminDigestAuditRedirectUrl(dateKey) {
  return `/admin?digest_audit_date=${encodeURIComponent(String(dateKey || "").trim())}#digestAuditSection`;
}

function readOptionalNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readPublicDigestScore(item) {
  const relevanceScore = readOptionalNumber(item?.relevanceScore);
  if (Number.isFinite(relevanceScore)) return { tier: 4, score: relevanceScore };

  const legacyRelevanceScore = readOptionalNumber(item?.relevance_score);
  if (Number.isFinite(legacyRelevanceScore)) return { tier: 4, score: legacyRelevanceScore };

  const adjustedScore = readOptionalNumber(item?.score_breakdown?.adjusted_score);
  if (Number.isFinite(adjustedScore)) return { tier: 3, score: adjustedScore * 10 };

  const strategicValue = readOptionalNumber(item?.strategic_value);
  if (Number.isFinite(strategicValue)) return { tier: 2, score: strategicValue * 10 };

  const baseScore = readOptionalNumber(item?.baseScore);
  if (Number.isFinite(baseScore)) return { tier: 1, score: baseScore };

  return { tier: 0, score: 0 };
}

function selectPublicDigestItems(items) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (rows.length <= PUBLIC_DIGEST_ITEM_LIMIT) return rows.slice();

  return rows
    .map((item, index) => ({
      item,
      index,
      ranking: readPublicDigestScore(item),
    }))
    .sort((left, right) => {
      if (left.ranking.tier !== right.ranking.tier) return right.ranking.tier - left.ranking.tier;
      if (left.ranking.score !== right.ranking.score) return right.ranking.score - left.ranking.score;
      return left.index - right.index;
    })
    .slice(0, PUBLIC_DIGEST_ITEM_LIMIT)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);
}

function buildPublicDigestQuickScan(items, fallbackQuickScan) {
  const digestItems = Array.isArray(items) ? items : [];
  if (digestItems.length > 0) {
    return digestItems
      .map((item) => String(item?.headline || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" · ");
  }
  return String(fallbackQuickScan || "");
}

function readPublicDigestPayload({ fs, archivePath, dateKey, formatPublicDigestDateLabel }) {
  try {
    const parsed = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    const selectedItems = selectPublicDigestItems(parsed?.items);
    return {
      dateKey,
      dateLabel: String(
        parsed?.dateStr
        || parsed?.date_str
        || parsed?.dateLabel
        || formatPublicDigestDateLabel(dateKey)
        || dateKey
      ),
      quickScan: buildPublicDigestQuickScan(selectedItems, parsed?.quickScan || parsed?.quick_scan || ""),
      items: selectedItems,
    };
  } catch {
    return null;
  }
}

function buildPublicDigestSitemapEntries({ fs, path, APP_ROOT, archiveDir, readArchiveFiles, baseUrl }) {
  const normalizedBaseUrl = normalizePublicBaseUrl(baseUrl);
  const resolvedArchiveDir = archiveDir ? path.resolve(String(archiveDir)) : path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(resolvedArchiveDir);
  if (!Array.isArray(files) || files.length === 0) return [];

  return files
    .map((fileName) => String(fileName || "").trim())
    .filter((fileName) => /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName))
    .map((fileName) => {
      const dateKey = fileName.replace(".json", "");
      const archivePath = path.join(resolvedArchiveDir, fileName);
      if (!fs.existsSync(archivePath)) return null;
      return {
        loc: `${normalizedBaseUrl}/digest/${dateKey}`,
        changefreq: "weekly",
        priority: "0.7",
      };
    })
    .filter(Boolean);
}

function serveDigestPage(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    path,
    fs,
    APP_ROOT,
    archiveDir,
    readArchiveFiles,
    renderPublicDigestMissingPage,
    renderPublicDigestPage,
    formatPublicDigestDateLabel,
    isAdminAuthed,
  } = deps;

  if (req.method !== "GET" || !DIGEST_ROUTE_RE.test(pathname)) return false;

  const resolvedArchiveDir = archiveDir ? path.resolve(String(archiveDir)) : path.join(APP_ROOT, "archive");
  const dateKey = resolveDigestDateKey(pathname);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  const archivePath = path.join(resolvedArchiveDir, `${dateKey}.json`);
  const refToken = url.searchParams.get("ref") || "";
  if (refToken) {
    res.writeHead(302, {
      Location: buildArchiveRedirectUrl(dateKey, refToken),
      "Cache-Control": "private, no-store",
    });
    return res.end();
  }

  if (typeof isAdminAuthed === "function" && isAdminAuthed(req)) {
    res.writeHead(302, {
      Location: buildAdminDigestAuditRedirectUrl(dateKey),
      "Cache-Control": "private, no-store",
    });
    return res.end();
  }

  if (!fs.existsSync(archivePath)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  const digest = readPublicDigestPayload({
    fs,
    archivePath,
    dateKey,
    formatPublicDigestDateLabel,
  });
  if (!digest) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": PUBLIC_DIGEST_CACHE_CONTROL,
  });
  return res.end(renderPublicDigestPage(digest));
}

function serveSitemap(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    fs,
    path,
    APP_ROOT,
    archiveDir,
    readArchiveFiles,
    getBaseUrl,
  } = deps;
  if (req.method !== "GET" || pathname !== "/sitemap.xml") return false;

  const xml = buildSitemapXml({
    baseUrl: typeof getBaseUrl === "function" ? getBaseUrl() : "https://getsignalbrief.com",
    digestEntries: buildPublicDigestSitemapEntries({
      fs,
      path,
      APP_ROOT,
      archiveDir,
      readArchiveFiles,
      baseUrl: typeof getBaseUrl === "function" ? getBaseUrl() : "https://getsignalbrief.com",
    }),
  });
  res.writeHead(200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": PUBLIC_DIGEST_CACHE_CONTROL,
  });
  return res.end(xml);
}

function enforceAdminHtmlAuth(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const { isAdminAuthed } = deps;
  if (!ADMIN_HTML_ROUTES.has(pathname) || isAdminAuthed(req)) return false;
  const next = encodeURIComponent(pathname + (url.search || ""));
  res.writeHead(302, { Location: `/admin/login?next=${next}`, "Cache-Control": "no-store" });
  return res.end();
}

function serveStaticFile(res, pathname, deps) {
  const { path, fs, serveFile, WEB_DIR, assetVersion } = deps;
  const fileName = STATIC_ROUTE_FILES.get(pathname);
  if (!fileName) return false;
  const headers = {};
  if (NO_STORE_STATIC_ROUTES.has(pathname)) {
    headers["Cache-Control"] = "no-store";
  } else if (SHORT_CACHE_STATIC_ROUTES.has(pathname)) {
    headers["Cache-Control"] = PUBLIC_DIGEST_CACHE_CONTROL;
  } else if (NO_CACHE_STATIC_ROUTES.has(pathname)) {
    headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate";
  }
  if (fileName === "index.html" || fileName === "settings.html" || fileName === "signup.html") {
    const indexPath = path.join(WEB_DIR, fileName);
    try {
      const html = fs.readFileSync(indexPath, "utf8");
      const version = String(assetVersion || "dev");
      const rendered = html.includes(INDEX_ASSET_VERSION_TOKEN)
        ? html.split(INDEX_ASSET_VERSION_TOKEN).join(version)
        : html;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        ...headers,
      });
      res.end(rendered);
      return true;
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return true;
    }
  }
  const hasHeaders = Object.keys(headers).length > 0;
  return serveFile(res, path.join(WEB_DIR, fileName), hasHeaders ? headers : null);
}

function createPublicStaticRouteHandler(deps) {
  const localDeps = { ...deps };
  return function handlePublicStaticRoutes(ctx) {
    const { pathname, res } = ctx;

    const digestHandled = serveDigestPage(ctx, localDeps);
    if (digestHandled !== false) return digestHandled;

    const sitemapHandled = serveSitemap(ctx, localDeps);
    if (sitemapHandled !== false) return sitemapHandled;

    const adminRedirected = enforceAdminHtmlAuth(ctx, localDeps);
    if (adminRedirected !== false) return adminRedirected;

    return serveStaticFile(res, pathname, localDeps);
  };
}

function handlePublicStaticRoutes(ctx, deps) {
  const routeHandler = createPublicStaticRouteHandler(deps);
  return routeHandler(ctx);
}

module.exports = {
  createPublicStaticRouteHandler,
  handlePublicStaticRoutes,
};
