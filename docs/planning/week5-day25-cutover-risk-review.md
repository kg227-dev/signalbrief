# Week 5 Day 25 - Migration Risk Review and Go/No-Go Checklist

Date: **March 12, 2026**

## Current Risk Posture

1. State divergence risk:
   - File-store and SQLite can diverge if backend is switched without replay checks.
   - Mitigation now in repo: `ops:store:dual-read-compare` parity gate + CI fixture parity job.

2. Rollback data-loss risk:
   - Reverting backend flag alone can lose writes made while SQLite was active.
   - Mitigation now in repo: `ops:store:rollback:sqlite-to-file` replay path + strict rollback verification.

3. Operational safety risk:
   - Running migration/rollback without a recent backup increases blast radius.
   - Mitigation: both migration and rollback enforce fresh-backup preflight by default.

## Go/No-Go Checklist (before enabling sqlite backend in production)

All items must be green in one change window:

1. `npm run check:module-linkage`
2. `npm test`
3. `npm run smoke:worker`
4. `npm run smoke:admin-scheduler`
5. `npm run ops:store:migrate:file-to-sqlite:preflight -- --data-dir /opt/signalbrief/app/data --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite`
6. `npm run ops:store:dual-read-compare -- --data-dir /opt/signalbrief/app/data --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite`
7. Deploy gate: `npm run ops:deploy:prod` and verify:
   - `GET /` returns `200`
   - cache-busted landing asset is rendered (`index.js?v=...`, no raw `__ASSET_VERSION__`)
   - `GET /api/health/scheduler` returns `{"ok": true}`

No-Go triggers:
- dual-read parity report has any mismatch
- migration/rollback idempotency check fails
- backup freshness preflight fails and no explicit operator exception approved

## Explicit Rollback-to-File-Store Path

1. Take fresh backup:

```bash
cd /opt/signalbrief/app
npm run ops:backup:state
```

2. Replay SQLite state into file-store and prune stale file-only users:

```bash
cd /opt/signalbrief/app
npm run ops:store:rollback:sqlite-to-file -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --backup-dir /opt/signalbrief/app/artifacts/backups \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

3. Strict rollback verification:

```bash
cd /opt/signalbrief/app
npm run ops:store:rollback:verify -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

4. Set backend to file-store and redeploy:

```bash
# ensure env/config resolves to file backend
export SIGNALBRIEF_STORE_BACKEND=file
npm run ops:deploy:prod
```

5. Confirm post-rollback service health:
   - `GET /` -> `200`
   - `GET /api/health/scheduler` -> `{"ok": true}`
   - latest rollback artifact shows `rollback_verify.pass=true`

Rollback is complete only after all five steps pass.
