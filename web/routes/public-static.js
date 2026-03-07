function handlePublicStaticRoutes(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    isAdminAuthed,
    path, fs, APP_ROOT, readArchiveFiles, renderPublicDigestMissingPage,
    formatPublicDigestDateLabel, renderPublicDigestPage, serveFile, WEB_DIR,
  } = deps;
  // GET /digest(/:date) — public shareable digest page
  if (req.method === "GET" && (pathname === "/digest" || /^\/digest\/\d{4}-\d{2}-\d{2}\/?$/.test(pathname))) {
    const archiveDir = path.join(APP_ROOT, "archive");
    const files = readArchiveFiles(archiveDir);
    let dateKey = null;
    const datedMatch = pathname.match(/^\/digest\/(\d{4}-\d{2}-\d{2})\/?$/);
    if (datedMatch) dateKey = datedMatch[1];
    else if (files.length > 0) dateKey = String(files[0] || "").replace(".json", "");

    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPublicDigestMissingPage(dateKey));
    }

    const archivePath = path.join(archiveDir, `${dateKey}.json`);
    if (!fs.existsSync(archivePath)) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPublicDigestMissingPage(dateKey));
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

  // ── Static files ────────────────────────────────────────────────────────────

  if (pathname === "/" || pathname === "/index.html") {
    return serveFile(res, path.join(WEB_DIR, "index.html"));
  }
  if (pathname === "/settings" || pathname === "/settings.html") {
    return serveFile(res, path.join(WEB_DIR, "settings.html"));
  }
  if (pathname === "/archive" || pathname === "/archive.html") {
    return serveFile(res, path.join(WEB_DIR, "archive.html"));
  }
  if (pathname === "/admin/login") {
    return serveFile(res, path.join(WEB_DIR, "admin-login.html"));
  }
  const adminHtmlRoute = pathname === "/admin" || pathname === "/admin.html" || pathname === "/admin/user" || pathname === "/admin/sandbox";
  if (adminHtmlRoute && !isAdminAuthed(req)) {
    const next = encodeURIComponent(pathname + (url.search || ""));
    res.writeHead(302, { Location: `/admin/login?next=${next}`, "Cache-Control": "no-store" });
    return res.end();
  }
  if (pathname === "/admin" || pathname === "/admin.html") {
    return serveFile(res, path.join(WEB_DIR, "admin.html"));
  }
  if (pathname === "/admin/user") {
    return serveFile(res, path.join(WEB_DIR, "admin-user.html"));
  }
  if (pathname === "/admin/sandbox") {
    return serveFile(res, path.join(WEB_DIR, "sandbox.html"));
  }
  if (pathname === "/robots.txt") return serveFile(res, path.join(WEB_DIR, "robots.txt"));
  if (pathname === "/sitemap.xml") return serveFile(res, path.join(WEB_DIR, "sitemap.xml"));
  if (pathname === "/style.css") return serveFile(res, path.join(WEB_DIR, "style.css"));
  if (pathname === "/preferences-shared.js") return serveFile(res, path.join(WEB_DIR, "preferences-shared.js"));
  if (pathname === "/index.js") return serveFile(res, path.join(WEB_DIR, "index.js"));
  if (pathname === "/settings.js") return serveFile(res, path.join(WEB_DIR, "settings.js"));

  return false;
}

module.exports = {
  handlePublicStaticRoutes,
};
