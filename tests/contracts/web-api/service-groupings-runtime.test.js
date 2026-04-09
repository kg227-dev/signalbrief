"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  assertModuleExports,
  assertNodeSyntaxFile,
} = require("../../../test-support/module-contract-helper.js");

const ROOT = process.cwd();

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const adminTarget = path.join(ROOT, "web/services/admin/index.js");
const sharedTarget = path.join(ROOT, "web/services/shared/index.js");
const userTarget = path.join(ROOT, "web/services/user/index.js");

assertNodeSyntaxFile(adminTarget);
assertNodeSyntaxFile(sharedTarget);
assertNodeSyntaxFile(userTarget);

const admin = require(adminTarget);
const shared = require(sharedTarget);
const user = require(userTarget);

assertModuleExports(() => admin, "web/services/admin/index.js");
assertModuleExports(() => shared, "web/services/shared/index.js");
assertModuleExports(() => user, "web/services/user/index.js");

assert.strictEqual(
  admin.createAdminOpsService,
  require(path.join(ROOT, "web/services/admin-ops.js")).createAdminOpsService,
  "admin grouping should expose createAdminOpsService"
);
assert.strictEqual(
  admin.sourceRegistryMetrics.buildCurationQueues,
  require(path.join(ROOT, "web/services/admin-source-registry-metrics-runtime.js")).buildCurationQueues,
  "admin grouping should preserve namespaced sourceRegistryMetrics helpers"
);
assert.strictEqual(
  shared.getClientIp,
  require(path.join(ROOT, "web/services/request-metadata.js")).getClientIp,
  "shared grouping should expose request metadata helpers"
);
assert.strictEqual(
  shared.deliverySchedule.computeNextDeliveryEt,
  require(path.join(ROOT, "web/services/delivery-schedule.js")).computeNextDeliveryEt,
  "shared grouping should preserve namespaced delivery schedule helpers"
);
assert.strictEqual(
  user.createWebUserHandlers,
  require(path.join(ROOT, "web/services/web-user-handlers.js")).createWebUserHandlers,
  "user grouping should expose createWebUserHandlers"
);
assert.strictEqual(
  user.signupActionsRuntime.buildSignupResponse,
  require(path.join(ROOT, "web/services/web-user-signup-actions-runtime.js")).buildSignupResponse,
  "user grouping should preserve namespaced signup action helpers"
);

const serverRuntimeSource = readSource("web/server-runtime.js");
assert.ok(
  serverRuntimeSource.includes('require("./services/admin")')
    && serverRuntimeSource.includes('require("./services/shared")'),
  "server-runtime.js should consume grouped admin/shared service entrypoints"
);
assert.ok(
  !serverRuntimeSource.includes('require("./services/admin-ops")')
    && !serverRuntimeSource.includes('require("./services/request-metadata")'),
  "server-runtime.js should stop wiring flat service files directly for grouped services"
);

const sharedHandlersSource = readSource("web/server-runtime-shared-handlers-runtime.js");
assert.ok(
  sharedHandlersSource.includes('require("./services/user")'),
  "shared handlers runtime should consume grouped user service entrypoint"
);

const statsActionsSource = readSource("web/routes/admin/admin-api-stats-actions-runtime.js");
assert.ok(
  statsActionsSource.includes('require("../../services/admin")'),
  "admin stats actions should consume grouped admin service entrypoint"
);

const statsPayloadSource = readSource("web/routes/admin/admin-api-stats-payload-runtime.js");
assert.ok(
  statsPayloadSource.includes('require("../../services/admin")'),
  "admin stats payload should consume grouped admin service entrypoint"
);

const sourceRegistryRouteSource = readSource("web/routes/admin/admin-api-source-registry-runtime.js");
assert.ok(
  sourceRegistryRouteSource.includes('require("../../services/admin")'),
  "admin source registry route should consume grouped admin service entrypoint"
);

const archiveRouteSource = readSource("web/routes/core/core-api-archive-runtime.js");
assert.ok(
  archiveRouteSource.includes('require("../../services/shared")'),
  "core archive route should consume grouped shared service entrypoint"
);

console.log("service grouping runtime contracts passed");
