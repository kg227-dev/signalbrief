# Retrieval Quality

*Last reviewed: April 8, 2026*

Use this capsule when the task touches candidate discovery, scoring, selection, writeups, evals, or source governance.

## Goal

Produce 5 strong, fresh, on-topic items per sector with trusted trade and official sources as the backbone, while keeping discovery and backfill as support rather than the defining layer.

## Current Status

The retrieval loop is mechanically healthy but still quality-constrained.

What is working:

- scheduled runs are delivering
- candidate depth is generally strong
- broker source fetch success is high
- admin audit surfaces are much better than they were in March

What is still failing:

- trusted-share is below the MVP target
- `provider_parse_failure` reappeared in the writeup path
- standard-tier items still win selected slots too often
- Technology relevance remains too permissive on consumer-device and culture/meta stories

The live operator summary is [`../../ops/retrieval-eval-worklog.md`](../../ops/retrieval-eval-worklog.md). Detailed day writeups live in the archive.

## Code Surfaces

Start in these areas:

- `src/domains/selection/`
- `src/domains/scoring/`
- `src/domains/source-registry/`
- `src/entrypoints/`
- `scripts/` for eval/report tooling
- `web/api/` and `web/services/` for admin diagnostics

Compatibility logic may still be present under `src/digest/` and `src/runtime/`.

## Current Questions

- How do we prevent lower-trust reserve items from beating premium or strong candidates on adequate-depth days?
- Which `provider_parse_failure` cases are parser issues versus prompt/shape issues?
- Which negative signals should suppress personal-device reviews, app-feature-only stories, and culture commentary inside Technology?
- Where should official content be allowed as support versus treated as filler?

## Evidence Sources

- live summary: [`../../ops/retrieval-eval-worklog.md`](../../ops/retrieval-eval-worklog.md)
- active tracker: [`../../planning/reduced-scope-mvp-validation/daily-analysis.md`](../../planning/reduced-scope-mvp-validation/daily-analysis.md)
- source rules: [`../../ops/source-quality-registry.md`](../../ops/source-quality-registry.md)
- admin funnel spec: [`../../specs/admin-funnel-page.md`](../../specs/admin-funnel-page.md)

## Read Only If Needed

- `docs/planning/reduced-scope-mvp-validation/README.md`
- `docs/superpowers/plans/2026-04-03-wim-eval-harness.md`
- `docs/superpowers/plans/2026-04-05-admin-funnel-page.md`
- `docs/superpowers/plans/2026-04-06-selection-quality-p1.md`
- `docs/archive/planning/2026-03/retrieval-eval-worklog-2026-03.md`
- `data/retrieval-evals/worklog.md`
