const DIGEST_ROUTE_RE = /^\/digest(?:\/(\d{4}-\d{2}-\d{2})\/?)?$/;
const ADMIN_HTML_ROUTES = new Set(["/admin", "/admin.html", "/admin/user", "/admin/sandbox"]);
const NO_STORE_STATIC_ROUTES = new Set(["/admin/login", "/admin", "/admin.html", "/admin/user", "/admin/sandbox"]);
const NO_CACHE_STATIC_ROUTES = new Set(["/", "/index.html", "/index.js"]);
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

function parseDigestDateFromId(digestId) {
  const match = String(digestId || "").trim().match(/^(\d{4}-\d{2}-\d{2}):/);
  return match ? match[1] : "";
}

function normalizeLookupKey(value) {
  return String(value || "").toLowerCase().trim();
}

function sourceLabelFromUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return parsed.hostname.replace(/^www\./i, "") || "source";
  } catch {
    return "source";
  }
}

function mapDigestEventItemsToPublic(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows.map((item) => ({
    tag: String(item?.tag || "Signal").trim() || "Signal",
    headline: String(item?.headline || "Untitled item").trim() || "Untitled item",
    summary: "",
    wim: "",
    source: sourceLabelFromUrl(item?.url),
    url: String(item?.url || "").trim(),
  }));
}

function buildQuickScanFromDigestEventItems(items) {
  const rows = Array.isArray(items) ? items : [];
  const headlines = rows
    .map((item) => String(item?.headline || "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return headlines.join(" · ");
}

function selectPreferredDigestEvent(events) {
  const rows = Array.isArray(events) ? events.slice() : [];
  if (!rows.length) return null;
  rows.sort((left, right) => {
    const leftChannel = String(left?.channel || "").toLowerCase();
    const rightChannel = String(right?.channel || "").toLowerCase();
    const leftChannelRank = leftChannel === "email" ? 2 : (leftChannel === "telegram" ? 1 : 0);
    const rightChannelRank = rightChannel === "email" ? 2 : (rightChannel === "telegram" ? 1 : 0);
    if (rightChannelRank !== leftChannelRank) return rightChannelRank - leftChannelRank;

    const leftTs = Date.parse(String(left?.ts_utc || ""));
    const rightTs = Date.parse(String(right?.ts_utc || ""));
    const leftValid = Number.isFinite(leftTs) ? leftTs : 0;
    const rightValid = Number.isFinite(rightTs) ? rightTs : 0;
    return rightValid - leftValid;
  });
  return rows[0] || null;
}

function resolvePersonalizedDigestPayload({
  dateKey,
  runId,
  refToken,
  loadEngagementEvents,
  findUserByToken,
  formatPublicDigestDateLabel,
}) {
  const normalizedRunId = String(runId || "").trim();
  const normalizedRef = String(refToken || "").trim().toLowerCase();
  if (!normalizedRunId && !normalizedRef) return null;
  if (typeof loadEngagementEvents !== "function") return null;

  let user = null;
  if (normalizedRef) {
    if (typeof findUserByToken !== "function") return null;
    user = findUserByToken(normalizedRef);
    if (!user) return null;
  }

  let events = [];
  try {
    events = loadEngagementEvents({ max_age_days: 120, dedupe: false });
  } catch {
    return null;
  }

  const userEmailKey = normalizeLookupKey(user?.email);
  const userChatIdKey = normalizeLookupKey(user?.chatId);
  const candidates = events.filter((event) => {
    if (String(event?.event_type || "") !== "digest_sent") return false;
    const eventDateKey = String(event?.date_et || "").trim() || parseDigestDateFromId(event?.digest_id);
    if (eventDateKey !== dateKey) return false;
    if (normalizedRunId && String(event?.run_id || "").trim() !== normalizedRunId) return false;

    if (!user) return true;
    const eventEmailKey = normalizeLookupKey(event?.user_email);
    const eventChatIdKey = normalizeLookupKey(event?.user_chat_id);
    if (userEmailKey && eventEmailKey === userEmailKey) return true;
    if (userChatIdKey && eventChatIdKey === userChatIdKey) return true;
    return false;
  });
  if (!candidates.length) return null;

  const selected = selectPreferredDigestEvent(candidates);
  if (!selected) return null;
  const eventItems = Array.isArray(selected?.metadata?.items) ? selected.metadata.items : [];
  const mappedItems = mapDigestEventItemsToPublic(eventItems);
  if (!mappedItems.length) return null;

  const qualityScore = Number(selected?.metadata?.quality_score);
  const itemCount = Number(selected?.metadata?.item_count || mappedItems.length);
  const metaParts = [];
  if (Number.isFinite(itemCount) && itemCount > 0) {
    metaParts.push(`${itemCount} signals`);
  }
  if (Number.isFinite(qualityScore)) {
    metaParts.push(`Match ${Math.round(qualityScore)}%`);
  }
  const digestMetaLine = metaParts.length ? `Personalized snapshot · ${metaParts.join(" · ")}` : "Personalized snapshot";

  return {
    dateKey,
    dateLabel: formatPublicDigestDateLabel(dateKey),
    quickScan: buildQuickScanFromDigestEventItems(eventItems),
    items: mappedItems,
    refToken: normalizedRef || "",
    digestMetaLine,
  };
}

function serveDigestPage(ctx, deps) {
  const { req, res, url, pathname } = ctx;
  const {
    path, fs, APP_ROOT, readArchiveFiles, renderPublicDigestMissingPage,
    formatPublicDigestDateLabel, renderPublicDigestPage,
    loadEngagementEvents, findUserByToken,
  } = deps;

  if (req.method !== "GET" || !DIGEST_ROUTE_RE.test(pathname)) return false;

  const archiveDir = path.join(APP_ROOT, "archive");
  const files = readArchiveFiles(archiveDir);
  const dateKey = resolveDigestDateKey(pathname, files);
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
  }

  const archivePath = path.join(archiveDir, `${dateKey}.json`);
  const runId = url.searchParams.get("run") || "";
  const refToken = url.searchParams.get("ref") || "";
  const personalizedPayload = resolvePersonalizedDigestPayload({
    dateKey,
    runId,
    refToken,
    loadEngagementEvents,
    findUserByToken,
    formatPublicDigestDateLabel,
  });

  try {
    let payload = personalizedPayload;
    if (!payload) {
      if (!fs.existsSync(archivePath)) {
        return writeMissingDigest(res, dateKey, renderPublicDigestMissingPage);
      }
      const parsed = JSON.parse(fs.readFileSync(archivePath, "utf8"));
      const dateLabel = String(parsed?.dateStr || "").trim() || formatPublicDigestDateLabel(dateKey);
      payload = {
        dateKey,
        dateLabel,
        quickScan: parsed?.quickScan || "",
        items: Array.isArray(parsed?.items) ? parsed.items : [],
        refToken,
      };
    }

    const html = renderPublicDigestPage({
      ...payload,
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
  if (fileName === "index.html" || fileName === "settings.html") {
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
