# API Surface

See [Repository Map](../../docs/repository-map.md) and [SPEC.md](../../SPEC.md) for the broader API and runtime context.

Canonical HTTP API grouping.

- `routes/admin/`: authenticated admin route handlers
- `routes/core/`: user-facing API routes (`/api/*`)
- `routes/public-static.js`: static/public route handling

`web/api/` is documentation-only. The concrete runtime modules live under `web/routes/`.
