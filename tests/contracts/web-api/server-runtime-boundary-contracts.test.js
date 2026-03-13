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
  serverRuntimeSource.includes('require("./server-runtime-deps-runtime")'),
  "server-runtime.js should compose route handlers via server-runtime-deps-runtime"
);
assert.ok(
  serverRuntimeSource.includes('require("./server-runtime-route-bootstrap-runtime")'),
  "server-runtime.js should compose route dispatch via server-runtime-route-bootstrap-runtime"
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
  !serverRuntimeSource.includes('require("./api/core")')
    && !serverRuntimeSource.includes('require("./api/admin")')
    && !serverRuntimeSource.includes('require("./api/public")'),
  "server-runtime.js should not directly import api/* domain route handlers"
);

const depsSource = readSource("web/server-runtime-deps-runtime.js");
assert.ok(
  depsSource.includes('require("./api/core")')
    && depsSource.includes('require("./api/admin")')
    && depsSource.includes('require("./api/public")'),
  "server-runtime-deps-runtime.js should remain the only route-handler composition boundary"
);

const routeBootstrapSource = readSource("web/server-runtime-route-bootstrap-runtime.js");
assert.ok(
  !routeBootstrapSource.includes('require("./api/core")')
    && !routeBootstrapSource.includes('require("./api/admin")')
    && !routeBootstrapSource.includes('require("./api/public")'),
  "server-runtime-route-bootstrap-runtime.js should only dispatch handlers, not import domain handlers"
);

const requestPolicySource = readSource("web/server-runtime-request-policy-runtime.js");
assert.ok(
  !requestPolicySource.includes('require("./api/core")')
    && !requestPolicySource.includes('require("./api/admin")')
    && !requestPolicySource.includes('require("./api/public")'),
  "server-runtime-request-policy-runtime.js should remain transport-policy only"
);
