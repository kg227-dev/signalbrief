# Week 6 Day 27 - Canary Cohort Expansion Gates

Date: **March 12, 2026**

## Objective

Enable controlled canary cohort expansion only when:

- local CI-equivalent checks are green
- staging runtime gates are green
- cohort size remains inside an explicit cap

This makes cohort growth a policy-checked action instead of a manual env edit.

## Command

```bash
npm run ops:store:canary:cohort-update -- \
  --cohort-chat-ids "chat_id_1,chat_id_2" \
  --staging-url https://staging.getsignalbrief.com \
  --max-canary-size 3 \
  --artifact-dir /opt/signalbrief/app/artifacts/releases
```

Optional:

- `--artifact-name <file.json>` for deterministic output naming
- `--skip-local-ci` for incident-path overrides (not default, should be documented in release notes when used)

## Gate Contract

Local checks (unless `--skip-local-ci`):

1. `npm run check:module-linkage`
2. `npm test`
3. `npm run smoke:worker`
4. `npm run smoke:admin-scheduler`

Staging checks:

1. `GET /` returns `200`
2. Landing HTML includes cache-busted `index.js?v=...`
3. Landing HTML does not contain raw `__ASSET_VERSION__`
4. `GET /api/health/scheduler` returns `{"ok": true}`

Hard fail conditions:

- empty `--cohort-chat-ids`
- cohort size greater than `--max-canary-size`
- any required local or staging gate failure

## Output Artifact

The command writes `store-canary-cohort-update-*.json` with:

- selected cohort IDs
- local CI check results
- staging gate results
- `pass` status
- export-ready env values for rollout:
  - `SIGNALBRIEF_STORE_BACKEND=canary`
  - `SIGNALBRIEF_STORE_CANARY_CHAT_IDS=<cohort>`

## Rollout Sequence

1. Run cohort-update command and confirm `pass=true`.
2. Apply exported canary env values for target deploy.
3. Run `npm run ops:deploy:prod`.
4. Run canary guard after deploy:
   - `npm run ops:store:canary-guard -- --data-dir /opt/signalbrief/app/data --sqlite-path /opt/signalbrief/app/data/signalbrief.sqlite`

## Day 27 Exit Evidence

- cohort-update script implemented (`scripts/store-canary-cohort-update.js`)
- script contract test coverage added (`tests/contracts/harness/scripts/store-canary-cohort-update.test.js`)
- npm command wired (`ops:store:canary:cohort-update`)
- runbook documented with gate contract + artifact output
