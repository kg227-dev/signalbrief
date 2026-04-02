# Source Quality Registry

*Last reviewed: April 2, 2026*

This is the live ops doc for source-governance overrides and review workflow.

## Purpose

Keep one routed live doc for:

- the source-quality override layer
- operator review rules
- the boundary between broker inventory and source-governance policy

Historical implementation notes now live in the archive, not here.

## What This Doc Governs

- domain or identity-level quality overrides
- hard blocks
- review status and explainability
- admin review workflow for suspicious or newly observed sources

The standard-topic broker roster is a separate concern. Topic-to-source inventory still lives in `config/standard-topic-broker-sources.json`.

## Current Live Boundary

- broker roster decides which topic/lane a source can feed
- source-quality registry decides whether a source is trusted, blocked, or needs review
- editorial overrides act on selected stories, not on the source registry itself

## Operator Loop

1. Review the admin source-registry view for newly observed or repeatedly problematic sources.
2. Apply only durable policy changes here; do not bury source decisions in planning docs.
3. Route longer follow-up analysis into archive notes when needed.

## Active References

- active validation review: [`../planning/reduced-scope-mvp-validation/source-registry-manual-review.md`](../planning/reduced-scope-mvp-validation/source-registry-manual-review.md)
- historical follow-up memo: [`../archive/planning/2026-03/source-quality-follow-ups-2026-03-21.md`](../archive/planning/2026-03/source-quality-follow-ups-2026-03-21.md)

## Non-Goals

- duplicating the broker source inventory here
- keeping deploy receipts or completed implementation checklists in the live ops surface
