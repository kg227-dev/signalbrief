"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { handleAdminEditorialOverridesRoutes } = require("./admin-api-editorial-overrides-runtime");

const TODAY = "2026-03-24";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-editorial-api-test-"));
const overridesPath = path.join(tmpDir, "editorial-overrides.json");

function buildCtx(method, pathname, body = null, search = "") {
  const url = new URL(`http://localhost${pathname}${search}`);
  return { req: { method, _body: body }, res: buildRes(), pathname, url };
}

function buildRes() {
  const res = { statusCode: 200, _body: "" };
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (body) => { res._body = body; };
  return res;
}

function buildDeps(overrides = {}) {
  return {
    json(res, data, status = 200) { res.writeHead(status); res.end(JSON.stringify(data)); },
    isAdminAuthed: () => true,
    requireJsonBody: async (req) => req._body || {},
    editorialOverridesPath: overridesPath,
    todayStr: TODAY,
    fs,
    path,
    ...overrides,
  };
}

// Run all tests sequentially to avoid shared-file race conditions
(async () => {
  // GET — empty
  {
    const ctx = buildCtx("GET", "/api/admin/editorial-overrides");
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true);
    assert.deepStrictEqual(body.overrides.pins, []);
    console.log("GET empty ✓");
  }

  // POST /pins
  {
    const ctx = buildCtx("POST", "/api/admin/editorial-overrides/pins", {
      url: "https://example.com/a", topic: "TECHNOLOGY", date: TODAY, note: "test pin"
    });
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true);
    const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    assert.strictEqual(on.pins.length, 1);
    console.log("POST /pins ✓");
  }

  // POST /excludes
  {
    const ctx = buildCtx("POST", "/api/admin/editorial-overrides/excludes", {
      url: "https://bad.com/b", date: TODAY, note: ""
    });
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true);
    const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    assert.strictEqual(on.excludes.length, 1);
    console.log("POST /excludes ✓");
  }

  // POST /suppressions
  {
    const ctx = buildCtx("POST", "/api/admin/editorial-overrides/suppressions", {
      domain: "spam.com", date: TODAY, note: ""
    });
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true);
    const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    assert.strictEqual(on.source_suppressions.length, 1);
    console.log("POST /suppressions ✓");
  }

  // DELETE /pins
  {
    const ctx = buildCtx("DELETE", "/api/admin/editorial-overrides/pins", null, "?url=https://example.com/a");
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true);
    const on = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    assert.strictEqual(on.pins.length, 0, "pin removed");
    console.log("DELETE /pins ✓");
  }

  // Unauthed → 401
  {
    const ctx = buildCtx("GET", "/api/admin/editorial-overrides");
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps({ isAdminAuthed: () => false }));
    assert.strictEqual(ctx.res.statusCode, 401);
    console.log("Unauthed → 401 ✓");
  }

  // Non-matching path → false
  {
    const ctx = buildCtx("GET", "/api/admin/other");
    const handled = await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    assert.strictEqual(handled, false);
    console.log("Non-matching → false ✓");
  }

  // Missing required field for pin → 400
  {
    const ctx = buildCtx("POST", "/api/admin/editorial-overrides/pins", { topic: "TECHNOLOGY" });
    await handleAdminEditorialOverridesRoutes(ctx, buildDeps());
    assert.strictEqual(ctx.res.statusCode, 400);
    console.log("Missing pin url → 400 ✓");
  }

  console.log("All editorial overrides API tests passed ✓");
})().catch((e) => { console.error(e); process.exit(1); });
