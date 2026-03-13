# Week 6 Day 28 - Full Enablement + Release Batching Enforcement

Date: **March 12, 2026**

## Objective

- Prepare full-cohort store backend enablement with explicit rollback switch validation.
- Enforce planned release batching windows for production deploys by default.

## Full Enablement Validation

Command:

```bash
npm run ops:store:full-enable-validate -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

What it validates:

1. strict file-vs-sqlite parity (`allowDiff=false`, `strictTokenMatch=true`)
2. full user-set alignment between file and sqlite stores
3. sampled token lookup parity across:
   - `backend=file`
   - `backend=sqlite`
   - `backend=canary` with full cohort
4. rollback switch readiness (`backend=file` path still reads all users)

Artifact output:
- `store-full-enable-validate-*.json`
- includes export-ready values:
  - `SIGNALBRIEF_STORE_BACKEND=sqlite`
  - `SIGNALBRIEF_STORE_ROLLBACK_BACKEND=file`

Rollback switch (operator action):
- set `SIGNALBRIEF_STORE_BACKEND=file`
- run `npm run ops:deploy:prod`

## Release Batching Enforcement

Production deploy command now runs an ET release-window gate before packaging:

- default windows: `MON-FRI @ 11:00 ET` and `MON-FRI @ 16:00 ET`
- tolerance: +/- 45 minutes
- enforced only for `target-env=production`
- staging deploy lane is exempt (`target-env=staging`)

Allowed bypasses:

- `--hotfix` for active incidents
- `--allow-outside-window` for exceptional non-incident overrides with explicit operator accountability

Window check command:

```bash
npm run ops:release:window-check
```

## Day 28 Exit Evidence

- release-window guard runtime + CLI added and wired into prod deploy path
- staging deploy wrapper now marks target as staging so it skips production release-window gate
- full-enable validation script added with strict parity + rollback-readiness checks
- new contract tests added for both release-window and full-enable workflows
