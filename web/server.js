#!/usr/bin/env node
/**
 * @module web/server
 * Web server entrypoint that boots HTTP transport around `web/server-runtime`.
 * Import this module for server startup in tests and tooling; execute it directly to run the web process.
 */

const http = require("http");
const {
  ensureStoreInitialized,
  getServerPort,
  handleWebRequest,
  installCrashProtection,
} = require("./server-runtime");
const { createStructuredLogger } = require("../src/runtime/structured-logger-runtime");

const serverLogger = createStructuredLogger({
  service: "web-server-entrypoint",
  context: {
    run_id: `web-entry-${process.pid}`,
    provider: "http",
  },
});

const server = http.createServer(async (req, res) => {
  await handleWebRequest(req, res);
});

function startServer() {
  ensureStoreInitialized();
  installCrashProtection();
  const port = getServerPort();
  server.listen(port, () => {
    serverLogger.info("web.server.started", {
      outcome: "started",
      port,
      message: `SignalBrief web running on http://localhost:${port}`,
    });
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  server,
};
