#!/usr/bin/env node
"use strict";

const {
  resolveRollbackByShaOptions,
  runRollbackBySha,
} = require("./deploy-rollback-by-sha-runtime");

function log(message) {
  process.stdout.write(`[rollback-by-sha] ${message}\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/deploy-rollback-by-sha.js [options]",
      "",
      "Purpose:",
      "  One-command rollback to a commit SHA with mandatory public post-rollback health checks.",
      "  Optional restore SHA enables a full live rollback drill in one command.",
      "",
      "Required:",
      "  --rollback-sha <commit>",
      "",
      "Optional:",
      "  --restore-sha <commit>                  Restore deploy after rollback (drill mode)",
      "  --public-url <https://...>              Public URL for health checks",
      "  --artifact-dir <dir>                    Artifact output dir (default: ./artifacts/releases)",
      "  --artifact-name <file.json>             Explicit artifact name",
      "  --host <host> --user <user> --key <key>",
      "  --remote-dir <dir> --remote-tmp-dir <dir>",
      "  --services \"web bot worker\"",
      "  --skip-build --skip-remote-verify --skip-public-verify",
      "  --verify-attempts <n> --verify-delay-ms <ms>",
      "  --respect-release-window                Disable outside-window override",
      "  --no-hotfix                             Disable hotfix override",
      "  --keep-worktrees                        Keep temporary git worktrees for debug",
      "  --help                                  Show help",
    ].join("\n")
  );
}

async function main() {
  let options;
  try {
    options = resolveRollbackByShaOptions(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`[rollback-by-sha] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  try {
    const report = await runRollbackBySha(options);
    for (const step of report.steps) {
      log(
        `${step.label}: pass=${step.pass} sha=${step.commit_sha} `
        + `elapsed_seconds=${step.elapsed_seconds}`
      );
    }
    log(`rollback_recovery_seconds=${report.rollback_recovery_seconds}`);
    log(`artifact=${report.artifact_path}`);
    if (!report.pass) process.exit(1);
  } catch (error) {
    process.stderr.write(`[rollback-by-sha] FAIL: ${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
