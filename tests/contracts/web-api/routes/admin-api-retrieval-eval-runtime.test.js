"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/routes/admin-api-retrieval-eval-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const { handleAdminRetrievalEvalRoutes } = runtime;

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

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
  return undefined;
}

async function invoke(deps, { method, pathname, search = "" }) {
  const req = {
    method,
    url: `${pathname}${search}`,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = buildMockRes();
  const url = new URL(`http://localhost${pathname}${search}`);
  const handled = await handleAdminRetrievalEvalRoutes({ req, res, url, pathname }, {
    json,
    isAdminAuthed: () => true,
    loadRetrievalEvalRuns: (limit) => [{ run_id: `run-limit-${limit}`, status: "completed" }],
    loadRetrievalEvalRun: (runId) => ({ run_id: runId, status: "completed", overall_summary: { overall_score: 82 } }),
    loadRetrievalEvalStatus: () => ({ active_run: null, budget: { cap_usd: 25, spent_usd: 3.2 } }),
    ...deps,
  });
  return { handled, res };
}

(async () => {
  {
    const { handled, res } = await invoke({}, {
      method: "GET",
      pathname: "/api/admin/retrieval-eval/runs",
      search: "?limit=3",
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.runs[0].run_id, "run-limit-3");
  }

  {
    const { handled, res } = await invoke({}, {
      method: "GET",
      pathname: "/api/admin/retrieval-eval/run",
      search: "?run_id=retrieval-eval:123",
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.run_id, "retrieval-eval:123");
  }

  {
    const { handled, res } = await invoke({}, {
      method: "GET",
      pathname: "/api/admin/retrieval-eval/status",
    });
    assert.ok(handled);
    const payload = JSON.parse(res.body);
    assert.strictEqual(payload.budget.spent_usd, 3.2);
  }

  {
    const { handled, res } = await invoke({ isAdminAuthed: () => false }, {
      method: "GET",
      pathname: "/api/admin/retrieval-eval/runs",
    });
    assert.ok(handled);
    assert.strictEqual(res.statusCode, 403);
  }

  process.stdout.write("[admin-api-retrieval-eval-runtime] all assertions passed\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
