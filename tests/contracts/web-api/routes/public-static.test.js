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
fs.writeFileSync(path.join(webDir, "settings.html"), "<script src=\"settings-runtime.js?v=__ASSET_VERSION__\"></script>");

const deps = {
  path,
  fs,
  APP_ROOT: appRoot,
  readArchiveFiles: () => [],
  renderPublicDigestMissingPage: (dateKey) => `<html>missing:${dateKey || "none"}</html>`,
  formatPublicDigestDateLabel: (dateKey) => dateKey,
  renderPublicDigestPage: () => "<html>digest</html>",
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
  const { handled } = invoke(handler, { method: "GET", pathname: "/not-found" });
  assert.strictEqual(handled, false);
}
