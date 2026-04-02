# Phase 2 — Incident System
## SignalBrief Reliability Recovery Plan V3

**Goal:** Replace hourly event deduplication with a persistent incident lifecycle.
One root cause → one incident. Notify once on OPEN, once per severity escalation, once on RESOLVE.

**Branch:** main (feature freeze in effect; reliability work only)

---

## Context

The current `digest-orchestrator-incident-runtime.js` deduplicates by hour-bucket event key
(`digest-incident:TYPE:2026-03-13T16`). This caused repeated hourly Telegram alerts during the
March 23 burn loop — one alert per hour for the same underlying failure.

Phase 2 replaces this with a persistent incident store (`data/incident-store.json`) keyed by
fingerprint (`mode:type:dateEt`). Each incident has an explicit lifecycle:
`OPEN → ESCALATED → RESOLVED`. Telegram notifications fire only on lifecycle transitions.

---

## Task P2-1 — Add `incidentStorePath` to runtime state paths

**File:** `src/runtime/runtime-state-paths-runtime.js`

### Changes

1. After `circuitBreakerStatePath` block, add:
```js
const incidentStorePath = resolveOptionalPath(
  options.incidentStorePath || readEnvValue(env, "SIGNALBRIEF_INCIDENT_STORE_PATH"),
  path.join(dataDir, "incident-store.json")
);
```

2. Add `incidentStorePath` to the return object.

3. In `listRuntimeStateTargets`, add:
```js
{ key: "incidentStorePath", path: paths.incidentStorePath, kind: "file" },
```

4. In `describeRuntimePathAlignment`:
- Add to `componentRoots`:
  ```js
  incident_store: deriveComponentRoot(paths.incidentStorePath, dataRoot),
  ```
- Add to divergence check:
  ```js
  if (componentRoots.incident_store !== dataRoot) divergentComponents.push("incident_store");
  ```
- Add to `mismatch_flags`:
  ```js
  incident_store_outside_data_root: componentRoots.incident_store !== dataRoot,
  ```

### Test
The existing `runtime-state-paths-runtime.test.js` contract validates exports and path
resolution. Re-run it after changes. No new test file needed for this task.

---

## Task P2-2 — Rewrite incident runtime with persistent lifecycle + update contract test

**Files:**
- `src/entrypoints/digest-orchestrator-incident-runtime.js` (rewrite)
- `tests/contracts/entrypoints/digest-orchestrator-incident-runtime.test.js` (rewrite)

### Exported constants

```js
module.exports = {
  createDigestOrchestratorIncidentRuntime,
  INCIDENT_STATUS_OPEN,        // "OPEN"
  INCIDENT_STATUS_ESCALATED,   // "ESCALATED"
  INCIDENT_STATUS_RESOLVED,    // "RESOLVED"
  INCIDENT_SEVERITY_WARNING,   // "WARNING"
  INCIDENT_SEVERITY_CRITICAL,  // "CRITICAL"
  INCIDENT_SEVERITY_FATAL,     // "FATAL"
};
```

### Factory signature

```js
function createDigestOrchestratorIncidentRuntime(deps) {
  const {
    fs,
    path,
    incidentLogPath,      // JSONL audit log (existing)
    incidentStorePath,    // NEW: persistent JSON store
    log,
    formatEtDateKey,
    resolveOpsChatId,
    sendTelegram,
    nowProvider = () => new Date(),
  } = deps || {};
```

### Persistent store format (`data/incident-store.json`)

```json
{
  "version": 1,
  "updated_at": "2026-03-23T07:00:00.000Z",
  "incidents": {
    "scheduled:circuit_breaker_opened:2026-03-23": {
      "incident_id": "sb-inc-2026-03-23-abc123",
      "fingerprint": "scheduled:circuit_breaker_opened:2026-03-23",
      "status": "OPEN",
      "severity": "WARNING",
      "type": "circuit_breaker_opened",
      "mode": "scheduled",
      "date_et": "2026-03-23",
      "first_seen": "2026-03-23T07:00:00.000Z",
      "last_seen": "2026-03-23T07:00:00.000Z",
      "occurrence_count": 1,
      "summary": "Circuit breaker opened: consecutive_zero_serve",
      "metadata": {},
      "notified_statuses": ["OPEN"]
    }
  }
}
```

### Fingerprint

```js
const fingerprint = `${mode}:${type}:${dateEt}`;
```
- `mode` = `metadata.mode || "scheduled"`
- `type` = the `type` arg passed to `emitDigestIncident`
- `dateEt` = `metadata.date_et || formatEtDateKey(nowProvider())`

### Severity escalation rules

| occurrence_count | severity   |
|------------------|------------|
| 1                | WARNING    |
| 2                | CRITICAL   |
| 3+               | FATAL      |

### Status rules

| event                     | status    |
|---------------------------|-----------|
| First occurrence          | OPEN      |
| Severity increase         | ESCALATED |
| resolveIncident() called  | RESOLVED  |
| Re-open after RESOLVED    | OPEN (new)|

### Notification rules (Telegram)

| transition   | send? | message prefix         |
|--------------|-------|------------------------|
| OPEN         | yes   | `⚠️ INCIDENT OPEN`     |
| ESCALATED    | yes   | `🔴 INCIDENT ESCALATED`|
| RESOLVED     | yes   | `✅ INCIDENT RESOLVED` |
| dedup (same severity) | no | — |

`notified_statuses` tracks which transitions have been notified.
Never send the same transition notification twice for the same incident.

### Atomic write pattern

Use `tmp-${process.pid}-${Date.now()}` temp file, then `fs.renameSync`:
```js
function _atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}
```

### Incident ID generation

```js
function _generateIncidentId(dateEt) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sb-inc-${dateEt}-${rand}`;
}
```

### Methods returned

```js
return {
  appendIncidentLog,        // backward compat: append JSONL audit entry
  emitDigestIncident,       // create/update incident, notify on transitions
  resolveIncident,          // mark RESOLVED, send Telegram
  getActiveIncidents,       // returns open/escalated incidents for a dateEt
};
```

Note: `incidentKeySeenRecently` is **removed** — replaced by persistent store.

### emitDigestIncident implementation logic

```
1. now = nowProvider()
2. mode = metadata.mode || "scheduled"
3. dateEt = metadata.date_et || formatEtDateKey(now)
4. fingerprint = `${mode}:${type}:${dateEt}`
5. load store
6. incident = store.incidents[fingerprint]
7. if incident exists and status === RESOLVED: treat as new (re-open)
8. if no incident (or re-opening):
   - create new incident: status=OPEN, severity=WARNING, occurrence_count=1, notified_statuses=[]
   - append to JSONL log
   - save store
   - send OPEN notification, add "OPEN" to notified_statuses
   - save store again
   - return true
9. if incident exists (OPEN or ESCALATED):
   - increment occurrence_count, update last_seen, update summary/metadata
   - compute new severity from occurrence_count
   - if severity increased:
     - update severity
     - update status to ESCALATED
     - append to JSONL log
     - save store
     - send ESCALATED notification, add "ESCALATED" to notified_statuses
     - save store again
     - return true
   - else:
     - append to JSONL log
     - save store
     - return false (no notification)
```

### resolveIncident implementation logic

```
1. load store
2. incident = store.incidents[fingerprint]
3. if !incident or status === RESOLVED: return false
4. incident.status = RESOLVED, incident.last_seen = now.toISOString()
5. save store
6. send RESOLVED notification, add "RESOLVED" to notified_statuses
7. save store
8. return true
```

### getActiveIncidents implementation logic

```
1. load store
2. filter: status is OPEN or ESCALATED and date_et === dateEt
3. return array of incident records
```

### Contract test scenarios

1. **OPEN notification**: emit once → Telegram sent, incident saved as OPEN/WARNING
2. **Dedup (same severity)**: emit twice same fingerprint → only 1 Telegram sent
3. **ESCALATED notification**: emit 2nd occurrence → Telegram sent for ESCALATED/CRITICAL
4. **FATAL**: emit 3rd occurrence → Telegram sent for ESCALATED/FATAL
5. **RESOLVED**: resolveIncident → Telegram sent, status=RESOLVED
6. **Re-open**: emit after RESOLVED → new OPEN notification sent
7. **getActiveIncidents**: returns correct incidents for a date
8. **JSONL audit log**: all emits append entries (even deduplicated ones)
9. **No opsChatId**: no Telegram sent, incident still stored
10. **Missing incidentStorePath**: if null/undefined, store operations are no-ops (graceful degradation) OR use in-memory fallback — implement as: if !incidentStorePath, skip store load/save (still append JSONL, still send Telegram for first-seen via in-memory map)

Actually for #10: if `incidentStorePath` is not provided, fall back to in-memory `Map` for deduplication (same behavior as today but in-memory). This preserves backward compat.

---

## Task P2-3 — Wire `incidentStorePath` into core orchestrator + resolve on success

**File:** `src/entrypoints/digest-orchestrator-core-runtime.js`

### Change A: Add INCIDENT_STORE constant

After the CIRCUIT_BREAKER_STATE line, add:
```js
const INCIDENT_STORE = RUNTIME_PATHS.incidentStorePath;
```

### Change B: Pass incidentStorePath to factory

In `getDigestOrchestratorIncidentRuntime()`:
```js
digestOrchestratorIncidentRuntimeCache = createDigestOrchestratorIncidentRuntime({
  fs,
  path,
  incidentLogPath: DIGEST_INCIDENT_LOG,
  incidentStorePath: INCIDENT_STORE,   // ADD THIS
  log,
  formatEtDateKey,
  resolveOpsChatId: () => process.env.OPS_ALERT_CHAT_ID || CONFIG?.user?.telegramChatId || null,
  sendTelegram,
});
```

### Change C: Resolve active incidents on successful delivery

In the main() function, just before the `recordRunCost` call in the finally block (or right after
the B6 circuit-breaker block), add a success-path resolve:

```js
// Resolve open incidents when delivery succeeds
if (deliveredUsers.length > 0) {
  try {
    const incidentRuntime = getDigestOrchestratorIncidentRuntime();
    const activeIncidents = incidentRuntime.getActiveIncidents(digestDateKey);
    for (const incident of activeIncidents) {
      await incidentRuntime.resolveIncident(incident.fingerprint);
    }
  } catch (e) {
    log(`[warn] Incident resolve failed: ${e.message}`);
  }
}
```

This must be placed INSIDE the try block, after `deliveredUsers` and `failedUsers` are known,
but before the finally. Place it in the same block as the circuit-breaker evaluation (B6 area),
after the existing circuit-breaker evaluation block.

### No new test needed for this task
The core orchestrator is tested via integration — the incident runtime contract covers
the lifecycle logic. This change is wiring only.

---

## Task P2-4 — Final validation and progress doc update

1. Run `npm test` — all tests must pass
2. Run `node --check src/entrypoints/digest-orchestrator-incident-runtime.js`
3. Update `docs/reliability-recovery-progress.md` — mark Phase 2 COMPLETE

---

## Exit Gate

- [ ] All new contract tests pass
- [ ] All existing contracts pass (217+ sidecar module contracts)
- [ ] `npm test` exits 0
- [ ] Progress doc updated
