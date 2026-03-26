"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TARGET_REL = "docker-compose.yml";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

assert.ok(
  /worker:\n[\s\S]*depends_on:\n[\s\S]*web:\n[\s\S]*condition: service_healthy/m.test(source),
  "worker should wait for healthy web service before start"
);
assert.ok(
  !/^\s{2}bot:\s*$/m.test(source),
  "email-only MVP compose should not define a bot service"
);
assert.ok(
  /worker:\n[\s\S]*healthcheck:[\s\S]*scheduler-heartbeat\.json/m.test(source),
  "worker should define heartbeat freshness healthcheck"
);
assert.ok(
  /web:\n[\s\S]*healthcheck:[\s\S]*wget -q --spider http:\/\/127\.0\.0\.1:3003\//m.test(source),
  "web should retain HTTP readiness probe"
);
