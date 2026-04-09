"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

const serverRuntimeSource = readSource("web/server-runtime.js");
assert.ok(
  serverRuntimeSource.includes('require("./server-runtime-web-bootstrap-runtime")'),
  "server-runtime.js should compose route wiring via server-runtime-web-bootstrap-runtime"
);
assert.ok(
  serverRuntimeSource.includes('require("./server-runtime-auth-session-policy-runtime")'),
  "server-runtime.js should compose auth/session policy via server-runtime-auth-session-policy-runtime"
);
assert.ok(
  serverRuntimeSource.includes('require("./server-runtime-request-policy-runtime")'),
  "server-runtime.js should compose request/error policy via server-runtime-request-policy-runtime"
);
assert.ok(
  serverRuntimeSource.includes('require("./server-runtime-scheduler-control-runtime")'),
  "server-runtime.js should compose scheduler control policy via server-runtime-scheduler-control-runtime"
);
assert.ok(
  !serverRuntimeSource.includes('require("./api/core")')
    && !serverRuntimeSource.includes('require("./api/admin")')
    && !serverRuntimeSource.includes('require("./api/public")')
    && !serverRuntimeSource.includes('require("./routes/core/core-api")')
    && !serverRuntimeSource.includes('require("./routes/admin/admin-api")')
    && !serverRuntimeSource.includes('require("./routes/public-static")'),
  "server-runtime.js should not directly import domain route handlers"
);

const depsSource = readSource("web/server-runtime-deps-runtime.js");
assert.ok(
  depsSource.includes('require("./routes/core/core-api")')
    && depsSource.includes('require("./routes/admin/admin-api")')
    && depsSource.includes('require("./routes/public-static")'),
  "server-runtime-deps-runtime.js should remain the only route-handler composition boundary"
);
assert.ok(
  depsSource.includes('require("./server-runtime-shared-handlers-runtime")')
    && depsSource.includes('require("./server-runtime-core-registry-runtime")')
    && depsSource.includes('require("./server-runtime-admin-registry-runtime")')
    && depsSource.includes('require("./server-runtime-public-registry-runtime")'),
  "server-runtime-deps-runtime.js should compose route handler deps through bounded registries"
);
assert.ok(
  !depsSource.includes('require("./services/web-user-handlers")')
    && !depsSource.includes('require("./services/user")'),
  "server-runtime-deps-runtime.js should not directly wire user handler internals"
);

const webBootstrapSource = readSource("web/server-runtime-web-bootstrap-runtime.js");
assert.ok(
  webBootstrapSource.includes('require("./server-runtime-deps-runtime")')
    && webBootstrapSource.includes('require("./server-runtime-route-bootstrap-runtime")'),
  "server-runtime-web-bootstrap-runtime.js should compose route dependencies and route dispatch boundaries"
);

const sharedRegistrySource = readSource("web/server-runtime-shared-handlers-runtime.js");
assert.ok(
  sharedRegistrySource.includes('require("./services/user")'),
  "shared handler registry should be the only module wiring grouped user service handlers"
);

const coreRegistrySource = readSource("web/server-runtime-core-registry-runtime.js");
assert.ok(
  !coreRegistrySource.includes('require("./api/admin")')
    && !coreRegistrySource.includes('require("./api/public")')
    && !coreRegistrySource.includes('require("./routes/admin/admin-api")')
    && !coreRegistrySource.includes('require("./routes/public-static")'),
  "core registry should stay route-dependency only and avoid cross-route imports"
);

const adminRegistrySource = readSource("web/server-runtime-admin-registry-runtime.js");
assert.ok(
  !adminRegistrySource.includes('require("./api/core")')
    && !adminRegistrySource.includes('require("./api/public")')
    && !adminRegistrySource.includes('require("./routes/core/core-api")')
    && !adminRegistrySource.includes('require("./routes/public-static")'),
  "admin registry should stay route-dependency only and avoid cross-route imports"
);

const publicRegistrySource = readSource("web/server-runtime-public-registry-runtime.js");
assert.ok(
  !publicRegistrySource.includes('require("./api/core")')
    && !publicRegistrySource.includes('require("./api/admin")')
    && !publicRegistrySource.includes('require("./routes/core/core-api")')
    && !publicRegistrySource.includes('require("./routes/admin/admin-api")'),
  "public registry should stay route-dependency only and avoid cross-route imports"
);

const routeBootstrapSource = readSource("web/server-runtime-route-bootstrap-runtime.js");
assert.ok(
  !routeBootstrapSource.includes('require("./api/core")')
    && !routeBootstrapSource.includes('require("./api/admin")')
    && !routeBootstrapSource.includes('require("./api/public")')
    && !routeBootstrapSource.includes('require("./routes/core/core-api")')
    && !routeBootstrapSource.includes('require("./routes/admin/admin-api")')
    && !routeBootstrapSource.includes('require("./routes/public-static")'),
  "server-runtime-route-bootstrap-runtime.js should only dispatch handlers, not import domain handlers"
);

const requestPolicySource = readSource("web/server-runtime-request-policy-runtime.js");
assert.ok(
  !requestPolicySource.includes('require("./api/core")')
    && !requestPolicySource.includes('require("./api/admin")')
    && !requestPolicySource.includes('require("./api/public")')
    && !requestPolicySource.includes('require("./routes/core/core-api")')
    && !requestPolicySource.includes('require("./routes/admin/admin-api")')
    && !requestPolicySource.includes('require("./routes/public-static")'),
  "server-runtime-request-policy-runtime.js should remain transport-policy only"
);
