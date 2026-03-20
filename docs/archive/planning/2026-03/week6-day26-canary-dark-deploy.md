# Week 6 Day 26 - Canary Backend Dark Deploy

Date: **March 12, 2026**

## Objective

Ship a production-safe backend router that supports:

- dark deploy (`backend=canary`, empty cohort -> all users still served from file-store)
- explicit canary cohort (`SIGNALBRIEF_STORE_CANARY_CHAT_IDS`)
- rollback trigger thresholds via automated parity guard

## Runtime Switches

- `SIGNALBRIEF_STORE_BACKEND=canary`
- `SIGNALBRIEF_STORE_CANARY_CHAT_IDS=<chat_id_1,chat_id_2,...>`
- `SIGNALBRIEF_STORE_CANARY_MIRROR_WRITES=1` (default) to mirror canary writes into file-store for safer rollback

Dark mode configuration:
- set `SIGNALBRIEF_STORE_BACKEND=canary`
- leave `SIGNALBRIEF_STORE_CANARY_CHAT_IDS` empty
- result: runtime path is deployed but all users remain on file-store

## Canary Guard (automated rollback trigger)

Command:

```bash
npm run ops:store:canary-guard -- \
  --data-dir /opt/signalbrief/app/data \
  --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite \
  --artifact-dir /opt/signalbrief/app/artifacts/releases \
  --max-missing-in-sqlite 0 \
  --max-extra-in-sqlite 0 \
  --max-field-mismatches 0 \
  --max-mismatch-rate-percent 0
```

Behavior:
- runs dual-read parity compare
- evaluates metrics against configured thresholds
- exits non-zero when thresholds are breached (unless `--warn-only`)
- writes guard artifact `store-canary-guard-*.json`

Recommended rollback automation on breach:
1. run `ops:store:rollback:sqlite-to-file`
2. run `ops:store:rollback:verify`
3. force `SIGNALBRIEF_STORE_BACKEND=file`
4. run `ops:deploy:prod`

## Day 26 Exit Evidence

- canary router merged in runtime (`backend=canary`)
- mirror-writes toggle available
- canary cohort list resolved from env/options
- guard script present with threshold policy + artifact output
- production deployed with dark configuration (empty canary cohort)
