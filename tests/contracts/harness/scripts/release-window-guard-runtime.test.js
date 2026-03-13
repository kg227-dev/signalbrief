"use strict";

const assert = require("assert");
const path = require("path");
const {
  assertNodeSyntaxFile,
  assertModuleExports,
} = require("../../../../test-support/module-contract-helper.js");

const TARGET_REL = "scripts/release-window-guard-runtime.js";
const TARGET_PATH = path.join(process.cwd(), TARGET_REL);
assertNodeSyntaxFile(TARGET_PATH);
const runtime = require(TARGET_PATH);
assertModuleExports(() => runtime, TARGET_REL);

const {
  DEFAULT_RELEASE_WINDOWS_ET,
  evaluateReleaseWindowGuard,
  parseReleaseWindowsEt,
  resolveReleaseWindowGuardOptions,
} = runtime;

assert.strictEqual(typeof DEFAULT_RELEASE_WINDOWS_ET, "string");
assert.strictEqual(typeof evaluateReleaseWindowGuard, "function");
assert.strictEqual(typeof parseReleaseWindowsEt, "function");
assert.strictEqual(typeof resolveReleaseWindowGuardOptions, "function");

const parsed = parseReleaseWindowsEt("MON@11:00, MON@16:00, FRI@09:30");
assert.strictEqual(parsed.length, 3);
assert.strictEqual(parsed[0].weekday, 1);
assert.strictEqual(parsed[0].minutes, 660);
assert.strictEqual(parsed[2].weekday, 5);
assert.strictEqual(parsed[2].minutes, 570);
assert.throws(() => parseReleaseWindowsEt("NOTADAY@11:00"), /invalid release window day/);
assert.throws(() => parseReleaseWindowsEt("MON@25:00"), /invalid release window hour/);

const inWindow = evaluateReleaseWindowGuard({
  windowsSpec: "THU@11:00",
  toleranceMinutes: 30,
  hotfix: false,
  allowOutsideWindow: false,
  now: new Date("2026-03-12T15:05:00.000Z"), // Thu 11:05 ET
});
assert.strictEqual(inWindow.allowed, true);
assert.strictEqual(inWindow.mode, "scheduled_window");
assert.strictEqual(inWindow.in_window, true);

const blocked = evaluateReleaseWindowGuard({
  windowsSpec: "THU@11:00",
  toleranceMinutes: 10,
  hotfix: false,
  allowOutsideWindow: false,
  now: new Date("2026-03-12T18:30:00.000Z"), // Thu 14:30 ET
});
assert.strictEqual(blocked.allowed, false);
assert.strictEqual(blocked.mode, "blocked_outside_window");
assert.ok(blocked.next_window);

const hotfixOverride = evaluateReleaseWindowGuard({
  windowsSpec: "THU@11:00",
  toleranceMinutes: 10,
  hotfix: true,
  allowOutsideWindow: false,
  now: new Date("2026-03-12T18:30:00.000Z"),
});
assert.strictEqual(hotfixOverride.allowed, true);
assert.strictEqual(hotfixOverride.mode, "hotfix_override");

const resolved = resolveReleaseWindowGuardOptions([
  "--release-windows-et", "MON@11:00",
  "--release-window-tolerance-minutes", "20",
  "--hotfix",
  "--now-utc", "2026-03-12T18:30:00.000Z",
], {});
assert.strictEqual(resolved.windowsSpec, "MON@11:00");
assert.strictEqual(resolved.toleranceMinutes, 20);
assert.strictEqual(resolved.hotfix, true);
assert.strictEqual(resolved.now.toISOString(), "2026-03-12T18:30:00.000Z");

const envResolved = resolveReleaseWindowGuardOptions([], {
  DEPLOY_RELEASE_WINDOWS_ET: "TUE@16:00",
  DEPLOY_RELEASE_WINDOW_TOLERANCE_MINUTES: "25",
  DEPLOY_HOTFIX: "true",
});
assert.strictEqual(envResolved.windowsSpec, "TUE@16:00");
assert.strictEqual(envResolved.toleranceMinutes, 25);
assert.strictEqual(envResolved.hotfix, true);
