# Week 2 Security Hardening Review + Merge Gate (Day 10)

Date: **March 12, 2026**  
Window covered: Day 6 through Day 10 of the 6-week execution plan.

## Scope Reviewed

- Admin auth boundary and local bypass behavior.
- Startup config validation fail-fast behavior.
- Privileged admin route auth regression coverage.
- Settings write-path normalization (`topics`, `days_of_week`, `items_per_digest`).
- Production deploy verification gates.

## Hardening Outcomes (Week 2)

- Day 6: Admin local bypass is non-production only and read-only route scoped.
- Day 7: `config.json` schema validation fails fast at startup.
- Day 8: Protected `/api/admin/*` routes have explicit unauthenticated regression coverage.
- Day 9: `/api/settings` now canonicalizes topics, enforces non-empty normalized days, and bounds item count to supported settings values.

## Security Merge Gate (Required Before Merge)

All gates below must pass in the same change window.

1. Contract gate
```bash
npm test
```
Pass criteria: critical-path suite exits `0`, including admin auth and settings normalization contracts.

2. Worker smoke gate
```bash
npm run -s smoke:worker
```
Pass criteria: exits `0` and logs `[smoke-worker] ok`.

3. Scheduler smoke gate
```bash
npm run -s smoke:admin-scheduler
```
Pass criteria: includes `stale-health ok` and `healthy-after-stale ok`.

4. Production deploy gate (for runtime-affecting changes)
```bash
npm run ops:deploy:prod
```
Pass criteria:
- `GET /` returns `200`
- landing page references cache-busted `index.js?v=...` (no raw `__ASSET_VERSION__`)
- `GET /api/health/scheduler` returns `{"ok": true}`

## Evidence Collected (March 12, 2026)

Executed from this workspace during Day 9/10 completion:

- `npm test` -> pass (critical-path contracts all green)
- `npm run -s smoke:worker` -> pass (`[smoke-worker] ok`)
- `npm run -s smoke:admin-scheduler` -> pass (`stale-health ok`, `healthy-after-stale ok`, `ok`)
- `npm run ops:deploy:prod` -> pass for deploy `d2ff211`
  - public verify `/` -> `200`
  - asset gate -> cache-busted `index.js?v=mtbptsg` served
  - scheduler health -> `{"ok":true,...}`

## Residual Risks

- Remote in-host npm/node verification can still be skipped if host prerequisites are unavailable; public endpoint verification remains the hard acceptance gate.
- Mail provider response parsing and timeout parity are still open hardening items (tracked in `docs/features.md`).

## Week 3 Entry Condition

No Week 3 decomposition work starts unless all four merge gates above are green on the latest production commit.
