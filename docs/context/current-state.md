# Current State

*Last reviewed: April 8, 2026*

This file is the quickest accurate snapshot of SignalBrief's live state.

## Product Shape

SignalBrief is a scheduled, email-only daily briefing across 7 fixed sectors: Healthcare, Life Sciences, Technology, Energy, Financial Services, Consumer & Retail, and Industrials.

The live MVP contract is:

- users subscribe to `1-3` sectors
- each sector delivers up to `5` selected items
- only items from the last `48 hours` are eligible
- depth modes change writeup depth, not story selection
- underfilled sectors are withheld instead of padded

Canonical product and runtime rules live in [`../reduced-scope-mvp.md`](../reduced-scope-mvp.md) and [`../../SPEC.md`](../../SPEC.md).

## Repo Shape

Primary runtime entrypoints:

- `src/entrypoints/digest.js`
- `src/entrypoints/scheduler-worker.js`
- `web/server.js`

Canonical code surfaces:

- `src/domains/`
- `src/platform/`
- `web/api/`
- `web/services/`
- `web/client/`

Compatibility modules still exist under `src/runtime/`, `src/digest/`, and `web/routes/`.

## Live Operating Picture

As of April 8, 2026, the product is mechanically healthier than it was in late March, but the retrieval-quality loop is still not exit-green.

Current headline:

- scheduled delivery path is working
- admin auditability is much stronger
- retrieval quality is the main blocker

The live retrieval summary is maintained in [`../ops/retrieval-eval-worklog.md`](../ops/retrieval-eval-worklog.md). Detailed daily writeups are archived.

## Current Workstreams

- Retrieval quality: trusted-share regression, writeup parse reliability, and topic purity remain the main open problems.
- Runtime and delivery: scheduler and production deploy flow are stable enough to support daily validation, but releases still need disciplined verification.
- Admin and growth: admin diagnostics are materially stronger, especially funnel visibility, but growth work is secondary to quality and trust.

## Default Routing

- If the task touches selection, scoring, source mix, writeups, or evals: start with [`workstreams/retrieval-quality.md`](./workstreams/retrieval-quality.md).
- If the task touches deploys, scheduler behavior, health checks, send paths, or recovery: start with [`workstreams/runtime-and-delivery.md`](./workstreams/runtime-and-delivery.md).
- If the task touches admin pages, signup, archive UX, or marketing/growth surfaces: start with [`workstreams/admin-and-growth.md`](./workstreams/admin-and-growth.md).

## Not Default Context

Do not start with archived plans, superpowers plans, or runtime history mirrors unless the task requires provenance.

Large files to avoid loading by default include:

- `docs/planning/reduced-scope-mvp-validation/README.md`
- `docs/superpowers/plans/*.md`
- `docs/specs/*.md`
- `docs/archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`
- `data/retrieval-evals/worklog.md`
