# Service Groupings

See [Repository Map](../../docs/repository-map.md) for service-layer placement and migration context.

Canonical service grouping for onboarding:

- `admin/`: admin operations, analytics, scheduler, stats
- `user/`: signup/settings/admin user handlers
- `shared/`: request metadata, delivery schedule, rate limiting, archive scoring

Live grouped entrypoints now exist at `web/services/admin`, `web/services/shared`, and `web/services/user`.
During migration, source files remain under `web/services/*.js`; the grouped entrypoints provide stable import paths over those flat modules.
