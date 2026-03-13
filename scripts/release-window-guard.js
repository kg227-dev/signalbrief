#!/usr/bin/env node
"use strict";

const {
  DEFAULT_RELEASE_WINDOWS_ET,
  evaluateReleaseWindowGuard,
  resolveReleaseWindowGuardOptions,
} = require("./release-window-guard-runtime");

function log(message) {
  process.stdout.write(`[release-window] ${message}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/release-window-guard.js [options]",
      "",
      "Purpose:",
      "  Evaluate whether a production deploy is within a scheduled release window.",
      "",
      "Options:",
      "  --release-windows-et <spec>             Window list (default weekdays 11:00 + 16:00 ET)",
      "  --release-window-tolerance-minutes <n>  Minutes allowed around each window (default: 45)",
      "  --hotfix                                Incident deploy override",
      "  --allow-outside-window                  Manual override (non-incident exceptional path)",
      "  --now-utc <timestamp>                   Evaluate against explicit time (testing)",
      "  --help                                  Show help",
      "",
      `Default windows: ${DEFAULT_RELEASE_WINDOWS_ET}`,
    ].join("\n")
  );
}

function main() {
  let options;
  try {
    options = resolveReleaseWindowGuardOptions(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`[release-window] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  const result = evaluateReleaseWindowGuard(options);
  const nextWindow = result.next_window
    ? `${result.next_window.label} (in ${result.next_window.eta})`
    : "n/a";
  log(
    `allowed=${result.allowed} mode=${result.mode} `
    + `now_et=${result.now_et.weekday_label} ${result.now_et.time} ${result.now_et.timezone} `
    + `next_window=${nextWindow}`
  );
  if (!result.allowed) {
    process.stderr.write(
      "[release-window] FAIL: outside scheduled window. "
      + "Use --hotfix only for active incidents.\n"
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
