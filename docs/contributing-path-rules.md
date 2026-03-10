# Path and Import Rules

1. Prefer canonical imports for new code:
   - Domain logic from `src/domains/*`
   - Infrastructure adapters from `src/platform/*`
   - HTTP routes from `web/api/*`

2. Keep compatibility for existing callsites:
   - Do not remove `src/runtime/*`, `src/digest/*`, or `web/routes/*` paths without migrating all imports.

3. Naming conventions:
   - Orchestration modules: `*-service.js`
   - Adapter boundaries: `*-gateway.js` or folder `index.js` adapter entry
   - Route handlers: `*-route.js`
   - Pure logic modules: `*.core.js`

4. Scripts:
   - Checks under `scripts/check-*`
   - Smokes under `scripts/smoke-*`
   - Reports under `scripts/report-*`

5. PR hygiene:
   - Keep move-only commits separate from behavior changes.
   - Preserve external script commands and route contracts.
