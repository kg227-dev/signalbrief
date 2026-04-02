# Phase 3 — Recovery Tooling
## SignalBrief Reliability Recovery Plan V3

**Goal:** Give the operator the tools to see system state clearly and recover safely after an incident — without risking a second burn loop.

Deliverables: snapshot-first recovery, recovery queue, admin Telegram commands.

---

## Context

After Phase 1+2, the system can detect and contain burn loops and emit one incident per root cause. But recovery is still manual: the operator has no way to check system state or initiate safe recovery from Telegram without touching the filesystem directly.

Phase 3 delivers:

1. **State snapshot** — reads all relevant runtime state files and returns a structured report (circuit breaker, active incidents, spend guard, recent runs, retry state).
2. **Recovery queue** — a persistent queue file where admin actions are enqueued and then safely drained at the start of the next scheduled orchestrator run.
3. **Ops command handler** — parses `/ops <subcommand>` messages sent from the OPS chat ID and routes them to the right recovery action.
4. **Wiring** — bot-server.js checks for ops commands before normal routing; orchestrator drains the queue at the start of each scheduled run.

---

## Task P3-1 — Add `recoveryQueuePath` to runtime state paths

**File:** `src/runtime/runtime-state-paths-runtime.js`

After the `incidentStorePath` block, add:

```js
const recoveryQueuePath = resolveOptionalPath(
  options.recoveryQueuePath || readEnvValue(env, "SIGNALBRIEF_RECOVERY_QUEUE_PATH"),
  path.join(dataDir, "recovery-queue.json")
);
```

Add `recoveryQueuePath` to:
- Return object
- `listRuntimeStateTargets`: `{ key: "recoveryQueuePath", path: paths.recoveryQueuePath, kind: "file" }`
- `describeRuntimePathAlignment`:
  - `componentRoots.recovery_queue = deriveComponentRoot(paths.recoveryQueuePath, dataRoot)`
  - Divergence: `if (componentRoots.recovery_queue !== dataRoot) divergentComponents.push("recovery_queue");`
  - Mismatch flag: `recovery_queue_outside_data_root: componentRoots.recovery_queue !== dataRoot`

---

## Task P3-2 — Recovery runtime: snapshot + queue

**Files:**
- `src/entrypoints/digest-orchestrator-recovery-runtime.js` (new)
- `tests/contracts/entrypoints/digest-orchestrator-recovery-runtime.test.js` (new)

### Factory

```js
function createDigestOrchestratorRecoveryRuntime(deps) {
  const {
    fs,
    path,
    circuitBreakerStatePath,
    incidentStorePath,
    spendGuardStatePath,
    costLogPath,
    digestRetryStatePath,
    recoveryQueuePath,
    log,
    nowProvider = () => new Date(),
  } = deps || {};
```

### `takeSystemSnapshot()` — SYNC

Reads all state files directly (does not require other runtime instances to be live).

Returns:
```js
{
  snapshot_at: now.toISOString(),
  circuit_breaker: {
    status,          // "OPEN" | "CLOSED"
    opened_at,       // ISO string or null
    opened_reason,   // string or null
    triggered_by,    // string or null
  },
  active_incidents: [  // from incident-store.json, status OPEN or ESCALATED
    {
      fingerprint,
      status,
      severity,
      type,
      date_et,
      occurrence_count,
      first_seen,
      last_seen,
    }
  ],
  spend_guard: {
    rolling_6h_usd,     // sum of zero_value_runs entries in last 6 hours
    daily_usd,          // sum for today_et
    today_et,           // ET date string
    entry_count,        // total entries in state
  },
  recent_runs: [   // last 5 entries from cost-log.json (newest first)
    {
      date,
      run_at_et,
      total_cost_usd,
      users_served,
      users_targeted,
      run_value_state,
    }
  ],
  retry_state: {
    users_with_pending_retry: N,
    users_with_exhausted_budget: N,
  },
  recovery_queue: {
    pending: N,         // actions not yet drained
    items: [],          // pending action objects
  },
}
```

**Reading cost log:** The cost log is a JSONL file. Read last 5 lines by splitting on `\n`, filtering empty, taking last 5, parsing each JSON.

**Reading retry state:** The retry state is a JSON object keyed by `${userId}:${dateEt}`. Count entries where `retry_pending === true` (pending_retry) and where `attempt_count >= 2` (exhausted).

**If any file is missing or unparseable:** Use safe defaults (null fields / empty arrays). Never throw.

### `formatSnapshotMessage(snapshot)` — SYNC

Returns a compact Telegram message string (plain text, ~20 lines max):

```
📊 SignalBrief System Status
{snapshot_at_et}

Circuit Breaker: {OPEN ⛔ | CLOSED ✅}
{if OPEN: "  Opened: {opened_at_et}"}
{if OPEN: "  Reason: {opened_reason}"}

Active Incidents: {N}
{for each: "  • {severity} {type} ({date_et}) ×{occurrence_count}"}

Spend (zero-value runs):
  Rolling 6h: ${rolling_6h_usd}
  Today: ${daily_usd}

Recent runs ({N}):
{for each: "  {run_at_et}: {run_value_state} ${total_cost_usd} ({users_served}/{users_targeted})"}

Retry state:
  Pending: {N}
  Budget exhausted: {N}

Recovery queue: {N} pending
```

**Date formatting:** Use `new Date(isoString).toLocaleString("en-US", { timeZone: "America/New_York", ... })` for ET display. Keep it concise.

### `enqueueRecoveryAction(action)` — SYNC

Appends an action to the recovery queue file.

Action object shape:
```js
{
  action_id: `rq-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
  action,         // "close_circuit_breaker" | "resolve_incident" | "clear_user_retry" | "drain"
  by,             // "admin" | chatId string
  reason,         // string
  params,         // action-specific object (e.g. { fingerprint } or { userId, dateEt })
  enqueued_at,    // ISO string
  status,         // "pending"
}
```

Queue file format:
```json
{
  "version": 1,
  "updated_at": "ISO",
  "items": [ ...action objects... ]
}
```

Atomic write (tmp → rename). Load existing file, push new item, save. If file missing, start fresh.

Returns the action object that was enqueued.

### `drainRecoveryQueue(handlers)` — ASYNC

Reads the recovery queue, executes each pending action using provided handler functions, marks each as `done` or `error`, saves updated queue, returns summary.

`handlers` shape:
```js
{
  close_circuit_breaker: async (action) => void,
  resolve_incident:      async (action) => void,  // action.params.fingerprint
  clear_user_retry:      async (action) => void,  // action.params.userId, action.params.dateEt
  drain:                 async (action) => void,  // no-op
}
```

Processing:
1. Load queue
2. Filter `items` where `status === "pending"`
3. For each pending item:
   a. Find handler by `action` name; if none, skip (don't fail)
   b. Call handler; if throws, mark `status: "error"`, `error_message: e.message`
   c. If succeeds, mark `status: "done"`, `done_at: ISO`
4. Save updated queue
5. Return `{ processed: N, succeeded: N, failed: N, errors: [{action_id, error_message}] }`

If queue file is missing or empty: return `{ processed: 0, succeeded: 0, failed: 0, errors: [] }`.

### Contract test scenarios

1. **takeSystemSnapshot — empty state**: all files missing → snapshot has safe defaults (CB CLOSED, 0 incidents, 0 spend, 0 recent_runs, 0 retry)
2. **takeSystemSnapshot — populated CB**: write a CB state file with OPEN status → snapshot reflects it
3. **takeSystemSnapshot — populated incident store**: write incident-store.json with 1 OPEN incident → snapshot.active_incidents has 1 entry
4. **takeSystemSnapshot — spend guard**: write spend-guard-state.json with 2 entries → rolling_6h_usd reflects their sum
5. **takeSystemSnapshot — cost log**: write a 7-line JSONL cost log → recent_runs has 5 entries (newest last 5)
6. **takeSystemSnapshot — recovery queue**: enqueue 2 actions, 1 drained → recovery_queue shows 1 pending
7. **formatSnapshotMessage**: returns a non-empty string containing key labels (Circuit Breaker, Active Incidents, etc.)
8. **enqueueRecoveryAction**: enqueue 2 actions → queue file has 2 pending items
9. **drainRecoveryQueue — success**: 2 pending actions, handlers resolve → { processed: 2, succeeded: 2, failed: 0 }, status "done"
10. **drainRecoveryQueue — handler error**: handler throws → { processed: 1, succeeded: 0, failed: 1 }, status "error"
11. **drainRecoveryQueue — empty queue**: no file → { processed: 0 }
12. **drainRecoveryQueue — unknown action**: action not in handlers → skipped (not counted as error)

---

## Task P3-3 — Ops command handler

**Files:**
- `src/entrypoints/digest-orchestrator-ops-command-runtime.js` (new)
- `tests/contracts/entrypoints/digest-orchestrator-ops-command-runtime.test.js` (new)

### Factory

```js
function createDigestOrchestratorOpsCommandRuntime(deps) {
  const {
    recoveryRuntime,    // createDigestOrchestratorRecoveryRuntime instance
    sendTelegram,       // async (text, chatId) => void
    opsChatId,          // string — only this chatId may issue ops commands
    log,
  } = deps || {};
```

### `handleOpsCommand(text, chatId)` — ASYNC

Returns `{ handled: true }` if the command was processed, `{ handled: false }` if not.

**Auth check first:** If `String(chatId) !== String(opsChatId)` OR `!opsChatId`: return `{ handled: false }`.

**Command parsing:** Normalize `text.trim()`. If it does not start with `/ops`: return `{ handled: false }`.

**Subcommands:**

`/ops status` or `/ops`:
  - Call `recoveryRuntime.takeSystemSnapshot()`
  - Call `recoveryRuntime.formatSnapshotMessage(snapshot)`
  - Send to opsChatId
  - Return `{ handled: true }`

`/ops reset [reason]`:
  - Parse optional reason from text (everything after `/ops reset `)
  - Enqueue `{ action: "close_circuit_breaker", by: chatId, reason: reason || "admin reset", params: {} }`
  - Send confirmation: `"✅ Recovery action queued: close_circuit_breaker\nWill execute at next scheduled run."`
  - Return `{ handled: true }`

`/ops resolve <fingerprint>`:
  - Parse fingerprint (everything after `/ops resolve `)
  - If fingerprint is empty: send "Usage: /ops resolve <fingerprint>" and return `{ handled: true }`
  - Enqueue `{ action: "resolve_incident", by: chatId, reason: "admin resolve", params: { fingerprint } }`
  - Send confirmation: `"✅ Recovery action queued: resolve_incident\nFingerprint: {fingerprint}"`
  - Return `{ handled: true }`

`/ops clearretry <userId>`:
  - Parse userId (everything after `/ops clearretry `)
  - If userId is empty: send usage and return `{ handled: true }`
  - Enqueue `{ action: "clear_user_retry", by: chatId, reason: "admin clearretry", params: { userId } }`
  - Send confirmation: `"✅ Recovery action queued: clear_user_retry\nUser: {userId}"`
  - Return `{ handled: true }`

`/ops help`:
  - Send help text listing all commands
  - Return `{ handled: true }`

Any other `/ops <unknown>`:
  - Send: `"Unknown ops command. Send /ops help for usage."`
  - Return `{ handled: true }`

**Error handling:** Wrap each command in try/catch. On error, log and send "❌ Ops command failed: {message}" to opsChatId. Always return `{ handled: true }` if the chatId+prefix check passed.

### Contract test scenarios

1. **Auth: wrong chatId** → `{ handled: false }`, no Telegram sent
2. **Auth: no opsChatId** → `{ handled: false }`
3. **Not an ops command** → `{ handled: false }`
4. **/ops status** → snapshot taken, message sent to opsChatId, `{ handled: true }`
5. **/ops reset** → action enqueued, confirmation sent, `{ handled: true }`
6. **/ops reset with reason** → action has correct reason
7. **/ops resolve fingerprint** → action enqueued with correct fingerprint
8. **/ops resolve (no fingerprint)** → usage message sent, no action enqueued
9. **/ops clearretry userId** → action enqueued with correct userId
10. **/ops help** → help text sent
11. **/ops unknown** → error message sent, `{ handled: true }`

---

## Task P3-4 — Wire into bot-server.js and core orchestrator

### bot-server.js wiring

In `processUpdate`, before calling `handleIncomingMessage(text, chatId)`, check for ops commands:

```js
// Add near top of file:
const { resolveSignalBriefRuntimePaths } = require("../runtime/runtime-state-paths-runtime");
const { createDigestOrchestratorRecoveryRuntime } = require("./digest-orchestrator-recovery-runtime");
const { createDigestOrchestratorOpsCommandRuntime } = require("./digest-orchestrator-ops-command-runtime");
```

Build the ops command runtime lazily (module-level cache):

```js
let opsCommandRuntimeCache = null;
function getOpsCommandRuntime() {
  if (!opsCommandRuntimeCache) {
    const runtimePaths = resolveSignalBriefRuntimePaths({ env: process.env });
    const recoveryRuntime = createDigestOrchestratorRecoveryRuntime({
      fs: require("fs"),
      path: require("path"),
      circuitBreakerStatePath: runtimePaths.circuitBreakerStatePath,
      incidentStorePath: runtimePaths.incidentStorePath,
      spendGuardStatePath: runtimePaths.spendGuardStatePath,
      costLogPath: runtimePaths.costLogPath,
      digestRetryStatePath: runtimePaths.digestRetryStatePath,
      recoveryQueuePath: runtimePaths.recoveryQueuePath,
    });
    opsCommandRuntimeCache = createDigestOrchestratorOpsCommandRuntime({
      recoveryRuntime,
      sendTelegram: (text, chatId) => sendMessage(getBotToken(), chatId, text),
      opsChatId: process.env.OPS_ALERT_CHAT_ID || "",
    });
  }
  return opsCommandRuntimeCache;
}
```

In `processUpdate`, before `handleIncomingMessage`:

```js
// Ops command check (privileged ops channel only)
const opsResult = await getOpsCommandRuntime().handleOpsCommand(text, chatId);
if (opsResult.handled) return;
```

`sendMessage` in bot-server.js: write a small helper that sends a Telegram message (same pattern as existing poll/request code). Check if a `sendMessage` function already exists in bot-server.js; if so, reuse it.

### core orchestrator wiring

In `digest-orchestrator-core-runtime.js`, at the **start of the `main()` function** (after existing bootstrap/init), add a recovery queue drain for **scheduled runs only** (not `targetChatId`):

```js
// Drain recovery queue before admission gate (scheduled runs only)
if (!targetChatId) {
  try {
    const recoveryRuntime = createDigestOrchestratorRecoveryRuntime({
      fs,
      path,
      circuitBreakerStatePath: CIRCUIT_BREAKER_STATE,
      incidentStorePath: INCIDENT_STORE,
      spendGuardStatePath: SPEND_GUARD_STATE,
      costLogPath: COST_LOG,
      digestRetryStatePath: RUNTIME_PATHS.digestRetryStatePath,
      recoveryQueuePath: RUNTIME_PATHS.recoveryQueuePath,
      log,
    });
    const drainResult = await recoveryRuntime.drainRecoveryQueue({
      close_circuit_breaker: async () => {
        const cbRuntime = getDigestOrchestratorCircuitBreakerRuntime();
        cbRuntime.closeCircuit();
        log("[recovery] Circuit breaker closed via recovery queue");
      },
      resolve_incident: async (action) => {
        const incRuntime = getDigestOrchestratorIncidentRuntime();
        await incRuntime.resolveIncident(action.params?.fingerprint);
        log(`[recovery] Incident resolved via recovery queue: ${action.params?.fingerprint}`);
      },
      clear_user_retry: async (action) => {
        const retryRuntime = getDigestRetryStateRuntime();
        retryRuntime.clearUserRetryState(action.params?.userId);
        log(`[recovery] Retry state cleared via recovery queue: ${action.params?.userId}`);
      },
      drain: async () => {},
    });
    if (drainResult.processed > 0) {
      log(`[recovery] Queue drained: ${drainResult.succeeded} succeeded, ${drainResult.failed} failed`);
    }
  } catch (e) {
    log(`[warn] Recovery queue drain failed: ${e.message}`);
  }
}
```

Add the require at the top of the file:
```js
const { createDigestOrchestratorRecoveryRuntime } = require("./digest-orchestrator-recovery-runtime");
```

**Note:** Check if `getDigestRetryStateRuntime()` exists in core orchestrator and if `clearUserRetryState` exists on the retry state runtime. If `clearUserRetryState` doesn't exist, omit the clear_user_retry handler and log a warning (the action will be skipped by the "unknown action" path). Do not create the method — that's out of scope.

**Placement:** The drain must happen BEFORE the admission gate check (so a `close_circuit_breaker` action takes effect before the admission gate reads CB state). Place it after the lock acquisition and after `dueUsers` is resolved.

Actually, placement: after `const dueUsers = ...` is resolved and before the admission gate check. Looking at the core orchestrator structure, the drain should go in the scheduled-only path, right after resolving `dueUsers` and before `checkScheduledAdmission`.

---

## Task P3-5 — Final validation and progress doc update

1. Run `npm test` — all tests must pass
2. Update `docs/reliability-recovery-progress.md` — mark Phase 3 COMPLETE
3. Commit and push

---

## Exit Gate

- [ ] Recovery runtime contract tests pass (12 scenarios)
- [ ] Ops command runtime contract tests pass (11 scenarios)
- [ ] All existing contracts pass
- [ ] `npm test` exits 0
- [ ] Progress doc updated
