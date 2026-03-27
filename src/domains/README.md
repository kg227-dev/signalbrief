# Source Domains

See [Repository Map](../../docs/repository-map.md) and [Path and Import Rules](../../docs/contributing-path-rules.md) for placement rules.

Canonical domain entrypoints for product logic. Existing runtime modules remain active during migration; these indexes provide stable paths for new development.

- `digest/`: digest policy, selection, formatting, archive, and quality scoring
- `reply/`: legacy Telegram/reply compatibility surface retained outside the active email-only MVP path
- `personalization/`: legacy topic-weight learning surface retained for compatibility and audit history
- `engagement/`: engagement event append/load/normalization
