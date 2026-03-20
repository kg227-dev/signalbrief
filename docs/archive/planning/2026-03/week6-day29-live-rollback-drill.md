# Week 6 Day 29 - Live Rollback Drill (By SHA)

Date: **March 12, 2026**

## Objective

- Validate one-command rollback by commit SHA.
- Run a live rollback drill and measure recovery time.
- Enforce explicit post-rollback public health checklist checks.

## Rollback Command (One Command)

```bash
npm run ops:rollback:sha -- --rollback-sha <sha>
```

Behavior:

1. deploys directly from the target commit archive (`--archive-sha`)
2. runs production deploy from that exact commit snapshot
3. forces rollback-safe deploy mode (`--hotfix --allow-outside-window` by default)
4. runs post-rollback public health checklist:
   - `GET /` -> `200`
   - cache-busted `index.js?v=...` rendered, no raw `__ASSET_VERSION__`
   - `GET /api/health/scheduler` -> `{"ok": true}`
5. writes artifact `deploy-rollback-by-sha-*.json`

## Drill Command (Rollback + Restore)

```bash
npm run ops:rollback:sha -- \
  --rollback-sha <previous_sha> \
  --restore-sha <current_sha> \
  --artifact-name week6-day29-live-drill.json
```

This performs rollback + health checks, then restore + health checks, and records timing for both phases.

## Day 29 Live Drill Evidence

- command:
  - `npm run ops:rollback:sha -- --rollback-sha f5951c5 --restore-sha d8701dc --artifact-name week6-day29-live-drill-r3.json`
- artifact:
  - `artifacts/releases/week6-day29-live-drill-r3.json`
- rollback recovery time (seconds):
  - `37.692`
- restore recovery time (seconds):
  - `34.812`
- total drill time (seconds):
  - `72.6`
- post-rollback checklist:
  - `GET /` -> 200
  - `GET /index.js?v=mtbth7l` -> 200
  - `GET /api/health/scheduler` -> 200 and `ok=true`
- post-restore checklist:
  - `GET /` -> 200
  - `GET /index.js?v=mtbthuh` -> 200
  - `GET /api/health/scheduler` -> 200 and `ok=true`

## Exit Evidence

- rollback runtime added (`scripts/deploy-rollback-by-sha-runtime.js`)
- rollback CLI added (`scripts/deploy-rollback-by-sha.js`)
- npm command wired (`ops:rollback:sha`)
- contract tests added for runtime and health-check flow
