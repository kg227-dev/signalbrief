# Ops Hub

*Last reviewed: March 20, 2026*

This directory is the live home for deployment, recovery, release control, and credential operations.

## Runtime Config And Secrets

- runtime credentials are loaded from environment variables first
- `.env` is the primary local/operator secret source
- `config.json` is optional and should be limited to non-secret local overrides
- the user store runtime supports explicit `file`, `canary`, and `sqlite` backends; current production cutover state is tracked in the SQLite cutover runbook
- CORS allowlists and legacy unsubscribe-retirement controls are runtime config, not one-off code edits

## Deployment And Release Control

- [Release Policy](./release-policy.md) — staging gate, release windows, hotfix path, rollback by SHA
- [Production Cutover Runbook](./production-cutover-ubuntu.md) — VM bootstrap and production topology

Common operator commands:

```bash
npm run ops:deploy:staging
npm run ops:deploy:prod
npm run ops:deploy:prod:emergency-source
npm run ops:release:window-check
npm run ops:rollback:sha -- --rollback-sha <sha>
```

## State Protection And Recovery

- [Reliability Floor Runbook](./reliability-floor-runbook.md) — backups, restore drills, and incident restore flow
- [SQLite User-Store Cutover](./sqlite-user-store-cutover.md) — canary-first file-store to SQLite cutover plan and operator checklist

Common operator commands:

```bash
npm run ops:backup:state
npm run ops:store:migrate:file-to-sqlite
npm run ops:store:dual-read-compare
npm run ops:store:canary:cohort-update -- --cohort-chat-ids "<id1,id2>" --staging-url <https://staging-host>
npm run ops:deploy:prod:store:canary -- --store-canary-chat-ids "<id1,id2>"
npm run ops:store:canary-guard
npm run ops:store:full-enable-validate
npm run ops:deploy:prod:store:sqlite
npm run ops:drill:restore-state -- --latest --clean
```

## Security And Credential Hygiene

- [Security Credential Rotation Checklist](./security-credential-rotation-checklist.md)

## Historical Context

Closed March 2026 execution artifacts now live in [Archive → Planning → March 2026](../archive/planning/2026-03/README.md).
