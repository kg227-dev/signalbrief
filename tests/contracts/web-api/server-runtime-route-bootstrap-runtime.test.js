"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../test-support/module-contract-helper.js");

const TARGET_REL = "web/server-runtime-route-bootstrap-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
const { createRouteBootstrapHandler } = runtime;
assertModuleExports(() => runtime, TARGET_REL);

const routeCtx = { pathname: "/example" };

async function testHandlerOrder() {
  const calls = [];
  const handler = createRouteBootstrapHandler({
    handleCoreApiRoute: async () => {
      calls.push("core");
      return false;
    },
    handleAdminApiRoute: async () => {
      calls.push("admin");
      return false;
    },
    handlePublicStaticRoute: async () => {
      calls.push("public");
      return false;
    },
  });
  const result = await handler(routeCtx);
  assert.strictEqual(result, false);
  assert.deepStrictEqual(calls, ["core", "admin", "public"]);
}

async function testShortCircuiting() {
  const calls = [];
  const handler = createRouteBootstrapHandler({
    handleCoreApiRoute: async () => {
      calls.push("core");
      return { ok: true, scope: "core" };
    },
    handleAdminApiRoute: async () => {
      calls.push("admin");
      return { ok: true, scope: "admin" };
    },
    handlePublicStaticRoute: async () => {
      calls.push("public");
      return { ok: true, scope: "public" };
    },
  });
  const result = await handler(routeCtx);
  assert.deepStrictEqual(result, { ok: true, scope: "core" });
  assert.deepStrictEqual(calls, ["core"]);
}

function testInputValidation() {
  assert.throws(() => createRouteBootstrapHandler({
    handleCoreApiRoute: null,
    handleAdminApiRoute: async () => false,
    handlePublicStaticRoute: async () => false,
  }), /handleCoreApiRoute/);
  assert.throws(() => createRouteBootstrapHandler({
    handleCoreApiRoute: async () => false,
    handleAdminApiRoute: null,
    handlePublicStaticRoute: async () => false,
  }), /handleAdminApiRoute/);
  assert.throws(() => createRouteBootstrapHandler({
    handleCoreApiRoute: async () => false,
    handleAdminApiRoute: async () => false,
    handlePublicStaticRoute: null,
  }), /handlePublicStaticRoute/);
}

(async () => {
  testInputValidation();
  await testHandlerOrder();
  await testShortCircuiting();
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
