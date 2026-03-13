"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const TARGET_REL = "Dockerfile";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
const source = fs.readFileSync(TARGET_PATH, "utf8");

assert.ok(source.includes("@sha256:"), "Dockerfile base image should be digest-pinned");
assert.ok(source.includes("AS deps"), "Dockerfile should define a deps stage");
assert.ok(source.includes("AS runtime"), "Dockerfile should define a runtime stage");
assert.ok(source.includes("package-lock.json"), "Dockerfile should use package-lock for deterministic installs");
assert.ok(source.includes("npm ci --omit=dev"), "Dockerfile should use npm ci for pinned install behavior");
assert.ok(source.includes("HEALTHCHECK"), "Dockerfile should define container healthcheck expectations");
assert.ok(!source.includes("npm install --omit=dev"), "Dockerfile should avoid non-deterministic npm install path");
