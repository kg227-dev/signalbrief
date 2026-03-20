# Week 5 Day 23 - Store Migration Preflight (VM Safety)

Date: **March 12, 2026**  
Scope: `file -> sqlite` user-store migration readiness and replay safety evidence.

## Goal

Run a repeatable migration on the VM that:

- does not touch source JSON files (`data/user-*.json`)
- upserts users into SQLite
- can be replayed with zero additional writes
- produces an auditable release artifact JSON

## Required Inputs (on VM)

- App root: `/opt/signalbrief/app`
- Source data dir: `/opt/signalbrief/app/data`
- Target sqlite path: `/opt/signalbrief/app/data/signalbrief.sqlite`
- Backup dir: `/opt/signalbrief/app/artifacts/backups`
- Release artifact dir: `/opt/signalbrief/app/artifacts/releases`

## Preflight Checklist (run in order)

1. Capture a fresh state backup:

```bash
cd /opt/signalbrief/app
npm run ops:backup:state
```

2. Run migration preflight only:

```bash
cd /opt/signalbrief/app
npm run ops:store:migrate:file-to-sqlite:preflight -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --backup-dir /opt/signalbrief/app/artifacts/backups \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

3. Confirm preflight artifact exists and reports `ok`:

```bash
ls -1t /opt/signalbrief/app/artifacts/releases/store-migration-file-to-sqlite-*.json | head -n 1
```

Exit criteria:
- Node is `22+`
- `node:sqlite` is available
- backup exists and is within `24h` (default threshold)
- sqlite/artifact directories are writable

## Migration Command (safe replay)

```bash
cd /opt/signalbrief/app
npm run ops:store:migrate:file-to-sqlite -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --backup-dir /opt/signalbrief/app/artifacts/backups \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

Expected successful output includes:
- `summary: source=... inserted=... updated=... unchanged=...`
- `idempotent_replay: ok=true pending_writes=0`
- `artifact=/opt/signalbrief/app/artifacts/releases/store-migration-file-to-sqlite-...json`

## Release Artifact Contract

The migration writes one JSON artifact per run containing:

- migration metadata (`version`, `migration`, `commit_sha`, timestamps, host)
- resolved options (`data_dir`, `sqlite_path`, `backup_dir`, `artifact_dir`)
- preflight evidence (`checks`, `warnings`, backup freshness)
- migration summary (`inserted`, `updated`, `unchanged`, `writes_applied`)
- replay safety result (`idempotent_replay`)
- deterministic dataset checksums for source and migrated sets

This artifact is the required evidence for Day 23 completion before any backend cutover work.
