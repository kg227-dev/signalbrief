const DIGEST_ROUTE_RE = /^\/digest(?:\/(\d{4}-\d{2}-\d{2})\/?)?$/;
const ADMIN_HTML_ROUTES = new Set(["/admin", "/admin.html", "/admin/user", "/admin/sandbox"]);

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
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap.xml"],
  ["/style.css", "style.css"],
  ["/preferences-shared.js", "preferences-shared.js"],
  ["/index.js", "index.js"],
  ["/settings.js", "settings.js"],
]);

function writeMissingDigest(res, dateKey, renderPublicDigestMissingPage) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  return res.end(renderPublicDigestMissingPage(dateKey));
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
    path, fs, APP_ROOT, readArchiveFiles, renderPublicDigestMissingPage,
    formatPublicDigestDateLabel, renderPublicDigestPage,
  } = deps;

  if (req.method !== "GET" || !DIGEST_ROUTE_RE.test(pathname)) return false;

  const archiveDir = path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(archiveDir);
  const dateKey = resolveDigestDateKey(pathname, files);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  const archivePath = path.join(archiveDir, `${dateKey}.json`);
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
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      refToken: url.searchParams.get("ref") || "",
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

function enforceAdminHtmlAuth(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const { isAdminAuthed } = deps;
  if (!ADMIN_HTML_ROUTES.has(pathname) || isAdminAuthed(req)) return false;
  const next = encodeURIComponent(pathname + (url.search || ""));
  res.writeHead(302, { Location: `/admin/login?next=${next}`, "Cache-Control": "no-store" });
  return res.end();
}

function serveStaticFile(res, pathname, deps) {
  const { path, serveFile, WEB_DIR } = deps;
  const fileName = STATIC_ROUTE_FILES.get(pathname);
  if (!fileName) return false;
  return serveFile(res, path.join(WEB_DIR, fileName));
}

function createPublicStaticRouteHandler(deps) {
  const localDeps = { ...deps };
  return function handlePublicStaticRoutes(ctx) {
    const { pathname, res } = ctx;

    const digestHandled = serveDigestPage(ctx, localDeps);
    if (digestHandled !== false) return digestHandled;

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
