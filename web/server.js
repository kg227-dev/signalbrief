#!/usr/bin/env node
/**
 * SignalBrief Web entrypoint.
 * Keeps process bootstrap separate from route/dependency runtime wiring.
 */

const http = require("http");
const {
  ensureStoreInitialized,
  getServerPort,
  handleWebRequest,
  installCrashProtection,
} = require("./server-runtime");

const server = http.createServer(async (req, res) => {
  await handleWebRequest(req, res);
});

function startServer() {
  ensureStoreInitialized();
  installCrashProtection();
  const port = getServerPort();
  server.listen(port, () => {
    console.log(`SignalBrief web running on http://localhost:${port}`);
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
