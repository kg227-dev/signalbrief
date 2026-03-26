"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { handleAdminDigestTuningRoutes } = require("./admin-api-digest-tuning-runtime");

function buildCtx(method, pathname, body = null) {
  const url = new URL(`http://localhost${pathname}`);
  const req = {
    method,
    _body: body,
  };
  return { req, res: buildRes(), pathname, url };
}

function buildRes() {
  const res = {
    statusCode: 200,
    _headers: {},
    _body: "",
    writeHead(code, headers = {}) { this.statusCode = code; this._headers = { ...this._headers, ...headers }; },
    end(body) { this._body = body; },
  };
  return res;
}

function buildDeps(tuningPath, overrides = {}) {
  return {
    json(res, data, status = 200) { res.writeHead(status); res.end(JSON.stringify(data)); },
    isAdminAuthed: () => true,
    requireJsonBody: async (req) => req._body || {},
    digestTuningPath: tuningPath,
    fs,
    path,
    ...overrides,
  };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tuning-api-test-"));
const tuningPath = path.join(tmpDir, "digest-tuning.json");

// GET — missing file returns {}
{
  const ctx = buildCtx("GET", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true, "GET handled");
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true, "ok: true");
    assert.deepStrictEqual(body.tuning, {}, "empty tuning when missing");
    console.log("GET missing file → {} ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// GET — existing file returns content
{
  const content = { maxAgeHours: 36 };
  fs.writeFileSync(tuningPath, JSON.stringify(content));
  const ctx = buildCtx("GET", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.tuning.maxAgeHours, 36, "content returned");
    console.log("GET existing file ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// PUT — valid update writes file
{
  const newTuning = { maxAgeHours: 48, crossDayDedupDays: 5 };
  const ctx = buildCtx("PUT", "/api/admin/digest-tuning", newTuning);
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true, "PUT handled");
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, true, "PUT ok: true");
    const onDisk = JSON.parse(fs.readFileSync(tuningPath, "utf8"));
    assert.strictEqual(onDisk.maxAgeHours, 48, "file written");
    assert.strictEqual(onDisk.crossDayDedupDays, 5, "crossDayDedupDays written");
    console.log("PUT valid → writes file ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// PUT — unknown key rejected
{
  const badTuning = { unknownKey: 123 };
  const ctx = buildCtx("PUT", "/api/admin/digest-tuning", badTuning);
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 400, "invalid tuning → 400");
    const body = JSON.parse(ctx.res._body);
    assert.strictEqual(body.ok, false, "ok: false");
    console.log("PUT invalid key → 400 ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Unauthorized request → 401
{
  const ctx = buildCtx("GET", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath, { isAdminAuthed: () => false });
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 401, "unauthed → 401");
    console.log("Unauthed → 401 ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Non-matching path → not handled
{
  const ctx = buildCtx("GET", "/api/admin/other");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, false, "non-matching path → false");
    console.log("Non-matching path → false ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

// DELETE → 405
{
  const ctx = buildCtx("DELETE", "/api/admin/digest-tuning");
  const deps = buildDeps(tuningPath);
  (async () => {
    const handled = await handleAdminDigestTuningRoutes(ctx, deps);
    assert.strictEqual(handled, true);
    assert.strictEqual(ctx.res.statusCode, 405, "unsupported method → 405");
    console.log("DELETE → 405 ✓");
  })().catch((e) => { console.error(e); process.exit(1); });
}

console.log("All digest-tuning API tests queued ✓");
