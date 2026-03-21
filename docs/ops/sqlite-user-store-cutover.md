# SQLite User-Store Cutover

*Last reviewed: March 20, 2026*

## Goal

Make SQLite the explicit primary user store in production, keep file-store as the rollback path, and remove ambiguity about which backend is live.

Scope:
- only the user store changes from `file` to `canary` to `sqlite`
- engagement logs, cost logs, archive snapshots, and other runtime data stay file-backed
- current SQLite schema remains unchanged for this cutover

## Current State

- production runtime currently reports `SIGNALBRIEF_STORE_BACKEND=file`
- deploy/runtime verification can now assert expected store backend and SQLite path
- `docker-compose.yml` accepts runtime store env overrides for `file`, `canary`, and `sqlite`
- the canonical SQLite path for this rollout is `/app/data/signalbrief.sqlite`
- backup manifests now record canonical SQLite assets:
  - `signalbrief.sqlite`
  - `signalbrief.sqlite-wal`
  - `signalbrief.sqlite-shm`

## Rollout Shape

1. Reseed SQLite from current file-store.
2. Run strict parity validation.
3. Run a 1-3 user canary for 24 hours.
4. Full cutover to `sqlite`.
5. Keep rollback-ready stabilization for 7 days.

## Phase 0: Prechecks

Run from the repo root or on the VM at `/opt/signalbrief/app`.

```bash
npm run ops:backup:state

npm run ops:store:migrate:file-to-sqlite -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite

npm run ops:store:dual-read-compare -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite

npm run ops:store:full-enable-validate -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite
```

Go/no-go requirements:
- `migrate-store-file-to-sqlite` succeeds and is idempotent
- `store-dual-read-compare` reports:
  - `missing_in_sqlite=0`
  - `extra_in_sqlite=0`
  - `field_mismatches=0`
- `store-full-enable-validate` passes and exports:
  - `SIGNALBRIEF_STORE_BACKEND=sqlite`
  - `SIGNALBRIEF_SQLITE_PATH=/app/data/signalbrief.sqlite`
  - `SIGNALBRIEF_STORE_ROLLBACK_BACKEND=file`

## Phase 1: Canary

Select up to 3 admin-controlled active users and prepare the cohort artifact:

```bash
npm run ops:store:canary:cohort-update -- \
  --cohort-chat-ids "<chat_id_1,chat_id_2>" \
  --staging-url <https://staging-host> \
  --sqlite-path /app/data/signalbrief.sqlite
```

Expected export values:
- `SIGNALBRIEF_STORE_BACKEND=canary`
- `SIGNALBRIEF_SQLITE_PATH=/app/data/signalbrief.sqlite`
- `SIGNALBRIEF_STORE_CANARY_CHAT_IDS=<chat_id_1,chat_id_2>`
- `SIGNALBRIEF_STORE_CANARY_MIRROR_WRITES=1`

Deploy canary:

```bash
npm run ops:deploy:prod:store:canary -- \
  --store-canary-chat-ids "<chat_id_1,chat_id_2>" \
  --sqlite-path /app/data/signalbrief.sqlite \
  --skip-staging-gate \
  --allow-outside-window
```

Canary acceptance window: 24 hours.

Required evidence during the window:
- at least one successful login or magic-link flow for the canary cohort
- at least one successful settings save for the canary cohort
- at least one digest cycle that includes the canary cohort
- zero-tolerance parity guard passes:

```bash
npm run ops:store:canary-guard -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite \
  --max-missing-in-sqlite 0 \
  --max-extra-in-sqlite 0 \
  --max-field-mismatches 0 \
  --max-mismatch-rate-percent 0
```

## Phase 2: Full Cutover

Immediately before the switch:

```bash
npm run ops:backup:state

npm run ops:store:migrate:file-to-sqlite -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite

npm run ops:store:dual-read-compare -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite

npm run ops:store:full-enable-validate -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite
```

Deploy full cutover:

```bash
npm run ops:deploy:prod:store:sqlite -- \
  --sqlite-path /app/data/signalbrief.sqlite \
  --skip-staging-gate \
  --allow-outside-window
```

Post-deploy required checks:
- `GET /` returns `200`
- landing page renders `index.js?v=...` with no raw `__ASSET_VERSION__`
- `GET /signup` returns `200`
- `GET /api/health/scheduler` returns `{"ok":true}`
- scheduler health payload reports:
  - `runtime_state.store_backend=sqlite`
  - `runtime_state.store_sqlite_path=/app/data/signalbrief.sqlite`

## Phase 3: Stabilization

Stabilization window: 7 days.

During stabilization:
- keep file-store rollback tooling available
- do not remove file-store code paths
- keep backing up the full runtime state directory
- treat SQLite, WAL, and SHM files as canonical user-store assets

Recommended daily checks:

```bash
npm run ops:backup:state
npm run ops:store:dual-read-compare -- --data-dir /app/data --sqlite-path /app/data/signalbrief.sqlite
curl -sS https://getsignalbrief.com/api/health/scheduler
```

## Rollback

If cutover regresses user-store behavior:

```bash
npm run ops:store:rollback:sqlite-to-file -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite

npm run ops:store:rollback:verify -- \
  --data-dir /app/data \
  --sqlite-path /app/data/signalbrief.sqlite
```

Then re-deploy with the file backend explicitly:

```bash
npm run ops:deploy:prod -- \
  --store-backend file \
  --skip-staging-gate \
  --allow-outside-window
```

## Progress Tracker

- [x] Deploy/runtime verification can assert expected store backend and SQLite path
- [x] Compose/runtime config accepts `file`, `canary`, and `sqlite` store overrides
- [x] Backup manifests record canonical SQLite asset files
- [x] Canary/full-enable helper artifacts export explicit backend and SQLite path values
- [ ] Canary cohort selected
- [ ] 24-hour canary completed with zero-tolerance parity guard
- [ ] Full production cutover to `sqlite`
- [ ] 7-day stabilization window completed
