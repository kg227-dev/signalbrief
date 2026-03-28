"use strict";

const { spawn } = require("child_process");

function sanitizeSource(value) {
  const source = String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .slice(0, 80);
  return source || "unknown";
}

function createDigestRunnerSpawnRuntime(deps) {
  const {
    root,
    digestScript,
    defaultWaitTimeoutMs,
    toPositiveIntOrDefault,
    isDigestRunnerDebug,
  } = deps;

  function buildDigestArgs(opts = {}) {
    const args = [];
    if (opts.suppressWelcome) args.push("--suppressWelcome");
    if (Array.isArray(opts.extraArgs)) {
      for (const value of opts.extraArgs) {
        const text = String(value || "").trim();
        if (text) args.push(text);
      }
    }
    return args;
  }

  function buildTriggerEnv(opts = {}) {
    const source = sanitizeSource(opts.source);
    const trigger = String(opts.trigger || source).trim() || source;
    const requestId = String(opts.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const env = {
      ...process.env,
      ...(opts.env && typeof opts.env === "object" ? opts.env : {}),
      SIGNALBRIEF_DIGEST_TRIGGER_SOURCE: source,
      SIGNALBRIEF_DIGEST_TRIGGER: trigger,
      SIGNALBRIEF_DIGEST_REQUEST_ID: requestId,
      SIGNALBRIEF_DIGEST_REQUESTED_AT: new Date().toISOString(),
    };
    return { env, source, trigger, requestId };
  }

  function spawnDetached(args, env) {
    const child = spawn(process.execPath, [digestScript, ...args], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref();
    return { pid: child.pid || null };
  }

  function isPidRunning(pid) {
    const id = Number(pid);
    if (!Number.isInteger(id) || id <= 0) return false;
    try {
      process.kill(id, 0);
      return true;
    } catch (err) {
      return err?.code === "EPERM";
    }
  }

  function runAndWait(args, env, opts = {}) {
    const timeoutMs = Math.max(15_000, toPositiveIntOrDefault(opts.timeoutMs, defaultWaitTimeoutMs));
    const stderrLimit = Math.max(2000, toPositiveIntOrDefault(opts.stderrLimit, 8000));
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [digestScript, ...args], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch (err) {
          if (isDigestRunnerDebug()) {
            console.warn(`[digest-runner] SIGTERM failed: ${err.message}`);
          }
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch (err) {
            if (isDigestRunnerDebug()) {
              console.warn(`[digest-runner] SIGKILL failed: ${err.message}`);
            }
          }
        }, 1500);
      }, timeoutMs);
      child.stdout.on("data", (buf) => {
        if (typeof opts.onStdout === "function") opts.onStdout(buf);
      });
      child.stderr.on("data", (buf) => {
        if (typeof opts.onStderr === "function") opts.onStderr(buf);
        stderr += String(buf);
        if (stderr.length > stderrLimit) stderr = stderr.slice(-stderrLimit);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          code: Number.isFinite(code) ? code : null,
          signal: signal || null,
          stderr,
        });
      });
    });
  }

  return {
    sanitizeSource,
    buildDigestArgs,
    buildTriggerEnv,
    spawnDetached,
    isPidRunning,
    runAndWait,
  };
}

module.exports = {
  createDigestRunnerSpawnRuntime,
  sanitizeSource,
};
