const { sortDigestItemsByScoreDescending } = require("../../src/digest/runtime/digest-item-ordering-runtime");

const DIGEST_ROUTE_RE = /^\/digest(?:\/(\d{4}-\d{2}-\d{2})\/?)?$/;
const ADMIN_HTML_ROUTES = new Set(["/admin", "/admin.html", "/admin/user", "/admin/sandbox", "/admin/source-registry", "/admin/retrieval-eval"]);
const NO_STORE_STATIC_ROUTES = new Set(["/admin/login", "/admin", "/admin.html", "/admin/user", "/admin/sandbox", "/admin/source-registry", "/admin/retrieval-eval"]);
const SHORT_CACHE_STATIC_ROUTES = new Set(["/", "/index.html", "/signup", "/signup.html"]);
const NO_CACHE_STATIC_ROUTES = new Set(["/index.js"]);
const INDEX_ASSET_VERSION_TOKEN = "__ASSET_VERSION__";

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
  ["/admin/sandbox", "sandbox.html"],
  ["/admin/source-registry", "admin-source-registry.html"],
  ["/admin/retrieval-eval", "admin-retrieval-eval.html"],
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
  ["/settings-ui-sources-runtime.js", "settings-ui-sources-runtime.js"],
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

function buildSitemapXml({ baseUrl, archiveFiles }) {
  const normalizedBaseUrl = normalizePublicBaseUrl(baseUrl);
  const digestEntries = (Array.isArray(archiveFiles) ? archiveFiles : [])
    .map((fileName) => String(fileName || "").replace(/\.json$/i, ""))
    .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
    .map((dateKey) => ({
      loc: `${normalizedBaseUrl}/digest/${dateKey}`,
      lastmod: dateKey,
      changefreq: "daily",
      priority: "0.7",
    }));

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
    ...digestEntries,
  ];

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

function normalizeSnapshotItems(rawItems) {
  return sortDigestItemsByScoreDescending(
    (Array.isArray(rawItems) ? rawItems : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        ...item,
        wim: item.wim || item.wim_brief || "",
      }))
  );
}

function resolvePersonalizedDigestSnapshot({
  dateKey,
  refToken,
  runId,
  findUserByToken,
  loadLatestDigestSnapshot,
  loadDigestSnapshotByRunId,
}) {
  const token = String(refToken || "").trim();
  if (!token || typeof findUserByToken !== "function") return null;

  const user = findUserByToken(token);
  const userId = String(user?.chatId || "").trim();
  if (!userId) return null;

  let snapshot = null;
  if (runId && typeof loadDigestSnapshotByRunId === "function") {
    snapshot = loadDigestSnapshotByRunId(userId, dateKey, runId);
  }
  if (!snapshot && typeof loadLatestDigestSnapshot === "function") {
    snapshot = loadLatestDigestSnapshot(userId, dateKey);
  }
  if (!snapshot) return null;

  return {
    dateLabel: String(snapshot.date_str || "").trim() || dateKey,
    quickScan: String(snapshot.quick_scan || "").trim(),
    items: normalizeSnapshotItems(snapshot.items),
  };
}

function resolveDigestDateKey(pathname, archiveFiles) {
  const match = pathname.match(DIGEST_ROUTE_RE);
  if (!match) return null;
  const explicit = match[1];
  if (explicit) return explicit;
  if (archiveFiles.length > 0) return String(archiveFiles[0] || "").replace(".json", "");
  return null;
}

function serveDigestPage(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    path, fs, APP_ROOT, archiveDir, readArchiveFiles, renderPublicDigestMissingPage,
    formatPublicDigestDateLabel, renderPublicDigestPage,
    findUserByToken, loadLatestDigestSnapshot, loadDigestSnapshotByRunId,
  } = deps;

  if (req.method !== "GET" || !DIGEST_ROUTE_RE.test(pathname)) return false;

  const resolvedArchiveDir = archiveDir ? path.resolve(String(archiveDir)) : path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(resolvedArchiveDir);
  const dateKey = resolveDigestDateKey(pathname, files);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  const archivePath = path.join(resolvedArchiveDir, `${dateKey}.json`);
  const refToken = url.searchParams.get("ref") || "";
  const runId = url.searchParams.get("run") || "";
  const personalizedSnapshot = resolvePersonalizedDigestSnapshot({
    dateKey,
    refToken,
    runId,
    findUserByToken,
    loadLatestDigestSnapshot,
    loadDigestSnapshotByRunId,
  });

  if (personalizedSnapshot) {
    const html = renderPublicDigestPage({
      dateKey,
      dateLabel: personalizedSnapshot.dateLabel || formatPublicDigestDateLabel(dateKey),
      quickScan: personalizedSnapshot.quickScan,
      items: personalizedSnapshot.items,
      refToken,
      isPersonalized: true,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    });
    return res.end(html);
  }

  if (!fs.existsSync(archivePath)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    const dateLabel = String(parsed?.dateStr || "").trim() || formatPublicDigestDateLabel(dateKey);
    const html = renderPublicDigestPage({
      dateKey,
      dateLabel,
      quickScan: parsed?.quickScan || "",
      items: sortDigestItemsByScoreDescending(Array.isArray(parsed?.items) ? parsed.items : []),
      refToken,
      isPersonalized: false,
    });
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
    return res.end(html);
  } catch {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderPublicDigestMissingPage(dateKey));
  }
}

function serveSitemap(ctx, deps) {
  const { req, res, pathname } = ctx;
  const {
    path, APP_ROOT, archiveDir, readArchiveFiles, getBaseUrl,
  } = deps;
  if (req.method !== "GET" || pathname !== "/sitemap.xml") return false;

  const resolvedArchiveDir = archiveDir ? path.resolve(String(archiveDir)) : path.join(APP_ROOT, "archive");
  const xml = buildSitemapXml({
    baseUrl: typeof getBaseUrl === "function" ? getBaseUrl() : "https://getsignalbrief.com",
    archiveFiles: readArchiveFiles(resolvedArchiveDir),
  });
  res.writeHead(200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
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
    headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=86400";
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
