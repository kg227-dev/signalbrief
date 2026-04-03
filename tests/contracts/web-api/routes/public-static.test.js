"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/public-static.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createPublicStaticRouteHandler } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

function buildMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
      this.headersSent = true;
    },
    end(body = "") {
      this.body = String(body || "");
      return this.body;
    },
  };
}

function invoke(handler, { method, pathname, search = "" }) {
  const req = { method, url: `${pathname}${search}` };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}${search}`);
  const handled = handler({ req, res, url, pathname });
  return { handled, res };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sb-public-static-route-"));
const webDir = path.join(tempRoot, "web");
const appRoot = path.join(tempRoot, "app");
const archiveDir = path.join(appRoot, "archive");
fs.mkdirSync(webDir, { recursive: true });
fs.mkdirSync(archiveDir, { recursive: true });
fs.writeFileSync(path.join(webDir, "index.html"), "<script src=\"index.js?v=__ASSET_VERSION__\"></script>");
fs.writeFileSync(path.join(webDir, "signup.html"), "<script src=\"signup-flow.js?v=__ASSET_VERSION__\"></script>");
fs.writeFileSync(path.join(webDir, "settings.html"), "<script src=\"settings-runtime.js?v=__ASSET_VERSION__\"></script>");
fs.writeFileSync(path.join(webDir, "admin-source-registry.html"), "<html>source registry</html>");

const deps = {
  path,
  fs,
  APP_ROOT: appRoot,
  readArchiveFiles: () => [],
  findUserByToken: () => null,
  loadLatestDigestSnapshot: () => null,
  loadDigestSnapshotByRunId: () => null,
  renderPublicDigestMissingPage: (dateKey) => `<html>missing:${dateKey || "none"}</html>`,
  formatPublicDigestDateLabel: (dateKey) => dateKey,
  renderPublicDigestPage: () => "<html>digest</html>",
  getBaseUrl: () => "https://getsignalbrief.com",
  isAdminAuthed: () => false,
  assetVersion: "abc123",
  serveFile: (res, targetPath, headers = null) => {
    if (!fs.existsSync(targetPath)) {
      res.writeHead(404);
      res.end("Not found");
      return true;
    }
    const body = fs.readFileSync(targetPath, "utf8");
    res.writeHead(200, headers || {});
    res.end(body);
    return true;
  },
  WEB_DIR: webDir,
};

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/admin" });
  assert.strictEqual(handled, "");
  assert.strictEqual(res.statusCode, 302);
  assert.ok(String(res.headers.Location || "").startsWith("/admin/login?next="));
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/admin/source-registry" });
  assert.strictEqual(handled, "");
  assert.strictEqual(res.statusCode, 302);
  assert.ok(String(res.headers.Location || "").startsWith("/admin/login?next="));
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled } = invoke(handler, { method: "GET", pathname: "/admin/sandbox" });
  assert.strictEqual(handled, false);
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled } = invoke(handler, { method: "GET", pathname: "/admin/retrieval-eval" });
  assert.strictEqual(handled, false);
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/digest" });
  assert.strictEqual(handled, "<html>missing:none</html>");
  assert.strictEqual(res.statusCode, 404);
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/settings" });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body.includes("settings-runtime.js?v=abc123"));
  assert.ok(!res.body.includes("__ASSET_VERSION__"));
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/" });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers["Cache-Control"], "public, max-age=300, stale-while-revalidate=86400");
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/signup" });
  assert.strictEqual(handled, true);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers["Cache-Control"], "public, max-age=300, stale-while-revalidate=86400");
}

{
  const handler = createPublicStaticRouteHandler(deps);
  const { handled } = invoke(handler, { method: "GET", pathname: "/not-found" });
  assert.strictEqual(handled, false);
}

{
  fs.writeFileSync(path.join(archiveDir, "2026-03-15.json"), JSON.stringify({
    dateStr: "Sunday, March 15, 2026",
    quickScan: "Archive quick scan",
    items: [{ headline: "Archive item" }],
  }, null, 2));
  const handler = createPublicStaticRouteHandler({
    ...deps,
    readArchiveFiles: () => ["2026-03-15.json", "2026-03-14.json"],
  });
  const { handled, res } = invoke(handler, { method: "GET", pathname: "/sitemap.xml" });
  assert.strictEqual(typeof handled, "string");
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers["Content-Type"], "application/xml; charset=utf-8");
  assert.strictEqual(res.headers["Cache-Control"], "public, max-age=300, stale-while-revalidate=86400");
  assert.ok(res.body.includes("<loc>https://getsignalbrief.com/</loc>"));
  assert.ok(res.body.includes("<loc>https://getsignalbrief.com/signup</loc>"));
  assert.ok(res.body.includes("<loc>https://getsignalbrief.com/digest/2026-03-15</loc>"));
}

{
  fs.writeFileSync(path.join(archiveDir, "2026-03-14.json"), JSON.stringify({
    dateStr: "Saturday, March 14, 2026",
    quickScan: "Archive quick scan",
    items: [{ headline: "Archive item" }],
  }, null, 2));
  const handler = createPublicStaticRouteHandler({
    ...deps,
    readArchiveFiles: () => ["2026-03-14.json"],
  });
  const { handled, res } = invoke(handler, {
    method: "GET",
    pathname: "/digest/2026-03-14",
    search: "?ref=tok-1&run=scheduled%3Arun-1",
  });
  assert.strictEqual(handled, "");
  assert.strictEqual(res.statusCode, 302);
  assert.strictEqual(res.headers["Cache-Control"], "private, no-store");
  assert.strictEqual(
    res.headers.Location,
    "/archive?token=tok-1&date=2026-03-14"
  );
}

{
  fs.writeFileSync(path.join(archiveDir, "2026-03-16.json"), JSON.stringify({
    dateStr: "Monday, March 16, 2026",
    quickScan: "Admin preview quick scan",
    items: [{ headline: "Admin preview item", relevanceScore: 7.2 }],
  }, null, 2));
  const handler = createPublicStaticRouteHandler({
    ...deps,
    readArchiveFiles: () => ["2026-03-16.json"],
    isAdminAuthed: () => true,
  });
  const { handled, res } = invoke(handler, {
    method: "GET",
    pathname: "/digest/2026-03-16",
  });
  assert.strictEqual(handled, "");
  assert.strictEqual(res.statusCode, 302);
  assert.strictEqual(res.headers["Cache-Control"], "private, no-store");
  assert.strictEqual(
    res.headers.Location,
    "/admin?digest_audit_date=2026-03-16#digestAuditSection"
  );
}

{
  fs.writeFileSync(path.join(archiveDir, "2026-03-17.json"), JSON.stringify({
    dateStr: "Tuesday, March 17, 2026",
    quickScan: "Public digest quick scan",
    items: [{ headline: "Public digest item", summary: "A public item summary." }],
  }, null, 2));
  let renderedPayload = null;
  const handler = createPublicStaticRouteHandler({
    ...deps,
    readArchiveFiles: () => ["2026-03-17.json"],
    renderPublicDigestPage: (payload) => {
      renderedPayload = payload;
      return "<html>public digest</html>";
    },
  });
  const { handled, res } = invoke(handler, {
    method: "GET",
    pathname: "/digest/2026-03-17",
  });
  assert.strictEqual(handled, "<html>public digest</html>");
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers["Content-Type"], "text/html; charset=utf-8");
  assert.strictEqual(res.headers["Cache-Control"], "public, max-age=300, stale-while-revalidate=86400");
  assert.strictEqual(renderedPayload.dateKey, "2026-03-17");
  assert.strictEqual(renderedPayload.dateLabel, "Tuesday, March 17, 2026");
  assert.strictEqual(renderedPayload.quickScan, "Public digest quick scan");
  assert.strictEqual(renderedPayload.items.length, 1);
}
