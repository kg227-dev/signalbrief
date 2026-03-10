#!/usr/bin/env node

const { runMatrix } = require("./runtime/matrix-runtime");

async function main() {
  await runMatrix(process.argv.slice(2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[run-matrix] fatal:", err.message);
    process.exit(1);
  });
}

module.exports = {
  runMatrix,
};
