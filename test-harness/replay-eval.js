#!/usr/bin/env node

const { runReplay } = require("./runtime/replay-runtime");

async function main() {
  const result = await runReplay(process.argv.slice(2));
  console.log(`Replay report written: ${result.output_path}`);
}

if (require.main === module) {
  Promise.resolve(main()).catch((err) => {
    console.error("[replay-eval] fatal:", err.message);
    process.exit(1);
  });
}

module.exports = {
  runReplay,
};
