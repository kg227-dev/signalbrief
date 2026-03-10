const runtime = require("./src/jobs/reengagement-runtime");

if (require.main === module) {
  runtime.main().catch((err) => {
    runtime.log(`fatal: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = runtime;
