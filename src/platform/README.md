# Platform Adapters

See [Repository Map](../../docs/repository-map.md) and [Path and Import Rules](../../docs/contributing-path-rules.md) for placement rules.

Canonical platform boundary for infrastructure dependencies.

- `config/`: config loading and environment discovery
- `store/`: user-store persistence, normalization, URL normalization
- `mailer/`: email transport and lifecycle senders
- `scheduler/`: digest lock coordination
- `types/`: shared runtime typedef surface
