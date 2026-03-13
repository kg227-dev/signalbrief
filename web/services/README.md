# Service Groupings

See [Repository Map](../../docs/repository-map.md) for service-layer placement and migration context.

Canonical service grouping for onboarding:

- `admin/`: admin operations, analytics, scheduler, stats
- `user/`: signup/settings/admin user handlers
- `shared/`: request metadata, delivery schedule, rate limiting, archive scoring

During migration, source files remain under `web/services/*.js`; group indexes provide stable import paths.
