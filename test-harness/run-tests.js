#!/usr/bin/env node

const { runHarness } = require("./runtime/harness-runtime");

async function main() {
  await runHarness(process.argv.slice(2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[test-harness] fatal:", err.message);
    process.exit(1);
  });
}

module.exports = {
  runHarness,
};
