# SignalBrief Release Policy

Last updated: **March 12, 2026**

## Purpose

Define a consistent release process so small changes are not pushed directly to production without pre-prod validation.

## Required Path for Runtime Changes

Runtime changes include edits under:
- `web/**`
- `src/**`
- `scripts/**`
- `docker-compose.yml`
- `package*.json`

For those changes, use this sequence:
1. Open PR and pass CI gates:
  - `npm run check:module-linkage`
  - `npm test`
  - `npm run smoke:worker`
  - `npm run smoke:admin-scheduler`
2. Deploy to staging/preview first:
  - `npm run ops:deploy:staging`
3. Validate staging gates:
  - `GET /` -> `200`
  - Landing page renders cache-busted `index.js?v=...`
  - `GET /api/health/scheduler` -> `{"ok": true}`
4. Promote to production:
  - `npm run ops:deploy:prod`
5. Validate production gates (same three checks).

Promotion gate behavior in tooling:
- `ops:deploy:staging` now writes a staging verification artifact to `artifacts/releases/latest-staging-deploy.json` when public verification passes.
- `ops:deploy:prod` now blocks unless that artifact exists, is fresh, and matches the exact SHA being promoted.
- Default freshness window is 24h (`DEPLOY_STAGING_ARTIFACT_MAX_AGE_MINUTES` or `--staging-artifact-max-age-minutes` to override).

## Hotfix Path

Use direct production deploy only for incidents with active user impact (service down, auth breakage, broken onboarding/settings, failed digest scheduling).

Hotfix requirements:
1. Run local gates (`npm test`, both smoke checks).
2. Deploy with `npm run ops:deploy:prod`.
3. Post deploy in ops log with:
  - commit SHA
  - incident summary
  - rollback owner

Hotfix note:
- `--hotfix` is treated as an explicit staging-gate override for production deploys.
- Non-incident manual override is `--skip-staging-gate` (must include owner callout in release notes).

## Batching Rules

- Non-incident runtime changes are batched into ET release windows enforced by deploy tooling.
- Default release windows:
  - Monday-Friday at **11:00 ET** and **16:00 ET**
  - Window tolerance: +/- 45 minutes
- `npm run ops:deploy:prod` now enforces this gate for `target-env=production`.
- Outside-window deploys require one of:
  - `--hotfix` (active incident path only)
  - `--allow-outside-window` (manual exceptional override with explicit owner callout)
- Staging gate override options:
  - `--hotfix` (incident path)
  - `--skip-staging-gate` (manual non-incident override with explicit owner/rationale)
- UI copy/docs-only changes may skip staging deploy.
- If risk is medium/high, require two-person review before prod promotion.

Operator helpers:
- Check window status only: `npm run ops:release:window-check`
- Override defaults if needed:
  - `DEPLOY_RELEASE_WINDOWS_ET="MON@11:00,MON@16:00,..."`
  - `DEPLOY_RELEASE_WINDOW_TOLERANCE_MINUTES=45`

## Rollback

Primary rollback action:
1. Re-deploy previous known-good commit by SHA:
  - `npm run ops:rollback:sha -- --rollback-sha <sha>`
2. Re-run production gate checks.
3. Confirm scheduler health and digest-lock status on `/api/health/scheduler`.

Every production deployment must record:
- deployed SHA
- verification outcome
- rollback candidate SHA
