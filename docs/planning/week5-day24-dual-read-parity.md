# Week 5 Day 24 - Dual-Read Compare Mode

Date: **March 12, 2026**

## Objective

Add a deterministic parity check between file-store records and SQLite records so staging/local validation can catch backend drift before any cutover.

## Command

```bash
npm run ops:store:dual-read-compare -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

## Behavior

- Reads `data/user-*.json` as source-of-truth file-store records.
- Reads SQLite users from `signalbrief.sqlite`.
- Compares normalized user records by `chatId`.
- Treats `file.token == null` and `sqlite.token != null` as equivalent (backfill parity mode).
- Fails on:
  - users missing in SQLite
  - field-level mismatches after normalization
  - extra SQLite users (unless `--allow-extra-sqlite` is set)
- Emits JSON report artifact: `store-dual-read-compare-*.json`.

## CI Gate

Workflow job: `store-dual-read-parity` in `.github/workflows/ci.yml`

Steps:
1. Build representative fixture data set (`tests/fixtures/store-dual-read/data`).
2. Seed SQLite via `ops:store:migrate:file-to-sqlite`.
3. Run `ops:store:dual-read-compare`.
4. Fail PR if parity report detects drift.

This gate is the Day 24 baseline for safe local/staging backend comparison before cutover planning.
