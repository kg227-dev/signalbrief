const { sortDigestItemsByScoreDescending } = require("../../src/digest/runtime/digest-item-ordering-runtime");

const DIGEST_ROUTE_RE = /^\/digest(?:\/(\d{4}-\d{2}-\d{2})\/?)?$/;
const ADMIN_HTML_ROUTES = new Set(["/admin", "/admin.html", "/admin/user", "/admin/sandbox"]);
const NO_STORE_STATIC_ROUTES = new Set(["/admin/login", "/admin", "/admin.html", "/admin/user", "/admin/sandbox"]);
const NO_CACHE_STATIC_ROUTES = new Set(["/", "/index.html", "/index.js", "/signup", "/signup.html"]);
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
  ["/robots.txt", "robots.txt"],
  ["/sitemap.xml", "sitemap.xml"],
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
    path, fs, APP_ROOT, readArchiveFiles, renderPublicDigestMissingPage,
    formatPublicDigestDateLabel, renderPublicDigestPage,
    findUserByToken, loadLatestDigestSnapshot, loadDigestSnapshotByRunId,
  } = deps;

  if (req.method !== "GET" || !DIGEST_ROUTE_RE.test(pathname)) return false;

  const archiveDir = path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(archiveDir);
  const dateKey = resolveDigestDateKey(pathname, files);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  const archivePath = path.join(archiveDir, `${dateKey}.json`);
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
  const { path, fs, serveFile, WEB_DIR, assetVersion } = deps;
  const fileName = STATIC_ROUTE_FILES.get(pathname);
  if (!fileName) return false;
  const headers = {};
  if (NO_STORE_STATIC_ROUTES.has(pathname)) {
    headers["Cache-Control"] = "no-store";
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
